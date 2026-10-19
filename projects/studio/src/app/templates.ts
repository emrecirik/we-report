import { createBlankReport, migrateDefinition, ReportDefinition } from 'we-report-core';
import invoiceData from '../templates/invoice.data.json';
import invoice from '../templates/invoice.wrpt.json';
import labels from '../templates/labels.wrpt.json';
import ordersData from '../templates/orders.data.json';
import orders from '../templates/orders.wrpt.json';
import receiptData from '../templates/receipt.data.json';
import receipt from '../templates/receipt.wrpt.json';
import salesData from '../templates/sales.data.json';
import sales from '../templates/sales.wrpt.json';

export interface StudioTemplate {
  id: string;
  /** Turkish and English; other languages show the English name. */
  name: { tr: string; en: string };
  description: { tr: string; en: string };
  report: () => ReportDefinition;
  data?: unknown;
}

export const TEMPLATES: StudioTemplate[] = [
  {
    id: 'invoice',
    name: { tr: 'Fatura', en: 'Invoice' },
    description: { tr: 'Logo, müşteri, kalemler, KDV ve barkod', en: 'Logo, customer, lines, VAT and a barcode' },
    report: () => migrateDefinition(structuredClone(invoice)),
    data: invoiceData,
  },
  {
    id: 'sales',
    name: { tr: 'Gruplu satış raporu', en: 'Sales by city (grouped)' },
    description: { tr: 'Gruplar, ara toplamlar, grafikler ve koşullu biçim', en: 'Groups, subtotals, charts and conditional formatting' },
    report: () => migrateDefinition(structuredClone(sales)),
    data: salesData,
  },
  {
    id: 'orders',
    name: { tr: 'Müşteri siparişleri (iç liste)', en: 'Customer orders (inner list)' },
    description: { tr: 'Her müşterinin altında siparişleri ve ara toplamı', en: 'Each customer with their orders and subtotal' },
    report: () => migrateDefinition(structuredClone(orders)),
    data: ordersData,
  },
  {
    id: 'labels',
    name: { tr: 'Raf etiketi (A4, 21’li)', en: 'Shelf labels (A4, 21 per sheet)' },
    description: { tr: 'Etiket kağıdına yan yana: ürün, fiyat ve barkod', en: 'Side by side on a label sheet: product, price and barcode' },
    report: () => migrateDefinition(structuredClone(labels)),
    data: invoiceData,
  },
  {
    id: 'receipt',
    name: { tr: 'Termal fiş (80 mm)', en: 'Receipt (80 mm roll)' },
    description: { tr: 'Sürekli rulo, içeriğe göre uzar', en: 'Continuous roll that grows with the content' },
    report: () => migrateDefinition(structuredClone(receipt)),
    data: receiptData,
  },
  {
    id: 'blank',
    name: { tr: 'Boş rapor', en: 'Blank report' },
    description: { tr: 'A4 dikey, sıfırdan tasarlayın', en: 'A4 portrait, design from scratch' },
    report: () => createBlankReport(),
  },
];
