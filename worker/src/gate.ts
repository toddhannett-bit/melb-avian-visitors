/**
 * The quality gate.
 *
 * docs/SPIKE.md §2 measured this against a real neighbourhood cluster:
 * BirdNET *confidence* does not separate false positives (a single Glossy
 * Black-Cockatoo detection scored 0.930, higher than the mean of 21,000
 * Spotted Doves). BirdWeather's *score* blends in locality priors and does.
 *
 * Windowed views (recent, hourly, rhythm) are filtered exactly, per detection,
 * by passing scoreGte upstream. The aggregate queries take no score argument,
 * so those are filtered by SPECIES using the set built here.
 *
 * The rule is simply: has this species ever cleared the floor in the lookback?
 * Measured over 90 days of the six example Melbourne stations, that keeps 51 of 71
 * species, drops all eight implausible ones (Glossy Black-Cockatoo, Osprey,
 * Superb Lyrebird, Whiskered Tern, Little Tern, Bell Miner, Wonga Pigeon,
 * Pacific Koel) and loses three genuine ones — Tawny Frogmouth, Peregrine
 * Falcon and Southern Boobook, the casualties the spike predicted.
 *
 * Requiring corroboration (2+ detections, or 2+ stations) was tested and
 * REJECTED: it removes no additional junk, because none survives the floor
 * anyway, and it costs Willie-wagtail, Laughing Kookaburra and Long-billed
 * Corella. The simple floor is the better rule here.
 *
 * WARNING for anyone extending this: `totalCount` on the detections connection
 * IGNORES the filter arguments — it reports 92,976 whether scoreGte is 6, 9 or
 * absent. Only `nodes` is filtered. An earlier version of this file counted
 * totalCount and concluded every species passed.
 */
import { topSpecies, gql, type Period } from './birdweather.ts';

/** How far back we look to decide which species are real here. */
const LOOKBACK_DAYS = 90;
/** Aliased probes per request. 71 in one call took ~2.6s; keep headroom. */
const CHUNK = 40;

export interface SpeciesGate {
  allowed: Set<string>;
  /** Species seen in the lookback that never cleared the floor. */
  rejected: Map<string, string>;
  builtAt: string;
}

/** The JSON-safe form: a Set stringifies to `{}`, which would reject everything. */
export interface SerialisedGate {
  allowed: string[];
  rejected: [string, string][];
  builtAt: string;
}

export const serialiseGate = (g: SpeciesGate): SerialisedGate => ({
  allowed: [...g.allowed],
  rejected: [...g.rejected],
  builtAt: g.builtAt,
});

export const reviveGate = (s: SerialisedGate): SpeciesGate => ({
  allowed: new Set(s.allowed ?? []),
  rejected: new Map(s.rejected ?? []),
  builtAt: s.builtAt,
});

export async function buildGate(opts: {
  stationIds: string[];
  scoreGte: number;
  tz: string;
}): Promise<SpeciesGate> {
  const period: Period = { count: LOOKBACK_DAYS, unit: 'day', timezone: opts.tz };
  const species = await topSpecies({ stationIds: opts.stationIds, period });

  const allowed = new Set<string>();
  const rejected = new Map<string, string>();

  for (let i = 0; i < species.length; i += CHUNK) {
    const chunk = species.slice(i, i + CHUNK);
    const fields = chunk
      .map((s, j) =>
        `  p${j}: detections(period:$p, stationIds:$ids, speciesId:"${s.speciesId}", ` +
        `scoreGte:$score, first:1){ nodes { id } }`)
      .join('\n');
    const query = `query($ids:[ID!],$p:InputDuration,$score:Float){\n${fields}\n}`;

    const data = await gql<Record<string, { nodes: { id: string }[] }>>(query, {
      ids: opts.stationIds,
      p: period,
      score: opts.scoreGte,
    });

    chunk.forEach((s, j) => {
      const hit = (data[`p${j}`]?.nodes?.length ?? 0) > 0;
      if (hit) allowed.add(s.speciesId);
      else rejected.set(s.speciesId, s.commonName);
    });
  }

  return { allowed, rejected, builtAt: new Date().toISOString() };
}
