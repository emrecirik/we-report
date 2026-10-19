import { createBlankReport, migrateDefinition, ReportDefinition } from 'we-report-core';
import invoiceData from '../templates/invoice.data.json';
import invoice from '../templates/invoice.wrpt.json';
import receiptData from '../templates/receipt.data.json';
import receipt from '../templates/receipt.wrpt.json';
import salesData from '../templates/sales.data.json';
import sales from '../templates/sales.wrpt.json';

export interface StudioTemplate {
  id: string;
  name: { tr: string; en: string };
  report: () => ReportDefinition;
  data?: unknown;
}

export const TEMPLATES: StudioTemplate[] = [
  { id: 'invoice', name: { tr: 'Fatura', en: 'Invoice' }, report: () => migrateDefinition(structuredClone(invoice)), data: invoiceData },
  { id: 'sales', name: { tr: 'Gruplu satış raporu', en: 'Sales by city (grouped)' }, report: () => migrateDefinition(structuredClone(sales)), data: salesData },
  { id: 'receipt', name: { tr: 'Termal fiş (80 mm)', en: 'Receipt (80 mm roll)' }, report: () => migrateDefinition(structuredClone(receipt)), data: receiptData },
  { id: 'blank', name: { tr: 'Boş rapor', en: 'Blank report' }, report: () => createBlankReport() },
];
