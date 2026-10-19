import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { WE_REPORT_ICONS, WeReportIcons } from './we-report-icons';

/** `<span [innerHTML]="'print' | weReportIcon"></span>` — icons are trusted constants from the token, never report content. */
@Pipe({ name: 'weReportIcon', standalone: true })
export class WeReportIconPipe implements PipeTransform {
  private readonly icons = inject(WE_REPORT_ICONS);
  private readonly sanitizer = inject(DomSanitizer);

  transform(name: keyof WeReportIcons): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.icons[name] ?? '');
  }
}
