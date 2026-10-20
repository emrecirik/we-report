/** A design in the address bar: `#r=` + gzip + base64url of `{ report, data }`. No server involved. */
export const SHARE_PREFIX = '#r=';

/** Links decompress to at most this much; anything bigger is refused (a crafted link cannot exhaust memory). */
const MAX_BYTES = 10 * 1024 * 1024;

/** Browsers cut longer addresses (Chrome's limit is 2 MB), so a longer link would not open. */
export const MAX_SHARE_URL = 2_000_000;

/** True when the report pulls data from a web service or database: opening a shared one calls that address. */
export function hasRemoteSources(report: { dataSources?: { kind: string }[] }): boolean {
  return !!report.dataSources?.some((d) => d.kind === 'webService' || d.kind === 'database');
}

export async function encodeShare(payload: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return SHARE_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The payload of a share hash; throws when the hash is not one. */
export async function decodeShare(hash: string): Promise<unknown> {
  if (!hash.startsWith(SHARE_PREFIX)) throw new Error('Not a shared design.');
  const base64 = hash.slice(SHARE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('The shared design is too large.');
    }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
}
