/**
 * BirdWeather GraphQL client.
 *
 * Anonymous and unauthenticated: public stations are readable without a token.
 * Everything goes through here so there is exactly one place that talks
 * upstream, one place that retries, and one place to add a courtesy delay if
 * BirdWeather ever asks us to slow down.
 *
 * Note on filtering: `detections` accepts scoreGte, but the aggregate queries
 * (dailyDetectionCounts, timeOfDayDetectionCounts, topSpecies) do not. Where a
 * response has to honour the quality gate we page raw detections and aggregate
 * here; where it only feeds a chart we use the cheap aggregate and say so.
 */

const ENDPOINT = 'https://app.birdweather.com/graphql';
const PAGE = 500;
/** Hard ceiling on paging, so one bad window cannot walk the whole archive. */
const MAX_PAGES = 40;

export interface Period {
  count?: number;
  unit?: string;
  from?: string;
  to?: string;
  timezone?: string;
}

export interface Detection {
  id: string;
  timestamp: string;
  confidence: number;
  score: number;
  speciesId: string;
  commonName: string;
  scientificName: string;
  stationId: string;
  soundscapeUrl: string | null;
}

export class BirdWeatherError extends Error {
  readonly detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'BirdWeatherError';
    this.detail = detail;
  }
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(250 * 2 ** attempt);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      lastErr = err;
      continue;
    }
    // 5xx and 429 are worth another go; a 4xx is our bug and will not improve.
    if (res.status === 429 || res.status >= 500) {
      lastErr = new BirdWeatherError(`upstream HTTP ${res.status}`);
      continue;
    }
    if (!res.ok) throw new BirdWeatherError(`upstream HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new BirdWeatherError('GraphQL error', body.errors);
    if (!body.data) throw new BirdWeatherError('empty response');
    return body.data;
  }
  throw lastErr instanceof Error ? lastErr : new BirdWeatherError('upstream unreachable');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DETECTIONS = `
query($ids:[ID!],$period:InputDuration,$scoreGte:Float,$speciesId:ID,$after:String){
  detections(period:$period, stationIds:$ids, scoreGte:$scoreGte,
             speciesId:$speciesId, first:${PAGE}, after:$after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id timestamp confidence score
      species { id commonName scientificName }
      station { id }
      soundscape { url }
    }
  }
}`;

interface DetectionsPage {
  detections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: RawDetection[];
  };
}

interface RawDetection {
  id: string;
  timestamp: string;
  confidence: number;
  score: number;
  species: { id: string; commonName: string; scientificName: string } | null;
  station: { id: string } | null;
  soundscape: { url: string } | null;
}

/**
 * Page every detection in a window. Returns them oldest-first.
 *
 * `cap` bounds the walk for windows that could be enormous ("ALL" on a station
 * with a year of history). Hitting it is reported rather than hidden, so a
 * caller can decide whether a truncated answer is acceptable.
 */
export async function fetchDetections(opts: {
  stationIds: string[];
  period: Period;
  scoreGte?: number;
  speciesId?: string;
  cap?: number;
}): Promise<{ detections: Detection[]; truncated: boolean }> {
  const cap = opts.cap ?? PAGE * MAX_PAGES;
  const out: Detection[] = [];
  let after: string | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    // An explicit `scoreGte: null` is NOT "no filter" upstream — it compares
    // against null and matches nothing. The variable has to be absent.
    const vars: Record<string, unknown> = {
      ids: opts.stationIds,
      period: opts.period,
      after,
    };
    if (opts.scoreGte !== undefined) vars.scoreGte = opts.scoreGte;
    if (opts.speciesId !== undefined) vars.speciesId = opts.speciesId;

    const data: DetectionsPage = await gql<DetectionsPage>(DETECTIONS, vars);

    for (const n of data.detections.nodes) {
      if (!n.species) continue; // non-bird rows (the network also carries bats)
      out.push({
        id: n.id,
        timestamp: n.timestamp,
        confidence: n.confidence,
        score: n.score,
        speciesId: n.species.id,
        commonName: n.species.commonName,
        scientificName: n.species.scientificName,
        stationId: n.station?.id ?? '',
        soundscapeUrl: n.soundscape?.url ?? null,
      });
    }

    if (out.length >= cap) { truncated = data.detections.pageInfo.hasNextPage; break; }
    if (!data.detections.pageInfo.hasNextPage) break;
    after = data.detections.pageInfo.endCursor;
    if (!after) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { detections: out.slice(0, cap), truncated };
}

/** Look up a species by scientific name. Returns its BirdWeather id. */
export async function searchSpecies(sci: string): Promise<string | null> {
  const data = await gql<{ searchSpecies: { nodes: { id: string }[] } }>(
    `query($q:String!){ searchSpecies(query:$q, first:1){ nodes { id } } }`,
    { q: sci },
  );
  return data.searchSpecies.nodes[0]?.id ?? null;
}

export async function counts(opts: { stationIds: string[]; period: Period }) {
  const data = await gql<{ counts: { detections: number; species: number; stations: number } }>(
    `query($ids:[ID!],$period:InputDuration){
       counts(period:$period, stationIds:$ids){ detections species stations } }`,
    { ids: opts.stationIds, period: opts.period },
  );
  return data.counts;
}

export interface DailyCount {
  date: string;
  total: number;
  species: number;
}

/** Per-day totals. Cheap, but NOT score-filtered — see the note at the top. */
export async function dailyCounts(opts: {
  stationIds: string[];
  period: Period;
  speciesIds?: string[];
}): Promise<DailyCount[]> {
  const data = await gql<{
    dailyDetectionCounts: { date: string; total: number; counts: { count: number }[] }[];
  }>(
    `query($ids:[ID!],$period:InputDuration,$speciesIds:[ID!]){
       dailyDetectionCounts(period:$period, stationIds:$ids, speciesIds:$speciesIds){
         date total counts { count speciesId } } }`,
    { ids: opts.stationIds, period: opts.period, speciesIds: opts.speciesIds ?? null },
  );
  return data.dailyDetectionCounts
    .map((d) => ({ date: d.date, total: d.total, species: d.counts.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TopSpecies {
  speciesId: string;
  commonName: string;
  scientificName: string;
  count: number;
}

/** Species totals for a window. Not score-filtered. */
export async function topSpecies(opts: {
  stationIds: string[];
  period: Period;
  limit?: number;
}): Promise<TopSpecies[]> {
  const data = await gql<{
    topSpecies: {
      count: number;
      species: { id: string; commonName: string; scientificName: string };
    }[];
  }>(
    `query($ids:[ID!],$period:InputDuration,$limit:Int){
       topSpecies(period:$period, stationIds:$ids, limit:$limit){
         count species { id commonName scientificName } } }`,
    { ids: opts.stationIds, period: opts.period, limit: opts.limit ?? 300 },
  );
  return data.topSpecies.map((r) => ({
    speciesId: r.species.id,
    commonName: r.species.commonName,
    scientificName: r.species.scientificName,
    count: r.count,
  }));
}

export interface StationInfo {
  id: string;
  name: string;
  latestDetectionAt: string | null;
}

export async function stations(ids: string[]): Promise<StationInfo[]> {
  const out: StationInfo[] = [];
  for (const id of ids) {
    const data = await gql<{ station: StationInfo | null }>(
      `query($id:ID!){ station(id:$id){ id name latestDetectionAt } }`,
      { id },
    );
    if (data.station) out.push(data.station);
  }
  return out;
}
