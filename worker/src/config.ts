export interface Env {
  /** Comma-separated BirdWeather station ids for the neighbourhood cluster. */
  STATION_IDS: string;
  /** Your own station, once it exists. Empty until stage two. */
  OWN_STATION_ID: string;
  TIMEZONE: string;
  /** BirdWeather score floor. See docs/SPIKE.md §2 for why this is score
   *  and not confidence. */
  SCORE_GTE: string;
  SITE_NAME: string;
  CACHE?: KVNamespace;
  ASSETS?: Fetcher;
  /** Optional. When set, the whole site sits behind HTTP basic auth.
   *  Set with `wrangler secret put SITE_PASSWORD` — never in wrangler.toml,
   *  which is committed. Unset means the site is open. */
  SITE_PASSWORD?: string;
}

export interface Config {
  /** Stations to report on: your own if registered, else the cluster. */
  stationIds: string[];
  /** The full cluster, always — used for the fallback view. */
  clusterIds: string[];
  /** Your own station id, or null before stage two. */
  ownStationId: string | null;
  /** True when we are showing the neighbourhood because your mic is absent. */
  usingFallback: boolean;
  tz: string;
  scoreGte: number;
  siteName: string;
}

export function readConfig(env: Env): Config {
  const cluster = split(env.STATION_IDS);
  const own = env.OWN_STATION_ID?.trim() || null;
  return {
    stationIds: own ? [own] : cluster,
    clusterIds: cluster,
    ownStationId: own,
    usingFallback: !own,
    tz: env.TIMEZONE?.trim() || 'Australia/Melbourne',
    scoreGte: Number.parseFloat(env.SCORE_GTE ?? '6.0'),
    siteName: env.SITE_NAME?.trim() || 'Melbourne',
  };
}

function split(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
