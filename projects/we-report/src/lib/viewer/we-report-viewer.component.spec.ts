import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createBlankReport, LayoutDocument, ReportDefinition } from 'we-report-core';
import { provideWeReport } from '../we-report-config';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WE_REPORT_LOCALE, weReportLocaleTr } from '../we-report-locale';
import { WeReportViewerComponent } from './we-report-viewer.component';

function listReport(): ReportDefinition {
  const report = createBlankReport('Liste');
  report.dataSources.push({ id: 'd', name: 'd', kind: 'json', data: [] });
  report.dataMember = { dataSourceId: 'd' };
  report.bands[1].controls.push({ id: 'n', type: 'text', x: 0, y: 1, width: 80, height: 6, text: { expression: '[name]' } });
  report.bands[2].controls.push({ id: 'p', type: 'pageInfo', x: 120, y: 2, width: 60, height: 6, info: 'pageNofM' });
  return report;
}

describe('WeReportViewerComponent', () => {
  let fixture: ComponentFixture<WeReportViewerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WeReportViewerComponent],
      providers: [provideWeReport({ locale: 'tr-TR', currency: 'TRY' }), { provide: WE_REPORT_LOCALE, useValue: weReportLocaleTr }],
    });
    fixture = TestBed.createComponent(WeReportViewerComponent);
  });

  async function render(report: ReportDefinition, data?: unknown): Promise<LayoutDocument> {
    const rendered = new Promise<LayoutDocument>((resolve) => fixture.componentInstance.rendered.subscribe(resolve));
    fixture.componentRef.setInput('report', report);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    const doc = await rendered;
    fixture.detectChanges();
    return doc;
  }

  it('lays out with the bundled fonts and draws every page as SVG', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ name: `Satır ${i + 1}` }));
    const doc = await render(listReport(), rows);
    expect(doc.pages.length).toBe(3);
    const pages = fixture.nativeElement.querySelectorAll('svg.we-report-page');
    expect(pages.length).toBe(3);
    const texts = Array.from(pages[0].querySelectorAll('text')).map((t) => (t as SVGTextElement).textContent);
    expect(texts[0]).toBe('Satır 1');
    expect(texts).toContain('1 / 3');
    expect(fixture.nativeElement.querySelector('.we-report-viewer__pagebox').value).toBe('1');
    expect(fixture.nativeElement.querySelector('.we-report-viewer__pages').textContent).toBe('/ 3');

    // Find in report: every line containing the text is highlighted, case-insensitively.
    const search = fixture.nativeElement.querySelector('.we-report-viewer__search') as HTMLInputElement;
    search.value = 'SATIR 1';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.we-report-page__hit').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('.we-report-page__hit--current').length).toBe(1);

    // Keyboard paging: End goes to the last page, Home back to the first.
    const scroller = fixture.nativeElement.querySelector('.we-report-viewer__scroll') as HTMLElement;
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.we-report-viewer__pagebox').value).toBe('3');
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.we-report-viewer__pagebox').value).toBe('1');
  });

  it('offers a parameter list from a data field and reruns with the picked value', async () => {
    const report = listReport();
    report.dataSources.push({ id: 'cities', name: 'Cities', kind: 'json', data: [{ code: 6, name: 'Ankara' }, { code: 35, name: 'İzmir' }] });
    report.parameters = [{ name: 'city', type: 'number', defaultValue: 6, choices: { dataSourceId: 'cities', valueField: 'code', labelField: 'name' } }];
    report.bands[1].controls[0] = { id: 'n', type: 'text', x: 0, y: 1, width: 80, height: 6, text: { expression: "'City ' + [?city]" } };
    await render(report, [{ name: 'x' }]);
    const select = fixture.nativeElement.querySelector('.we-report-viewer__params select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['—', 'Ankara', 'İzmir']);
    expect(select.value).toBe('6');
    const rendered = new Promise<LayoutDocument>((resolve) => fixture.componentInstance.rendered.subscribe(resolve));
    select.value = '35';
    select.dispatchEvent(new Event('change'));
    (fixture.nativeElement.querySelector('.we-report-viewer__params button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const doc = await rendered;
    const texts = doc.pages[0].items.filter((i) => i.kind === 'text').map((t) => (t as { lines: { text: string }[] }).lines[0]?.text);
    expect(texts).toContain('City 35');
  });

  it('uses the prefixed font family so an installed font cannot replace the measured one', async () => {
    await render(listReport(), [{ name: 'x' }]);
    const text = fixture.nativeElement.querySelector('svg.we-report-page text') as SVGTextElement;
    expect(text.getAttribute('font-family')).toBe(`'${WeReportFontsService.cssFamily('Noto Sans')}'`);
  });

  it('shows layout problems instead of failing', async () => {
    const report = listReport();
    report.bands[1].controls.push({ id: 'bad', type: 'text', x: 0, y: 0, width: 10, height: 5, text: { expression: '1 +' } });
    const doc = await render(report, [{ name: 'x' }]);
    expect(doc.problems.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.we-report-viewer__problems summary').textContent).toContain('Sorunlar (1)');
  });

  it('exports the previewed rows to Excel', async () => {
    await render(listReport(), [{ name: 'Çay' }, { name: 'Şeker' }]);
    const bytes = fixture.componentInstance.toXlsx();
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    expect(new TextDecoder().decode(bytes)).toContain('Şeker');
  });

  it('produces PDF bytes of the current preview', async () => {
    await render(listReport(), [{ name: 'x' }]);
    const bytes = await fixture.componentInstance.toPdf();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('fetches pictures from addresses and shows them; a failed one is a problem', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const asked: string[] = [];
    fixture.componentRef.setInput('fetchFn', (async (url: string) => {
      asked.push(url);
      return url.endsWith('ok.png') ? new Response(new Blob([png], { type: 'image/png' })) : new Response('', { status: 404 });
    }) as unknown as typeof fetch);
    const report = listReport();
    report.bands[1].controls = [{ id: 'img', type: 'image', x: 0, y: 0, width: 10, height: 6, source: { expression: '[name]' }, fit: 'contain' }];
    const rendered = new Promise<LayoutDocument>((resolve) => fixture.componentInstance.rendered.subscribe(resolve));
    fixture.componentRef.setInput('report', report);
    fixture.componentRef.setInput('data', [{ name: 'https://example.com/ok.png' }, { name: 'https://example.com/missing.png' }]);
    fixture.detectChanges();
    const doc = await rendered;
    expect(asked.sort()).toEqual(['https://example.com/missing.png', 'https://example.com/ok.png']);
    expect(doc.pages[0].items.filter((i) => i.kind === 'image').length).toBe(1);
    expect(doc.problems.some((p) => p.message.includes('missing.png'))).toBeTrue();
  });

  it('makes label and receipt printer files of every page', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ name: `Satır ${i + 1}` }));
    const doc = await render(listReport(), rows);
    const zpl = await fixture.componentInstance.toZpl(203);
    expect(zpl.match(/\^XA/g)!.length).toBe(doc.pages.length);
    expect(zpl).toContain(`^PW${Math.round((doc.pages[0].width * 203) / 25.4)}^`);
    expect(zpl).toMatch(/\^GFA,\d+,\d+,\d+,[0-9A-F]*[1-9A-F][0-9A-F]*\^FS/); // some black dots
    const escpos = await fixture.componentInstance.toEscPos(384);
    expect(Array.from(escpos.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(escpos[6]).toBe(48); // 384 dots = 48 bytes per row
  });

  it('draws a page as a PNG at the asked resolution, text where the layout put it', async () => {
    const doc = await render(listReport(), [{ name: 'WWWWWWWWWW' }]);
    const blob = await fixture.componentInstance.toPng(0, 96);
    expect(blob.type).toBe('image/png');
    const bitmap = await createImageBitmap(blob);
    expect(bitmap.width).toBe(Math.round((doc.pages[0].width * 96) / 25.4));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const text = doc.pages[0].items.find((i) => i.kind === 'text')! as { x: number; y: number; width: number; height: number };
    const px = 96 / 25.4;
    const box = ctx.getImageData(Math.round(text.x * px), Math.round(text.y * px), Math.round(30 * px), Math.round(text.height * px)).data;
    const dark = Array.from({ length: box.length / 4 }, (_, i) => box[i * 4]).filter((r) => r < 128).length;
    expect(dark).toBeGreaterThan(20);
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    expect(Array.from(corner)).toEqual([255, 255, 255, 255]);
  });
});
