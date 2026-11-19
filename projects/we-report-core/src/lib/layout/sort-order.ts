/**
 * The positions of the rows in sorted order, or null when nothing sorts. `keys[i]` are the sort
 * keys of row i, `orders[k]` how key k sorts. Empty values first, then numbers by value and
 * everything else by the locale's collation; stable, so equal rows keep their order.
 */
export function sortOrder(keys: unknown[][], orders: ('asc' | 'desc' | 'none')[], locale: string): number[] | null {
  if (!orders.some((o) => o !== 'none')) return null;
  const collator = new Intl.Collator(locale, { numeric: true });
  const cmp = (a: unknown, b: unknown): number => {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return collator.compare(String(a), String(b));
  };
  // Each key is ranked once (its distinct values sorted, equal ones sharing a rank), so the rows
  // sort on numbers: comparing with the collator pair by pair took 20 s on a million rows.
  const ranks: Float64Array[] = [];
  const sizes: number[] = [];
  orders.forEach((order, i) => {
    if (order === 'none') return;
    const distinct = [...new Set(keys.map((k) => k[i]))].sort(cmp);
    const rankOf = new Map<unknown, number>();
    let rank = 0;
    distinct.forEach((v, j) => rankOf.set(v, j > 0 && cmp(distinct[j - 1], v) ? ++rank : rank));
    ranks.push(Float64Array.from(keys, (k) => (order === 'desc' ? rank - rankOf.get(k[i])! : rankOf.get(k[i])!)));
    sizes.push(rank + 1);
  });
  const n = keys.length;
  // The ranks and the row's position fit one exact number: a native numeric sort, stable by position
  if (sizes.reduce((p, size) => p * size, Math.max(n, 1)) <= Number.MAX_SAFE_INTEGER) {
    const packed = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let v = 0;
      for (let i = 0; i < ranks.length; i++) v = v * sizes[i] + ranks[i][r];
      packed[r] = v * n + r;
    }
    return Array.from(packed.sort(), (v) => v % n);
  }
  // Array.prototype.sort is stable, so rows keep their order inside a group.
  return keys.map((_, r) => r).sort((a, b) => {
    for (const rank of ranks) if (rank[a] !== rank[b]) return rank[a] - rank[b];
    return 0;
  });
}
