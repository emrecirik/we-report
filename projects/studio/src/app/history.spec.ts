import { HistoryEntry, parseHistory, pushHistory } from './history';

const entry = (name: string, time = 1, report: unknown = { name }): HistoryEntry => ({ time, name, templateId: 'blank', report });

describe('design history', () => {
  it('keeps the newest designs first, at most the limit', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 5; i++) list = pushHistory(list, entry(`r${i}`, i), 3);
    expect(list.map((e) => e.name)).toEqual(['r4', 'r3', 'r2']);
  });

  it('does not repeat an unchanged design, but refreshes its time', () => {
    const list = pushHistory(pushHistory([], entry('a', 1)), entry('a', 2));
    expect(list.length).toBe(1);
    expect(list[0].time).toBe(2);
  });

  it('reads back only well-formed entries', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory(JSON.stringify([entry('ok'), { name: 'no time' }, null]))).toEqual([entry('ok')]);
  });
});
