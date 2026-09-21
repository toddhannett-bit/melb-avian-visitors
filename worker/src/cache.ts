/**
 * KV-backed response cache.
 *
 * One upstream request serves every viewer. BirdWeather publishes a schema but
 * no rate limits or terms, so we are deliberately light: a handful of upstream
 * calls a minute at most, whatever our traffic. See PLAN.md §2.
 *
 * Degrades to a straight pass-through when no KV namespace is bound, so
 * `wrangler dev` works with no setup.
 */
export interface CacheLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
}

export async function cached<T>(
  kv: CacheLike | undefined,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  if (!kv) return produce();
  try {
    const hit = await kv.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    // A cache read failure must never take the site down.
  }
  const fresh = await produce();
  try {
    await kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  } catch {
    // Likewise a write failure.
  }
  return fresh;
}

/**
 * TTLs, in seconds.
 *
 * Raised from the originals (recent 60s, stats 120s, most history an hour)
 * because those were set for a site with traffic. This one has a single
 * family on it. A 60-second TTL only pays off when the next visitor arrives
 * inside a minute, which here never happens — so every visit was a miss, and
 * a miss costs 5 to 24 seconds of BirdWeather's aggregate queries against
 * 4 to 11ms from cache.
 *
 * The saving in KV writes is modest, because at this traffic the write count
 * is set by how often anyone visits rather than by the TTL. The point is the
 * second visit: open the site twice in an evening, or hand the phone from one
 * child to the other, and the second load is now instant instead of another
 * cold fetch.
 *
 * `recent` is the one to be careful with — it drives the collage, so it is
 * how long it takes a bird just heard to appear. Ten minutes is short enough
 * that "is it on the site yet?" still works, which matters once the
 * microphone is in their own garden.
 */
export const TTL = {
  recent: 600,        // 10 min — the collage; short enough to still feel live
  stats: 600,         // 10 min — totals move as slowly as the collage does
  rhythm: 3600,       // 1 hour — time-of-day shape, barely moves within a day
  hourly: 3600,       // 1 hour
  timeseries: 10800,  // 3 hours — 30 daily buckets; today's is the only live one
  lifelist: 7200,     // 2 hours — kept tighter than the rest: a first-ever
  firstseen: 7200,    // 2 hours — sighting is the interesting event to surface
  calendar: 21600,    // 6 hours — whole days, settled once they are past
  gate: 21600,        // 6 hours — the species allowlist, expensive to rebuild
  station: 3600,      // 1 hour — station metadata
  species: 3600,      // 1 hour — per-species detail behind a postcard
  // A species account does not change. Hold it for a week.
  wiki: 604800,
} as const;
