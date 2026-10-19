// The entry point of a brand-new Angular app, replaced by CI (compat.yml) to prove that the
// published packages install, compile and bundle on every supported Angular version.
import { Component, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideWeReport, weReportLocaleTr, WeReportDesignerComponent, WeReportViewerComponent } from 'we-report-angular';
import { createBlankReport, importReport, layoutReport, ReportDefinition } from 'we-report-core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [WeReportDesignerComponent, WeReportViewerComponent],
  template: `
    <we-report-designer [(report)]="report" [data]="rows" style="height: 70vh" />
    <we-report-viewer [report]="report()" [data]="rows" />
  `,
})
class CompatApp {
  readonly report = signal<ReportDefinition>(createBlankReport('Compat'));
  readonly rows = [{ name: 'Çay', total: 12.5 }];
  // Referenced so the bundler keeps them: the whole public API must compile in the app.
  readonly api = [importReport, layoutReport];
}

bootstrapApplication(CompatApp, {
  providers: [provideWeReport({ locale: 'tr-TR', currency: 'TRY' }, weReportLocaleTr)],
}).catch((e) => console.error(e));
