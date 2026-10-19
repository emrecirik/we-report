import { computed, Injectable, signal } from '@angular/core';
import { Band, createBlankReport, ReportControl, ReportDefinition } from 'we-report-core';
import { TableCellRef } from './table-ops';

export type Selection = { kind: 'none' } | { kind: 'controls'; ids: string[] } | { kind: 'band'; id: string };

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Module-wide, so copy in one designer and paste in another on the same page works. */
let clipboard: { bandKind: Band['kind']; control: ReportControl }[] = [];

const round = (v: number) => Math.round(v * 100) / 100;

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

/** Copies the editable parts; data source payloads (possibly large) are shared, never mutated. */
function cloneForEdit(def: ReportDefinition): ReportDefinition {
  return {
    ...def,
    page: structuredClone(def.page),
    styles: structuredClone(def.styles),
    bands: structuredClone(def.bands),
    dataSources: [...def.dataSources],
    dataMember: def.dataMember ? { ...def.dataMember } : undefined,
  };
}

/**
 * The designer's document, selection and undo history. Every edit goes through `update`, which
 * snapshots the previous state — so every edit is undoable and observable.
 */
@Injectable()
export class DesignerState {
  readonly report = signal<ReportDefinition>(createBlankReport());
  readonly selection = signal<Selection>({ kind: 'none' });
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  /** The table cell last clicked; the inspector edits it while its table is selected. */
  readonly tableCell = signal<TableCellRef | null>(null);
  /** The first data row and its scope, for live values in the design and the formula editor. */
  readonly sample = signal<{ row: unknown; rows: readonly unknown[]; parent: unknown } | null>(null);

  readonly selectedControls = computed(() => {
    const sel = this.selection();
    if (sel.kind !== 'controls') return [];
    return this.report().bands.flatMap((b) => b.controls.filter((c) => sel.ids.includes(c.id)));
  });
  readonly selectedBand = computed(() => {
    const sel = this.selection();
    return sel.kind === 'band' ? (this.report().bands.find((b) => b.id === sel.id) ?? null) : null;
  });

  private past: ReportDefinition[] = [];
  private future: ReportDefinition[] = [];
  private lastKey: string | undefined;
  private lastTime = 0;

  /** Replaces the document and clears history (a new report was opened). */
  load(report: ReportDefinition): void {
    this.report.set(report);
    this.past = [];
    this.future = [];
    this.lastKey = undefined;
    this.selection.set({ kind: 'none' });
    this.syncFlags();
  }

  /**
   * Applies an edit to a copy of the document. Consecutive edits with the same `coalesce` key
   * (typing in a field, dragging) within a moment become one undo step.
   */
  update(mutate: (draft: ReportDefinition) => void, coalesce?: string): void {
    const current = this.report();
    const next = cloneForEdit(current);
    mutate(next);
    const now = Date.now();
    const merge = coalesce !== undefined && coalesce === this.lastKey && now - this.lastTime < COALESCE_MS;
    if (!merge) {
      this.past.push(current);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastKey = coalesce;
    this.lastTime = now;
    this.future = [];
    this.report.set(next);
    this.syncFlags();
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.report());
    this.report.set(previous);
    this.lastKey = undefined;
    this.pruneSelection();
    this.syncFlags();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.report());
    this.report.set(next);
    this.lastKey = undefined;
    this.pruneSelection();
    this.syncFlags();
  }

  /** A new id not used by any band or control. */
  newId(prefix: string): string {
    const used = new Set(this.report().bands.flatMap((b) => [b.id, ...b.controls.map((c) => c.id)]));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  findBandOf(controlId: string, def = this.report()): Band | undefined {
    return def.bands.find((b) => b.controls.some((c) => c.id === controlId));
  }

  addControls(bandId: string, controls: ReportControl[]): void {
    this.update((d) => d.bands.find((b) => b.id === bandId)?.controls.push(...controls));
    this.selection.set({ kind: 'controls', ids: controls.map((c) => c.id) });
  }

  /** Mutates every selected control (or the given ids) in one undoable step. */
  updateControls(ids: string[], mutate: (control: ReportControl, band: Band) => void, coalesce?: string): void {
    this.update((d) => {
      for (const band of d.bands) for (const c of band.controls) if (ids.includes(c.id)) mutate(c, band);
    }, coalesce);
  }

  updateBand(id: string, mutate: (band: Band) => void, coalesce?: string): void {
    this.update((d) => {
      const band = d.bands.find((b) => b.id === id);
      if (band) mutate(band);
    }, coalesce);
  }

  deleteSelection(): void {
    const sel = this.selection();
    if (sel.kind === 'controls') {
      this.update((d) => d.bands.forEach((b) => (b.controls = b.controls.filter((c) => !sel.ids.includes(c.id)))));
    } else if (sel.kind === 'band') {
      this.removeBand(sel.id);
      return;
    }
    this.selection.set({ kind: 'none' });
  }

  removeBand(id: string): void {
    this.update((d) => {
      // A group header takes its footer with it.
      d.bands = d.bands.filter((b) => b.id !== id && b.groupHeaderId !== id);
    });
    this.selection.set({ kind: 'none' });
  }

  duplicateSelection(): void {
    const controls = this.selectedControls();
    if (!controls.length) return;
    const copies: { bandId: string; control: ReportControl }[] = [];
    for (const c of controls) {
      const band = this.findBandOf(c.id)!;
      copies.push({ bandId: band.id, control: { ...structuredClone(c), id: this.newId(c.type), x: c.x + 3, y: c.y + 3 } });
    }
    this.update((d) => copies.forEach(({ bandId, control }) => d.bands.find((b) => b.id === bandId)!.controls.push(control)));
    this.selection.set({ kind: 'controls', ids: copies.map((c) => c.control.id) });
  }

  /** Copies the selected controls to the designer clipboard (shared by every designer on the page). */
  copySelection(): boolean {
    const controls = this.selectedControls();
    if (!controls.length) return false;
    clipboard = controls.map((c) => ({ bandKind: this.findBandOf(c.id)!.kind, control: structuredClone(c) }));
    return true;
  }

  cutSelection(): void {
    if (this.copySelection()) this.deleteSelection();
  }

  /** Pastes into `bandId`, else the selected band, else each control's original kind of band. */
  paste(bandId?: string): void {
    if (!clipboard.length) return;
    const def = this.report();
    const sel = this.selection();
    const target = bandId ?? (sel.kind === 'band' ? sel.id : sel.kind === 'controls' ? this.findBandOf(sel.ids[0])?.id : undefined);
    const used = new Set(def.bands.flatMap((b) => [b.id, ...b.controls.map((c) => c.id)]));
    const placed: { bandId: string; control: ReportControl }[] = [];
    for (const item of clipboard) {
      const band = def.bands.find((b) => b.id === target) ?? def.bands.find((b) => b.kind === item.bandKind) ?? def.bands.find((b) => b.kind === 'detail');
      if (!band) continue;
      let n = 1;
      while (used.has(`${item.control.type}${n}`)) n++;
      const id = `${item.control.type}${n}`;
      used.add(id);
      // Offset only when pasting over the original, so a paste into another band keeps its position.
      const shift = band.controls.some((c) => c.x === item.control.x && c.y === item.control.y) ? 3 : 0;
      placed.push({ bandId: band.id, control: { ...structuredClone(item.control), id, x: item.control.x + shift, y: item.control.y + shift } });
    }
    if (!placed.length) return;
    this.update((d) =>
      placed.forEach(({ bandId: b, control }) => {
        const band = d.bands.find((x) => x.id === b)!;
        band.controls.push(control);
        band.height = Math.max(band.height, control.y + control.height);
      }),
    );
    this.selection.set({ kind: 'controls', ids: placed.map((p) => p.control.id) });
  }

  hasClipboard(): boolean {
    return clipboard.length > 0;
  }

  /** Selects every control of the selected band, or of the whole report. */
  selectAll(): void {
    const sel = this.selection();
    const bandId = sel.kind === 'band' ? sel.id : sel.kind === 'controls' ? this.findBandOf(sel.ids[0])?.id : undefined;
    const bands = this.report().bands.filter((b) => !bandId || b.id === bandId);
    const ids = bands.flatMap((b) => b.controls.map((c) => c.id));
    this.selection.set(ids.length ? { kind: 'controls', ids } : { kind: 'none' });
  }

  /** Aligns the selection to the first selected control (the one clicked first). */
  align(edge: AlignEdge): void {
    const controls = this.selectedControls();
    const sel = this.selection();
    if (controls.length < 2 || sel.kind !== 'controls') return;
    const ref = controls.find((c) => c.id === sel.ids[0])!;
    this.updateControls(sel.ids, (c) => {
      if (edge === 'left') c.x = ref.x;
      else if (edge === 'right') c.x = round(ref.x + ref.width - c.width);
      else if (edge === 'center') c.x = round(ref.x + (ref.width - c.width) / 2);
      else if (edge === 'top') c.y = ref.y;
      else if (edge === 'bottom') c.y = round(ref.y + ref.height - c.height);
      else c.y = round(ref.y + (ref.height - c.height) / 2);
      c.x = Math.max(0, c.x);
      c.y = Math.max(0, c.y);
    });
  }

  /** Equal gaps between three or more controls, keeping the outermost two in place. */
  distribute(axis: 'h' | 'v'): void {
    const controls = this.selectedControls();
    if (controls.length < 3) return;
    const pos = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'width' : 'height';
    const sorted = [...controls].sort((a, b) => a[pos] - b[pos]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const total = sorted.reduce((sum, c) => sum + c[size], 0);
    const gap = (last[pos] + last[size] - first[pos] - total) / (sorted.length - 1);
    const target = new Map<string, number>();
    let at = first[pos];
    for (const c of sorted) {
      target.set(c.id, round(at));
      at += c[size] + gap;
    }
    this.updateControls(sorted.map((c) => c.id), (c) => (c[pos] = target.get(c.id)!));
  }

  /** Gives the selection the width and/or height of the first selected control. */
  sameSize(dimension: 'width' | 'height' | 'both'): void {
    const sel = this.selection();
    const controls = this.selectedControls();
    if (controls.length < 2 || sel.kind !== 'controls') return;
    const ref = controls.find((c) => c.id === sel.ids[0])!;
    this.updateControls(sel.ids, (c, band) => {
      if (dimension !== 'height') c.width = ref.width;
      if (dimension !== 'width') c.height = ref.height;
      band.height = Math.max(band.height, c.y + c.height);
    });
  }

  /** Draw order inside a band: later controls paint on top. */
  arrange(to: 'front' | 'back'): void {
    const sel = this.selection();
    if (sel.kind !== 'controls') return;
    this.update((d) => {
      for (const band of d.bands) {
        const moving = band.controls.filter((c) => sel.ids.includes(c.id));
        if (!moving.length) continue;
        const rest = band.controls.filter((c) => !sel.ids.includes(c.id));
        band.controls = to === 'front' ? [...rest, ...moving] : [...moving, ...rest];
      }
    });
  }

  select(id: string, additive: boolean): void {
    const sel = this.selection();
    if (additive && sel.kind === 'controls') {
      const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
      this.selection.set(ids.length ? { kind: 'controls', ids } : { kind: 'none' });
    } else if (!(sel.kind === 'controls' && sel.ids.includes(id))) {
      this.selection.set({ kind: 'controls', ids: [id] });
    }
  }

  private pruneSelection(): void {
    const sel = this.selection();
    const def = this.report();
    if (sel.kind === 'controls') {
      const ids = sel.ids.filter((id) => this.findBandOf(id, def));
      this.selection.set(ids.length ? { kind: 'controls', ids } : { kind: 'none' });
    } else if (sel.kind === 'band' && !def.bands.some((b) => b.id === sel.id)) {
      this.selection.set({ kind: 'none' });
    }
  }

  private syncFlags(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }
}
