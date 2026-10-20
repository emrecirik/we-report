import { createBlankReport } from '../definition/blank-report';
import { csvToObjects, detectDelimiter, parseCsv } from './csv';
import { ReportDefinition } from '../definition/report-definition';
import { parameterChoices, readPath, resolveReportRows } from './data-source';
import { inferSchema, inferValue } from './infer';

describe('csv', () => {
  it('parses quotes, escaped quotes, embedded newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
  });

  it('detects Excel-style semicolons and tabs', () => {
    expect(detectDelimiter('Ad;Tutar\nA;1,5')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('single')).toBe(',');
  });

  it('builds typed objects from a Turkish Excel export', () => {
    const rows = csvToObjects('﻿Ürün;Tutar;Tarih;Kod\nÇay;1.234,50;31.12.2026;00123\nŞeker;12;01.02.2026;9');
    expect(rows[0]).toEqual({ Ürün: 'Çay', Tutar: 1234.5, Tarih: new Date(2026, 11, 31), Kod: '00123' });
    expect(rows[1]['Kod']).toBe(9);
  });
});

describe('inferValue', () => {
  it('reads numbers in both conventions and keeps ambiguous text', () => {
    expect(inferValue('1,234.56')).toBe(1234.56);
    expect(inferValue('1.234,56')).toBe(1234.56);
    expect(inferValue('-12,5')).toBe(-12.5);
    expect(inferValue('0,75')).toBe(0.75);
    expect(inferValue('42')).toBe(42);
    expect(inferValue('1.234')).toBe(1.234);
    expect(inferValue('TR00 0000')).toBe('TR00 0000');
    expect(inferValue('')).toBeNull();
  });

  it('reads booleans and validates day-first dates', () => {
    expect(inferValue('Evet')).toBeTrue();
    expect(inferValue('HAYIR')).toBeFalse();
    expect(inferValue('31.02.2026')).toBe('31.02.2026');
    expect(inferValue('5/3/2026 14:30')).toEqual(new Date(2026, 2, 5, 14, 30));
  });
});

describe('inferSchema', () => {
  it('unions keys, types fields and describes nested lists', () => {
    const schema = inferSchema([
      { No: 1, Customer: { Name: 'A' }, Lines: [{ Qty: 2, Note: null }], Date: '2026-01-01', Mixed: 1 },
      { No: 2, Extra: true, Lines: [], Mixed: 'x', Logo: 'data:image/png;base64,AAA' },
    ]);
    expect(schema.map((f) => [f.name, f.type])).toEqual([
      ['No', 'number'],
      ['Customer', 'object'],
      ['Lines', 'array'],
      ['Date', 'date'],
      ['Mixed', 'string'],
      ['Extra', 'boolean'],
      ['Logo', 'image'],
    ]);
    expect(schema[2].fields).toEqual([
      { name: 'Qty', type: 'number' },
      { name: 'Note', type: 'string' },
    ]);
  });
});

describe('resolveReportRows', () => {
  it('reads rows from the bound source and path, or from host data', () => {
    const report = createBlankReport();
    expect(resolveReportRows(report)).toBeNull();
    report.dataSources.push({ id: 'd', name: 'Orders', kind: 'json', data: { data: { items: [{ a: 1 }, { a: 2 }] } } });
    report.dataMember = { dataSourceId: 'd', path: 'data.items' };
    expect(resolveReportRows(report)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(resolveReportRows(report, { data: { items: { a: 9 } } })).toEqual([{ a: 9 }]);
    report.dataSources.push({ id: 'c', name: 'Csv', kind: 'csv', text: 'x,y\n1,2' });
    report.dataMember = { dataSourceId: 'c' };
    expect(resolveReportRows(report)).toEqual([{ x: 1, y: 2 }]);
  });

  it('does not walk prototypes', () => {
    expect(readPath({}, 'constructor.name')).toBeUndefined();
  });
});

describe('parameter choices', () => {
  const report = (): ReportDefinition => ({
    ...createBlankReport(),
    dataSources: [
      { id: 'c', name: 'Customers', kind: 'json', data: [{ id: 2, name: 'Ege' }, { id: 1, name: 'Anadolu' }, { id: 2, name: 'Ege again' }, { id: null }] },
      { id: 'db', name: 'Db', kind: 'database', connectionId: 'x', sample: [{ city: 'Ankara' }] },
    ],
  });

  it('offers fixed values, each once', () => {
    expect(parameterChoices(report(), { name: 'p', type: 'string', choices: { values: ['A', 'B', 'A', ''] } })).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ]);
  });

  it('offers the values of a field of a data source, labelled by another field', () => {
    const p = { name: 'p', type: 'number' as const, choices: { dataSourceId: 'c', valueField: 'id', labelField: 'name' } };
    expect(parameterChoices(report(), p)).toEqual([
      { value: 2, label: 'Ege' },
      { value: 1, label: 'Anadolu' },
    ]);
  });

  it('reads rows inside a source: its own path, or the report rows path for the main source', () => {
    const r = report();
    r.dataSources.push({ id: 'n', name: 'Nested', kind: 'json', data: { items: [{ code: 'A' }, { code: 'B' }] } });
    expect(parameterChoices(r, { name: 'p', type: 'string', choices: { dataSourceId: 'n', path: 'items', valueField: 'code' } }).map((c) => c.value)).toEqual(['A', 'B']);
    r.dataMember = { dataSourceId: 'n', path: 'items' };
    expect(parameterChoices(r, { name: 'p', type: 'string', choices: { dataSourceId: 'n', valueField: 'code' } }).map((c) => c.value)).toEqual(['A', 'B']);
  });

  it('uses loaded responses over samples, and nothing for an unknown source or no list', () => {
    const p = { name: 'p', type: 'string' as const, choices: { dataSourceId: 'db', valueField: 'city' } };
    expect(parameterChoices(report(), p).map((c) => c.value)).toEqual(['Ankara']);
    expect(parameterChoices(report(), p, { db: [{ city: 'İzmir' }] }).map((c) => c.value)).toEqual(['İzmir']);
    expect(parameterChoices(report(), { name: 'p', type: 'string', choices: { dataSourceId: 'nope', valueField: 'x' } })).toEqual([]);
    expect(parameterChoices(report(), { name: 'p', type: 'string' })).toEqual([]);
  });
});
