import { createBlankReport, DataSourceDefinition, ReportDefinition } from 'we-report-core';
import { decodeShare, encodeShare, hasRemoteSources, SHARE_PREFIX } from './share-link';

function withSources(...sources: DataSourceDefinition[]): ReportDefinition {
  return { ...createBlankReport(), dataSources: sources };
}

async function gzipBase64Url(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('share link', () => {
  it('round-trips a design and its data', async () => {
    const payload = { report: { name: 'Fatura ğüşiöç', items: [1, 2, 3] }, data: [{ a: 'x'.repeat(5000) }] };
    const hash = await encodeShare(payload);
    expect(hash.startsWith(SHARE_PREFIX)).toBeTrue();
    expect(hash.slice(SHARE_PREFIX.length)).not.toMatch(/[+/=]/);
    expect(await decodeShare(hash)).toEqual(payload);
  });

  it('rejects a hash that is not a share link', async () => {
    await expectAsync(decodeShare('#other')).toBeRejected();
  });

  it('rejects a corrupt payload', async () => {
    await expectAsync(decodeShare(SHARE_PREFIX + 'not-gzip-at-all')).toBeRejected();
    const hash = await encodeShare({ report: {} });
    await expectAsync(decodeShare(hash.slice(0, -6))).toBeRejected();
  });

  it('refuses a payload that decompresses beyond 10 MB', async () => {
    const bomb = SHARE_PREFIX + (await gzipBase64Url(' '.repeat(11 * 1024 * 1024)));
    await expectAsync(decodeShare(bomb)).toBeRejectedWithError(/too large/);
  });

  it('spots reports that call a web service or database', () => {
    const json: DataSourceDefinition = { id: 'j', name: 'J', kind: 'json', data: [] };
    const web: DataSourceDefinition = { id: 'w', name: 'W', kind: 'webService', url: 'https://example.com' };
    expect(hasRemoteSources(withSources(json, { id: 'c', name: 'C', kind: 'csv', text: 'a' }))).toBeFalse();
    expect(hasRemoteSources(withSources(web))).toBeTrue();
    expect(hasRemoteSources(withSources({ id: 'd', name: 'D', kind: 'database', connectionId: 'x' }))).toBeTrue();
    // Hidden in a sub-report.
    const outer = withSources(json);
    outer.bands[1].controls.push({ id: 's', type: 'subreport', x: 0, y: 0, width: 50, height: 10, report: withSources(web) });
    expect(hasRemoteSources(outer)).toBeTrue();
  });
});
