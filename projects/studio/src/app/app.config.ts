import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideWeReport } from 'we-report-angular';

export const appConfig: ApplicationConfig = {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideWeReport({ locale: 'tr-TR', currency: 'TRY' })],
};
