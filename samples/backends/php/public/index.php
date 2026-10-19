<?php
// we-report data backend — PHP implementation of protocol/openapi.yaml (v1).
//
// PDO SQLite and PostgreSQL. Run: php -S 127.0.0.1:5480 public/index.php
// (or point any web server's front controller at this file).

declare(strict_types=1);

require __DIR__ . '/../src/query.php';
require __DIR__ . '/../src/databases.php';
require __DIR__ . '/../src/fetch_guard.php';

const MAX_BODY = 1024 * 1024;

function list_env(string $name, string $fallback = ''): array
{
    $value = getenv($name);
    return array_values(array_filter(array_map(fn ($v) => strtolower(trim($v)), explode(',', $value === false ? $fallback : $value))));
}

/** Every setting comes from the environment (and an optional connections file), never from requests. */
function load_config(): array
{
    $demo = getenv('WE_REPORT_DEMO') === '1';
    $raw = getenv('WE_REPORT_CONNECTIONS') ?: (is_file('connections.json') ? file_get_contents('connections.json') : '');
    if ($raw) {
        $connections = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        $ids = [];
        foreach ($connections as $c) {
            foreach (['id', 'name', 'dialect', 'url'] as $key) {
                if (empty($c[$key])) {
                    throw new RuntimeException("Every connection needs \"$key\".");
                }
            }
            if (!preg_match('/^[\w-]+$/', $c['id']) || isset($ids[$c['id']])) {
                throw new RuntimeException("Connection id \"{$c['id']}\" must be unique and use letters, digits, _ or -.");
            }
            if (!in_array($c['dialect'], ['sqlite', 'postgres'], true)) {
                throw new RuntimeException("Unsupported dialect \"{$c['dialect']}\" (this sample: sqlite, postgres).");
            }
            $ids[$c['id']] = true;
        }
    } else {
        $connections = [['id' => 'sample', 'name' => 'Sample shop (SQLite)', 'dialect' => 'sqlite',
            'url' => sys_get_temp_dir() . '/we-report-sample-php.db', 'seed' => 'sample']];
    }
    foreach ($connections as &$c) {
        // Demo mode never runs free SQL, whatever the file says.
        $c['allowFreeSql'] = !$demo && ($c['allowFreeSql'] ?? false) === true;
        $c['maxRows'] = min((int) ($c['maxRows'] ?? 0) ?: 5000, 50000);
        $c['timeoutMs'] = (int) ($c['timeoutMs'] ?? 0) ?: 15000;
    }
    unset($c);
    return [
        'demo' => $demo,
        'authToken' => getenv('WE_REPORT_AUTH_TOKEN') ?: null,
        'corsOrigins' => list_env('WE_REPORT_CORS_ORIGINS', 'http://localhost:4200,http://127.0.0.1:4200'),
        // The fetch proxy would be an open proxy on a public demo.
        'webServiceFetch' => !$demo && getenv('WE_REPORT_FETCH') !== '0',
        'fetchAllowHosts' => list_env('WE_REPORT_FETCH_ALLOW_HOSTS'),
        'rateLimit' => (int) (getenv('WE_REPORT_RATE_LIMIT') ?: ($demo ? 60 : 600)),
        'connections' => $connections,
    ];
}

function respond(int $status, mixed $body): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function is_loopback(string $host): bool
{
    $packed = @inet_pton(trim($host, '[]'));
    if ($packed === false) {
        return false;
    }
    if (strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        $packed = substr($packed, 12);
    }
    return strlen($packed) === 4 ? $packed[0] === "\x7f" : $packed === str_repeat("\0", 15) . "\1";
}

/** Per-IP requests per minute, kept in small files: PHP keeps no memory between requests. */
function over_rate_limit(string $ip, int $limit): bool
{
    $dir = sys_get_temp_dir() . '/we-report-rate';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $minute = intdiv(time(), 60);
    $file = $dir . '/' . sha1($ip) . '-' . $minute;
    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return false;
    }
    flock($handle, LOCK_EX);
    $count = (int) stream_get_contents($handle) + 1;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string) $count);
    flock($handle, LOCK_UN);
    fclose($handle);
    if (random_int(1, 200) === 1) {
        foreach (glob("$dir/*") ?: [] as $old) {
            if (!str_ends_with($old, "-$minute")) {
                @unlink($old);
            }
        }
    }
    return $count > $limit;
}

/** Reads the body while counting: chunked bodies have no Content-Length to check up front. */
function json_body(): array
{
    $stream = fopen('php://input', 'rb');
    $raw = stream_get_contents($stream, MAX_BODY + 1);
    if (strlen((string) $raw) > MAX_BODY) {
        throw new ApiError(413, 'Request body too large.');
    }
    try {
        $body = json_decode($raw === '' ? '{}' : (string) $raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new ApiError(400, 'Body must be JSON.');
    }
    if (!is_array($body) || (array_is_list($body) && $body !== [])) {
        throw new ApiError(400, 'Body must be a JSON object.');
    }
    return $body;
}

function connection(array $config, string $id): array
{
    foreach ($config['connections'] as $c) {
        if ($c['id'] === $id) {
            return [$c, open_database($c)];
        }
    }
    throw new ApiError(404, "No connection \"$id\".");
}

function handle(array $config): never
{
    header('X-Content-Type-Options: nosniff');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array(strtolower($origin), $config['corsOrigins'], true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Vary: Origin');
    }
    if ($method === 'OPTIONS') {
        header('Access-Control-Allow-Methods: GET, POST');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Max-Age: 600');
        http_response_code(204);
        exit;
    }

    // Who may call, and how often. Without a token only local callers are accepted — unless this is
    // the public demo, which serves read-only sample data to anyone. Plug your own auth in here.
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (over_rate_limit($ip, $config['rateLimit'])) {
        throw new ApiError(429, 'Too many requests; try again in a minute.');
    }
    if ($config['authToken'] !== null) {
        $allowed = hash_equals('Bearer ' . $config['authToken'], $_SERVER['HTTP_AUTHORIZATION'] ?? '');
    } elseif ($config['demo']) {
        $allowed = true;
    } else {
        // Local only — and addressed as a local host, so a page whose domain was re-pointed at
        // 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
        $host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
        $allowed = is_loopback($ip) && ($host === 'localhost' || is_loopback($host));
    }
    if (!$allowed) {
        throw new ApiError(401, 'Not authorized.');
    }
    // A page elsewhere can POST a plain form (text/plain) without a CORS preflight; JSON it cannot.
    if ($method === 'POST' && !preg_match('#^application/json\b#i', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')) {
        throw new ApiError(415, 'Send the body as application/json.');
    }

    $path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
    if ($method === 'GET' && $path === '/v1/info') {
        respond(200, ['protocol' => 1, 'server' => 'we-report-php',
            'capabilities' => ['webServiceFetch' => $config['webServiceFetch'], 'demo' => $config['demo']]]);
    }
    if ($method === 'GET' && $path === '/v1/connections') {
        // Never the url: ids, names, dialects and what is allowed.
        respond(200, array_map(fn ($c) => ['id' => $c['id'], 'name' => $c['name'], 'dialect' => $c['dialect'], 'freeSql' => $c['allowFreeSql']], $config['connections']));
    }
    if ($method === 'GET' && preg_match('#^/v1/connections/([^/]+)/schema$#', $path, $m)) {
        [, $db] = connection($config, $m[1]);
        respond(200, ['tables' => $db->schema()]);
    }
    if ($method === 'POST' && preg_match('#^/v1/connections/([^/]+)/query$#', $path, $m)) {
        [$c, $db] = connection($config, $m[1]);
        $body = json_body();
        $params = is_array($body['params'] ?? null) ? $body['params'] : [];
        if (array_key_exists('sql', $body)) {
            if (!$c['allowFreeSql']) {
                throw new ApiError(403, 'Free SQL is not allowed on this connection. Use the query builder.');
            }
            $built = build_free_sql($body['sql'], $params, $c['maxRows']);
        } else {
            $built = build_select($body['query'] ?? null, $db->schema(), 'quote_double', $params, $c['maxRows']);
        }
        try {
            $rows = $db->query($built, max(1, intdiv($c['timeoutMs'], 1000)));
        } catch (PDOException $e) {
            // Driver messages can name hosts, users and databases: logged here, never sent.
            error_log(sprintf('Query on "%s" failed: %s', $c['id'], $e->getMessage()));
            throw new ApiError(400, 'The query failed. The backend log has the details.');
        }
        $truncated = count($rows) > $built->limit;
        $rows = array_slice($rows, 0, $built->limit);
        $columns = [];
        foreach ($rows[0] ?? [] as $name => $value) {
            $columns[] = ['name' => $name, 'type' => match (true) {
                $value === null => 'unknown',
                is_bool($value) => 'boolean',
                is_int($value), is_float($value) => 'number',
                default => 'string',
            }];
        }
        respond(200, ['columns' => $columns, 'rows' => $rows, 'truncated' => $truncated]);
    }
    if ($method === 'POST' && $path === '/v1/webservice/fetch') {
        if (!$config['webServiceFetch']) {
            throw new ApiError(403, 'Web service fetching is disabled on this backend.');
        }
        $body = json_body();
        if (!is_string($body['url'] ?? null)) {
            throw new ApiError(400, 'url is required.');
        }
        [$type, $data] = guarded_fetch($body['url'], ($body['method'] ?? 'GET') === 'POST' ? 'POST' : 'GET',
            is_array($body['headers'] ?? null) ? $body['headers'] : [], is_string($body['body'] ?? null) ? $body['body'] : null, $config['fetchAllowHosts']);
        // Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
        header('Content-Type: ' . $type);
        // Someone else's content: never active on this backend's origin.
        header('Content-Security-Policy: sandbox');
        echo $data;
        exit;
    }
    throw new ApiError(404, 'Not found.');
}

try {
    handle(load_config());
} catch (ApiError $e) {
    respond($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    // Unexpected errors are logged here and never echoed: they could contain internals.
    error_log('Request failed: ' . $e);
    respond(500, ['error' => 'Internal error.']);
}
