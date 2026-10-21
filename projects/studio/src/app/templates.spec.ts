import { migrateDefinition } from 'we-report-core';
import businessCards from '../templates/business-cards.wrpt.json';
import cheques from '../templates/cheques.wrpt.json';
import earsiv from '../templates/earsiv-invoice.wrpt.json';
import invoice from '../templates/invoice.wrpt.json';
import labels from '../templates/labels.wrpt.json';
import letter from '../templates/letter.wrpt.json';
import orders from '../templates/orders.wrpt.json';
import sales from '../templates/sales.wrpt.json';
import salesSummary from '../templates/sales-summary.wrpt.json';
import shippingLabel from '../templates/shipping-label.wrpt.json';
import statement from '../templates/statement.wrpt.json';
import { TEMPLATES } from './templates';

describe('templates', () => {
  it('survive loading unchanged: the repair of damaged files leaves valid reports alone', () => {
    // Between them: tables, charts, a sub-report with its own report, barcodes,
    // QR codes, rich text, groups with every option, label sheets and inline data.
    for (const raw of [businessCards, cheques, earsiv, invoice, labels, letter, orders, sales, salesSummary, shippingLabel, statement]) {
      expect(migrateDefinition(structuredClone(raw))).withContext((raw as { name: string }).name).toEqual(raw as never);
    }
  });

  it('all load from their factory', () => {
    for (const t of TEMPLATES) expect(() => t.report()).withContext(t.id).not.toThrow();
  });
});
