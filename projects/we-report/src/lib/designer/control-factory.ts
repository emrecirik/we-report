import { FieldSchema, ReportControl, ReportControlType } from 'we-report-core';

export { captionFor } from 'we-report-core';

/** Toolbox entries in display order. */
export const TOOLBOX_ITEMS: { type: ReportControlType; icon: string; variant?: string }[] = [
  { type: 'text', icon: 'text' },
  { type: 'line', icon: 'line' },
  { type: 'shape', icon: 'rectangle' },
  { type: 'image', icon: 'image' },
  { type: 'barcode', icon: 'barcode' },
  { type: 'barcode', icon: 'qrcode', variant: 'qrcode' },
  { type: 'pageInfo', icon: 'pageInfo' },
  { type: 'checkbox', icon: 'checkbox' },
  { type: 'chart', icon: 'chart' },
];

/** A new control with sensible defaults, top-left corner at (x, y) mm. */
export function createControl(type: ReportControlType, id: string, x: number, y: number, text: string, variant?: string): ReportControl {
  const base = { id, x, y };
  switch (type) {
    case 'text':
      return { ...base, type, width: 40, height: 6, text };
    case 'line':
      return { ...base, type, width: 60, height: 2, direction: 'horizontal', lineWidth: 0.3 };
    case 'shape':
      return { ...base, type, width: 40, height: 20, shape: 'rectangle' };
    case 'image':
      return { ...base, type, width: 30, height: 20, source: '', fit: 'contain' };
    case 'barcode':
      return variant === 'qrcode'
        ? { ...base, type, width: 20, height: 20, symbology: 'qrcode', value: 'https://example.com', showText: false }
        : { ...base, type, width: 50, height: 15, symbology: 'code128', value: '12345678', showText: true };
    case 'pageInfo':
      return { ...base, type, width: 40, height: 6, info: 'pageNofM' };
    case 'checkbox':
      return { ...base, type, width: 5, height: 5, checked: true };
    case 'chart':
      return { ...base, type, width: 120, height: 60, chartType: 'column', category: { expression: '' }, value: { expression: '' }, showValues: true };
  }
}

/** Default display format for a data field type. */
export function formatFor(field: FieldSchema): string | undefined {
  if (field.type === 'date') return 'dd.MM.yyyy';
  return undefined;
}

/** Bracketed field reference; `parent` fields read the object around the rows (`[^.number]`). */
export function fieldExpression(path: string, parent: boolean): string {
  return `[${parent ? '^.' : ''}${path}]`;
}

