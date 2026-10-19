// Fetches a URL for a report while refusing internal addresses (SSRF protection). The address
// is checked inside the socket's DNS lookup, so a hostname cannot resolve differently between the
// check and the connection (DNS rebinding), and IP literals are checked before connecting.
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpError } from './query.mjs';

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // IPv4 inside IPv6 — mapped (::ffff:a.b.c.d, or the hex form ::ffff:7f00:1 that URL produces)
    // and NAT64 (64:ff9b::) — is judged by its IPv4 address.
    const embedded = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(lower);
    if (embedded) {
      if (embedded[1]) return isBlockedAddress(embedded[1]);
      const hi = parseInt(embedded[2], 16);
      const lo = parseInt(embedded[3], 16);
      return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // Anything else starting with "::" is unspecified, loopback or a deprecated IPv4-compatible form.
    return lower.startsWith('::') || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
  }
  return true;
}

function guardedLookup(allowHosts) {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const allowed = allowHosts.has(hostname.toLowerCase());
      if (!allowed && addresses.some((a) => isBlockedAddress(a.address))) {
        return callback(new HttpError(403, `Refusing to fetch ${hostname}: it resolves to an internal address.`));
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * @returns {Promise<{status: number, contentType: string, body: Buffer}>}
 */
export function guardedFetch(request, { allowHosts = new Set(), maxBytes = 5 * 1024 * 1024, timeoutMs = 10_000, maxRedirects = 3 } = {}) {
  const { method = 'GET', body } = request;
  // One deadline for the whole fetch, redirects and a slowly dripping body included.
  const deadline = Date.now() + timeoutMs;
  const origin = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      return '';
    }
  })();
  const visit = (rawUrl, redirectsLeft) =>
    new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        return reject(new HttpError(400, 'Invalid URL.'));
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new HttpError(400, 'Only http and https URLs can be fetched.'));
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(host) && isBlockedAddress(host) && !allowHosts.has(host)) {
        return reject(new HttpError(403, `Refusing to fetch ${host}: internal address.`));
      }
      // The caller's headers (Authorization, cookies) are for the original site only.
      const headers = url.origin === origin ? (request.headers ?? []) : [];
      const outHeaders = {};
      for (const h of headers) if (h?.name) outHeaders[String(h.name)] = String(h.value ?? '');
      const left = deadline - Date.now();
      if (left <= 0) return reject(new HttpError(504, 'The web service did not answer in time.'));
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method: method === 'POST' ? 'POST' : 'GET',
        headers: outHeaders,
        lookup: guardedLookup(allowHosts),
      });
      const timer = setTimeout(() => req.destroy(new HttpError(504, 'The web service did not answer in time.')), left);
      req.on('close', () => clearTimeout(timer));
      req.on('error', (e) => reject(e instanceof HttpError ? e : new HttpError(502, `Could not reach the web service: ${e.message}`)));
      req.on('response', (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new HttpError(502, 'Too many redirects.'));
          // Each hop is checked again by `visit`.
          return resolve(visit(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new HttpError(502, `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`));
          } else {
            chunks.push(chunk);
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] ?? 'application/octet-stream', body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      if (method === 'POST' && body) req.write(String(body));
      req.end();
    });
  return visit(request.url, maxRedirects);
}
