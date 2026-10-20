import { createBlankReport, migrateDefinition, ReportDefinition } from 'we-report-core';
import certificate from '../templates/certificate.wrpt.json';
import deliveryNote from '../templates/delivery-note.wrpt.json';
import invoiceData from '../templates/invoice.data.json';
import invoice from '../templates/invoice.wrpt.json';
import labels from '../templates/labels.wrpt.json';
import ordersData from '../templates/orders.data.json';
import paymentReceiptData from '../templates/payment-receipt.data.json';
import paymentReceipt from '../templates/payment-receipt.wrpt.json';
import shippingLabelData from '../templates/shipping-label.data.json';
import shippingLabel from '../templates/shipping-label.wrpt.json';
import statement from '../templates/statement.wrpt.json';
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
    id: 'delivery-note',
    name: { tr: 'Sevk irsaliyesi', en: 'Delivery note' },
    description: { tr: 'Sıra no, miktar, imza alanları; faturayla aynı veri', en: 'Row numbers, quantities and signature lines; same data as the invoice' },
    report: () => migrateDefinition(structuredClone(deliveryNote)),
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
    id: 'statement',
    name: { tr: 'Müşteri ekstresi (alt rapor)', en: 'Customer statement (sub-report)' },
    description: { tr: 'Her müşterinin altında başka tablodaki hareketleri, toplam ve bakiye', en: 'Each customer with their entries from another table, totals and balance' },
    report: () => migrateDefinition(structuredClone(statement)),
  },
  {
    id: 'payment-receipt',
    name: { tr: 'Tahsilat makbuzu (A5)', en: 'Payment receipt (A5)' },
    description: { tr: 'Yazıyla tutar, ödeme şekli ve imza alanları', en: 'Amount in words, payment method and signature lines' },
    report: () => migrateDefinition(structuredClone(paymentReceipt)),
    data: paymentReceiptData,
  },
  {
    id: 'shipping-label',
    name: { tr: 'Kargo etiketi (100×150)', en: 'Shipping label (100×150)' },
    description: { tr: 'Termal etiket: alıcı, şube, barkod ve QR', en: 'Thermal label: receiver, branch, barcode and QR' },
    report: () => migrateDefinition(structuredClone(shippingLabel)),
    data: shippingLabelData,
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
    id: 'certificate',
    name: { tr: 'Başarı belgesi', en: 'Certificate' },
    description: { tr: 'Parametrelerle doldurulan tek sayfa: ad, eğitim, tarih', en: 'One page filled from parameters: name, course, date' },
    report: () => migrateDefinition(structuredClone(certificate)),
  },
  {
    id: 'blank',
    name: { tr: 'Boş rapor', en: 'Blank report' },
    description: { tr: 'A4 dikey, sıfırdan tasarlayın', en: 'A4 portrait, design from scratch' },
    report: () => createBlankReport(),
  },
];
