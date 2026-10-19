import { computed, Injectable, signal } from '@angular/core';
import { Band, createBlankReport, ReportControl, ReportDefinition } from 'we-report-core';

export type Selection = { kind: 'none' } | { kind: 'controls'; ids: string[] } | { kind: 'band'; id: string };

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
