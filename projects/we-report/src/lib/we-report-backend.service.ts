import { inject, Injectable, signal } from '@angular/core';
import { WE_REPORT_CONFIG } from './we-report-config';

/**
 * The data backend address used for database sources and proxied web services. Starts from
 * `provideWeReport({ backendUrl })`; the designer lets the user change it (e.g. the public Studio).
 */
@Injectable({ providedIn: 'root' })
export class WeReportBackendService {
  readonly url = signal(inject(WE_REPORT_CONFIG).backendUrl ?? '');
}
