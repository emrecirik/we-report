import { TableControl } from 'we-report-core';
import { cellAt, columnOf, deleteColumn, insertColumn, insertRow, mergeRight, splitCell } from './table-ops';
import { buildCondition, parseCondition } from './formatting-rule';
import { createBlankReport } from 'we-report-core';
import { CLIPBOARD_MARKER } from './designer-state';
import { captionFor } from './control-factory';
import { designerFields } from './designer-fields';
import { DesignerState } from './designer-state';

describe('DesignerState', () => {
  let state: DesignerState;

  beforeEach(() => {
    state = new DesignerState();
    state.load(createBlankReport());
  });

  const text = (id: string) => ({ id, type: 'text' as const, x: 0, y: 0, width: 10, height: 5, text: id });

  it('makes every edit undoable and redoable without mutating the previous document', () => {
    const original = state.report();
    state.addControls('detail', [text('a')]);
    expect(state.report().bands[1].controls.length).toBe(1);
    expect(original.bands[1].controls.length).toBe(0);
    expect(state.canUndo()).toBeTrue();
    state.undo();
    expect(state.report()).toBe(original);
    expect(state.canRedo()).toBeTrue();
    state.redo();
    expect(state.report().bands[1].controls[0].id).toBe('a');
  });

  it('tidies up: grid, rows, columns and one height per row of texts, in one undo step', () => {
    state.addControls('detail', [
      { ...text('a'), x: 0.4, y: 1.2, width: 30.3, height: 5.2 },
      { ...text('b'), x: 40.6, y: 2.4, width: 29.6, height: 6.1 },
      { ...text('c'), x: 1.3, y: 12.7, width: 30, height: 5 },
      { id: 'l', type: 'line', x: 0.2, y: 20.3, width: 70.4, height: 0.6, direction: 'horizontal', lineWidth: 0.3 },
    ]);
    const before = state.report();
    state.tidy(['a', 'b', 'c', 'l'], 1);
    const [a, b, c, l] = state.report().bands[1].controls;
    expect([a.x, a.y, a.width, a.height]).toEqual([0, 1, 30, 6]); // tallest of its row, snapped
    expect([b.x, b.y, b.width, b.height]).toEqual([41, 1, 30, 6]);
    expect([c.x, c.y]).toEqual([0, 13]); // same column as a
    expect([l.x, l.y, l.height]).toEqual([0, 20, 0.6]); // a line keeps its thickness
    state.undo();
    expect(state.report()).toBe(before);
  });

  it('coalesces a burst of edits with the same key into one undo step', () => {
    state.addControls('detail', [text('a')]);
    for (let i = 1; i <= 5; i++) state.updateControls(['a'], (c) => (c.x = i), 'drag1');
    expect(state.report().bands[1].controls[0].x).toBe(5);
    state.undo();
    expect(state.report().bands[1].controls[0].x).toBe(0);
  });

  it('shares data source payloads between snapshots instead of copying them', () => {
    const big = { rows: new Array(1000).fill({ a: 1 }) };
    state.load({ ...createBlankReport(), dataSources: [{ id: 'd', name: 'd', kind: 'json', data: big }] });
    state.update((d) => (d.name = 'x'));
    expect(state.report().dataSources[0]).toBe(state.report().dataSources[0]);
    expect((state.report().dataSources[0] as { data: unknown }).data).toBe(big);
  });

  it('creates unique ids, duplicates and deletes the selection', () => {
    state.addControls('detail', [text('text1')]);
    expect(state.newId('text')).toBe('text2');
    state.duplicateSelection();
    const controls = state.report().bands[1].controls;
    expect(controls.map((c) => c.id)).toEqual(['text1', 'text2']);
    expect(controls[1].x).toBe(3);
    state.deleteSelection();
    expect(state.report().bands[1].controls.map((c) => c.id)).toEqual(['text1']);
    expect(state.selection().kind).toBe('none');
  });

  it('gives every duplicated item its own id', () => {
    state.addControls('detail', [text('text1'), text('text2')]);
    state.selection.set({ kind: 'controls', ids: ['text1', 'text2'] });
    state.duplicateSelection();
    expect(state.report().bands[1].controls.map((c) => c.id)).toEqual(['text1', 'text2', 'text3', 'text4']);
  });

  it('removes a group footer together with its header and prunes selection on undo', () => {
    state.update((d) => {
      d.bands.splice(1, 0, { id: 'g', kind: 'groupHeader', height: 8, controls: [] });
      d.bands.splice(3, 0, { id: 'gf', kind: 'groupFooter', groupHeaderId: 'g', height: 8, controls: [] });
    });
    state.removeBand('g');
    expect(state.report().bands.map((b) => b.id)).toEqual(['pageHeader', 'detail', 'pageFooter']);
    state.addControls('detail', [text('a')]);
    state.undo();
    expect(state.selection().kind).toBe('none');
  });

  it('narrows or extends the selection like a desktop designer', () => {
    state.addControls('detail', [text('a'), text('b')]);
    state.select('a', false);
    expect(state.selection()).toEqual({ kind: 'controls', ids: ['a', 'b'] }); // already selected: keep for dragging
    state.selection.set({ kind: 'none' });
    state.select('a', false);
    state.select('b', true);
    expect(state.selection()).toEqual({ kind: 'controls', ids: ['a', 'b'] });
    state.select('a', true);
    expect(state.selection()).toEqual({ kind: 'controls', ids: ['b'] });
  });

  const box = (id: string, x: number, y: number, width = 10, height = 5) => ({ id, type: 'text' as const, x, y, width, height, text: id });
  const ctl = (id: string) => state.report().bands.flatMap((b) => b.controls).find((c) => c.id === id)!;

  it('aligns, distributes and sizes the selection against the first selected control', () => {
    state.addControls('detail', [box('a', 10, 2, 20, 6), box('b', 50, 9), box('c', 30, 1)]);
    state.selection.set({ kind: 'controls', ids: ['a', 'b', 'c'] });
    state.align('right');
    expect([ctl('a').x, ctl('b').x, ctl('c').x]).toEqual([10, 20, 20]);
    state.align('middle');
    expect([ctl('b').y, ctl('c').y]).toEqual([2.5, 2.5]);
    state.sameSize('width');
    expect(ctl('b').width).toBe(20);
    state.updateControls(['a', 'b', 'c'], (c) => (c.width = 10));
    state.updateControls(['b'], (c) => (c.x = 70));
    state.updateControls(['c'], (c) => (c.x = 30));
    state.distribute('h');
    expect([ctl('a').x, ctl('c').x, ctl('b').x]).toEqual([10, 40, 70]);
  });

  it('pastes items from the system clipboard only when they are well-formed', () => {
    state.addControls('detail', [text('text1')]);
    state.selection.set({ kind: 'controls', ids: ['text1'] });
    state.copySelection();
    const ours = state.clipboardText();
    expect(state.loadClipboard('plain text')).toBeFalse();
    expect(state.loadClipboard(CLIPBOARD_MARKER + '[{"control":{"id":"a","type":"table","x":"10","y":0,"width":5,"height":5}}]')).toBeFalse();
    expect(state.loadClipboard(CLIPBOARD_MARKER + '[{"control":{"id":"a","type":"table","x":1,"y":0,"width":5,"height":5}}]')).toBeFalse();
    expect(state.loadClipboard(CLIPBOARD_MARKER + '[{"control":{"id":"a","type":"script","x":1,"y":0,"width":5,"height":5}}]')).toBeFalse();
    expect(state.loadClipboard(CLIPBOARD_MARKER + '{oops')).toBeFalse();
    expect(state.loadClipboard(ours)).toBeTrue();
    state.paste();
    expect(state.report().bands[1].controls.map((c) => c.id)).toEqual(['text1', 'text2']);
  });

  it('copies, pastes with an offset over the original and arranges the draw order', () => {
    state.addControls('detail', [box('a', 1, 1), box('b', 5, 1)]);
    state.selection.set({ kind: 'controls', ids: ['a'] });
    state.copySelection();
    state.paste();
    const pasted = state.selectedControls()[0];
    expect(pasted.id).not.toBe('a');
    expect([pasted.x, pasted.y]).toEqual([4, 4]);
    state.selection.set({ kind: 'controls', ids: ['a'] });
    state.arrange('front');
    expect(state.report().bands[1].controls.map((c) => c.id).at(-1)).toBe('a');
    state.cutSelection();
    expect(state.report().bands[1].controls.some((c) => c.id === 'a')).toBeFalse();
    state.paste('pageHeader');
    expect(state.report().bands[0].controls.map((c) => [c.x, c.y])).toEqual([[1, 1]]);
  });

  it('selects every control of the band in focus', () => {
    state.addControls('detail', [box('a', 1, 1), box('b', 5, 1)]);
    state.selection.set({ kind: 'band', id: 'detail' });
    state.selectAll();
    expect(state.selectedControls().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('formats the selection like a format bar: a clicked table cell, else every selected item', () => {
    state.addControls('detail', [box('a', 0, 0), box('b', 20, 0)]);
    state.selection.set({ kind: 'controls', ids: ['a', 'b'] });
    state.applyStyle('bold', true);
    expect([ctl('a').styleOverrides?.bold, ctl('b').styleOverrides?.bold]).toEqual([true, true]);
    state.applyStyle('bold', undefined);
    expect(ctl('a').styleOverrides).toBeUndefined();

    const table = { id: 't', type: 'table' as const, x: 0, y: 10, width: 40, height: 6, columns: [20, 20], rows: [{ height: 6, cells: [{ text: 'x' }, { text: 'y' }] }] };
    state.addControls('detail', [table]);
    state.tableCell.set({ controlId: 't', row: 0, cell: 1 });
    state.applyStyle('color', '#ff0000');
    const t = ctl('t') as typeof table & { styleOverrides?: unknown };
    expect(t.rows[0].cells.map((c) => (c as { styleOverrides?: { color?: string } }).styleOverrides?.color)).toEqual([undefined, '#ff0000']);
    expect(t.styleOverrides).toBeUndefined();
  });

  it('resizes with the keyboard and tabs through items top to bottom, left to right', () => {
    state.addControls('detail', [box('right', 30, 0), box('below', 0, 5), box('left', 0, 0)]);
    state.selection.set({ kind: 'controls', ids: ['left'] });
    state.resizeSelection(5, -10);
    expect([ctl('left').width, ctl('left').height]).toEqual([15, 1]);
    state.selectNext(1);
    expect(state.selectedControls()[0].id).toBe('right');
    state.selectNext(1);
    expect(state.selectedControls()[0].id).toBe('below');
    state.selectNext(-1);
    state.selectNext(-1);
    expect(state.selectedControls()[0].id).toBe('left');
  });
});

describe('designer helpers', () => {
  it('turns field names into captions', () => {
    expect(captionFor('unitPrice')).toBe('Unit price');
    expect(captionFor('customer_name')).toBe('Customer name');
    expect(captionFor('müşteriAdı')).toBe('Müşteri adı');
  });

  it('lists row fields and the document fields around nested rows', () => {
    const report = createBlankReport();
    report.dataMember = { dataSourceId: 'x', path: 'lines' };
    const { rows, parent } = designerFields(report, { number: 'A1', customer: { name: 'X' }, lines: [{ qty: 1 }] });
    expect(rows.map((f) => f.expression)).toEqual(['[qty]']);
    expect(parent.map((f) => f.expression)).toEqual(['[^.number]', '[^.customer]', '[^.customer.name]']);
  });

});

describe('formatting rule conditions', () => {
  it('builds formulas without the user typing one and reads them back', () => {
    expect(buildCondition({ field: '[Amount]', op: '<', value: '0' })).toBe('[Amount] < 0');
    expect(buildCondition({ field: '[City]', op: '=', value: "Kuşadası'nın" })).toBe("[City] = 'Kuşadası''nın'");
    expect(buildCondition({ field: '[Name]', op: 'contains', value: 'Ltd' })).toBe("Contains([Name], 'Ltd')");
    expect(parseCondition("[City] = 'Kuşadası''nın'")).toEqual({ field: '[City]', op: '=', value: "Kuşadası'nın" });
    expect(parseCondition("Contains([Name], 'Ltd')")).toEqual({ field: '[Name]', op: 'contains', value: 'Ltd' });
    expect(parseCondition('[a] <> 3')).toEqual({ field: '[a]', op: '!=', value: '3' });
    expect(parseCondition('[a] + [b] > 3')).toBeNull();
    expect(parseCondition('Iif([a], 1, 2)')).toBeNull();
    expect(parseCondition('[a] = 3 and [b]')).toBeNull();
  });
});

describe('table editing', () => {
  const table = (): TableControl => ({
    id: 't', type: 'table', x: 0, y: 0, width: 60, height: 12, columns: [20, 20, 20],
    rows: [
      { height: 6, cells: [{ text: 'A', colSpan: 2 }, { text: 'B' }] },
      { height: 6, cells: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    ],
  });
  const texts = (t: TableControl) => t.rows.map((r) => r.cells.map((c) => `${c.text}${c.colSpan ? '×' + c.colSpan : ''}`));

  it('inserts and deletes columns, widening or narrowing spanning cells', () => {
    const t = table();
    insertColumn(t, 0); // inside the A span: A widens, row 2 gets a new cell
    expect(texts(t)).toEqual([['A×3', 'B'], ['1', '', '2', '3']]);
    expect(t.width).toBe(80);
    deleteColumn(t, 1);
    expect(texts(t)).toEqual([['A×2', 'B'], ['1', '2', '3']]);
    deleteColumn(t, 0);
    deleteColumn(t, 0);
    expect(texts(t)).toEqual([['B'], ['3']]);
    deleteColumn(t, 0); // the last column stays
    expect(t.columns.length).toBe(1);
  });

  it('inserts rows with the same layout, merges and splits cells', () => {
    const t = table();
    insertRow(t, 0);
    expect(texts(t)[1]).toEqual(['×2', '']);
    expect(t.height).toBe(18);
    mergeRight(t, 2, 1);
    expect(texts(t)[2]).toEqual(['1', '2×2']);
    splitCell(t, 2, 1);
    expect(texts(t)[2]).toEqual(['1', '2', '']);
    expect(columnOf(t.rows[0], 1)).toBe(2);
    expect(cellAt(t.rows[0], 1)).toBe(0);
  });
});
