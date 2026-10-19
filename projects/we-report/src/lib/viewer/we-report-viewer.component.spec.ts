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
    expect(fixture.nativeElement.querySelector('.we-report-viewer__pages').textContent).toBe('3 sayfa');
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
});
