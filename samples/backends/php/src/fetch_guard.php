<?php
// Fetches web services for reports while refusing internal addresses (SSRF).
//
// The hostname is resolved once, every address is checked, and curl is pinned to a checked address
// (CURLOPT_RESOLVE; TLS still verifies the real hostname) — so DNS rebinding cannot slip past the
// check. Redirects are followed by hand and checked again.

declare(strict_types=1);

const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_SECONDS = 10;

const BLOCKED_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
    '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
const BLOCKED_V6 = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8', '2001:db8::/32', '100::/64'];
// Addresses that carry an IPv4 address in their last 32 bits: judged by that address.
const EMBEDS_V4 = ['::ffff:0:0/96', '64:ff9b::/96', '::/96'];

function in_prefix(string $packed, string $cidr): bool
{
    [$net, $bits] = explode('/', $cidr);
    $network = inet_pton($net);
    if ($network === false || strlen($network) !== strlen($packed)) {
        return false;
    }
    $bits = (int) $bits;
    $bytes = intdiv($bits, 8);
    if (substr($packed, 0, $bytes) !== substr($network, 0, $bytes)) {
        return false;
    }
    $rest = $bits % 8;
    if ($rest === 0) {
        return true;
    }
    $mask = (0xff << (8 - $rest)) & 0xff;
    return (ord($packed[$bytes]) & $mask) === (ord($network[$bytes]) & $mask);
}

function is_blocked(string $ip): bool
{
    $packed = @inet_pton(trim($ip, '[]'));
    if ($packed === false) {
        return true;
    }
    if (strlen($packed) === 4) {
        foreach (BLOCKED_V4 as $cidr) {
            if (in_prefix($packed, $cidr)) {
                return true;
            }
        }
        return false;
    }
    foreach (EMBEDS_V4 as $cidr) {
        if (in_prefix($packed, $cidr)) {
            return is_blocked((string) inet_ntop(substr($packed, 12)));
        }
    }
    foreach (BLOCKED_V6 as $cidr) {
        if (in_prefix($packed, $cidr)) {
            return true;
        }
    }
    return false;
}

/** The numeric shorthands most resolvers accept ("2130706433", "0x7f.1", "127.1"), or null. */
function inet_aton_shorthand(string $host): ?string
{
    $nums = [];
    foreach (explode('.', $host) as $part) {
        if (preg_match('/^0x([0-9a-f]+)$/i', $part, $m)) {
            $nums[] = hexdec($m[1]);
        } elseif (preg_match('/^0[0-7]*$/', $part)) {
            $nums[] = octdec($part);
        } elseif (ctype_digit($part)) {
            $nums[] = (int) $part;
        } else {
            return null;
        }
    }
    $value = match (count($nums)) {
        1 => $nums[0],
        2 => ($nums[0] << 24) | ($nums[1] & 0xffffff),
        3 => ($nums[0] << 24) | ($nums[1] << 16) | ($nums[2] & 0xffff),
        default => ($nums[0] << 24) | ($nums[1] << 16) | ($nums[2] << 8) | $nums[3],
    };
    return $value >= 0 && $value <= 0xffffffff ? long2ip((int) $value) : null;
}

/** The address to connect to (IPv4 first), or an ApiError when any address is internal. */
function resolve_checked(string $host, array $allowHosts): string
{
    $allowed = in_array(strtolower($host), $allowHosts, true);
    if (preg_match('/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i', $host)) {
        $ip = inet_aton_shorthand($host) ?? throw new ApiError(400, 'Invalid URL.');
        if (!$allowed && is_blocked($ip)) {
            throw new ApiError(403, "Refusing to fetch $host: internal address.");
        }
        return $ip;
    }
    if (@inet_pton(trim($host, '[]')) !== false) {
        if (!$allowed && is_blocked($host)) {
            throw new ApiError(403, "Refusing to fetch $host: internal address.");
        }
        return trim($host, '[]');
    }
    $v4 = gethostbynamel($host) ?: [];
    $v6 = array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6');
    $all = [...$v4, ...$v6];
    if (!$all) {
        throw new ApiError(502, "Could not resolve $host.");
    }
    foreach ($all as $ip) {
        if (!$allowed && is_blocked($ip)) {
            throw new ApiError(403, "Refusing to fetch $host: it resolves to an internal address.");
        }
    }
    return $all[0];
}

/** @return array{0: string, 1: string} content type and body */
function guarded_fetch(string $url, string $method, array $headers, ?string $body, array $allowHosts): array
{
    // One deadline for the whole fetch, redirects and a slowly dripping body included.
    $deadline = microtime(true) + FETCH_SECONDS;
    $origin = null;
    $current = $url;
    for ($i = 0; $i <= MAX_REDIRECTS; $i++) {
        // URLs that parsers read differently are refused rather than interpreted.
        if (preg_match('/[\\\\\s]/', $current) || substr_count($current, '@') > 1) {
            throw new ApiError(400, 'Invalid URL.');
        }
        $parts = parse_url($current);
        $scheme = strtolower($parts['scheme'] ?? '');
        if (!in_array($scheme, ['http', 'https'], true) || empty($parts['host'])) {
            throw new ApiError(400, 'Only http and https URLs can be fetched.');
        }
        $host = $parts['host'];
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        $origin ??= "$scheme://$host:$port";
        $ip = resolve_checked($host, $allowHosts);
        // The caller's headers (Authorization, cookies) are for the original site only.
        $out = [];
        if ("$scheme://$host:$port" === $origin) {
            foreach ($headers as $h) {
                // No line breaks anywhere (header injection), no colon in the name.
                if (is_array($h) && is_string($h['name'] ?? null) && preg_match('/^[^\r\n:]+$/', $h['name']) && strcasecmp($h['name'], 'host') !== 0
                    && is_scalar($h['value'] ?? '') && !preg_match('/[\r\n]/', (string) ($h['value'] ?? ''))) {
                    $out[] = $h['name'] . ': ' . (string) ($h['value'] ?? '');
                }
            }
        }
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            throw new ApiError(504, 'The web service did not answer in time.');
        }
        $data = '';
        $tooBig = false;
        $curl = curl_init($current);
        curl_setopt_array($curl, [
            // An empty host and port match whatever curl makes of the URL: it always connects to
            // the checked address, even where its URL parser and PHP's disagree.
            CURLOPT_CONNECT_TO => [sprintf('::%s:%d', str_contains($ip, ':') ? "[$ip]" : $ip, $port)],
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROXY => '',
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT_MS => (int) ($remaining * 1000),
            CURLOPT_HTTPHEADER => $out,
            // Some APIs refuse requests without one; a caller's own User-Agent header wins.
            CURLOPT_USERAGENT => 'we-report-backend',
            CURLOPT_CUSTOMREQUEST => $method === 'POST' ? 'POST' : 'GET',
            CURLOPT_POSTFIELDS => $method === 'POST' ? ($body ?? '') : null,
            CURLOPT_WRITEFUNCTION => function ($_, string $chunk) use (&$data, &$tooBig): int {
                $data .= $chunk;
                if (strlen($data) > MAX_FETCH_BYTES) {
                    $tooBig = true;
                    return -1;
                }
                return strlen($chunk);
            },
        ]);
        if ($method !== 'POST') {
            curl_setopt($curl, CURLOPT_HTTPGET, true);
        }
        $ok = curl_exec($curl);
        $errno = curl_errno($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $type = curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
        $location = curl_getinfo($curl, CURLINFO_REDIRECT_URL);
        curl_close($curl);
        if ($tooBig) {
            throw new ApiError(502, 'The response is larger than 5 MB.');
        }
        if ($ok === false) {
            throw $errno === CURLE_OPERATION_TIMEDOUT
                ? new ApiError(504, 'The web service did not answer in time.')
                : new ApiError(502, 'Could not reach the web service.');
        }
        if ($status >= 300 && $status < 400 && $location) {
            $current = $location;
            continue;
        }
        if ($status >= 400) {
            throw new ApiError(502, "The web service answered $status.");
        }
        return [$type, $data];
    }
    throw new ApiError(502, 'Too many redirects.');
}
