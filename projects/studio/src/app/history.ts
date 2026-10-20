/** A design kept in the browser so it can be brought back. */
export interface HistoryEntry {
  time: number;
  name: string;
  templateId: string;
  report: unknown;
  data?: unknown;
}

export const HISTORY_LIMIT = 20;

/** `entry` first, unless the newest entry already holds the same design; at most `limit` kept. */
export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry, limit = HISTORY_LIMIT): HistoryEntry[] {
  const same = list[0] && JSON.stringify(list[0].report) === JSON.stringify(entry.report) && JSON.stringify(list[0].data) === JSON.stringify(entry.data);
  return (same ? [entry, ...list.slice(1)] : [entry, ...list]).slice(0, limit);
}

/** Entries read back from storage; anything malformed is dropped (storage is not trusted). */
export function parseHistory(text: string | null): HistoryEntry[] {
  try {
    const list = JSON.parse(text ?? '[]');
    return Array.isArray(list)
      ? list.filter((e) => e && typeof e.time === 'number' && typeof e.name === 'string' && typeof e.templateId === 'string' && e.report).slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}
