import { createBlankReport } from 'we-report-core';
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
