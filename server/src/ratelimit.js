/** Fixed-window limiter kept in memory: `hit(key)` returns false once `max` is reached. */
export function createLimiter({ windowMs, max, clock = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = clock();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 50_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    entry.count++;
    return entry.count <= max;
  };
}
