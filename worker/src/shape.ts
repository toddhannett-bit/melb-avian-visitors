/**
 * The response shapes `apt.js` expects.
 *
 * These mirror avian/api/birdnet-api.php exactly, because the frontend is
 * forked unchanged and reads them directly. Field names are upstream's
 * (snake_case, `sci`/`com` abbreviations) — deliberately, so the frontend
 * never has to know its data now comes from BirdWeather rather than a local
 * SQLite file.
 */
import type { Detection } from './birdweather.ts';
import { localStamp } from './time.ts';

export interface SpeciesRow {
  sci: string;
  com: string;
  n: number;
  best_conf: number;
  last_seen: string;
  first_seen?: string;
  top_file?: string | null;
  detection_id?: number | null;
  top_at?: string | null;
}

/**
 * Collapse detections to one row per species, matching the `recent` action:
 * count, best confidence, last seen, and the detection with the highest
 * confidence in the window (whose audio the postcard plays).
 */
export function collapseBySpecies(detections: Detection[], tz: string): SpeciesRow[] {
  interface Acc {
    sci: string; com: string; n: number;
    bestConf: number; lastAt: Date; firstAt: Date;
    topId: string | null; topAt: Date | null; topUrl: string | null;
  }
  const by = new Map<string, Acc>();

  for (const d of detections) {
    const at = new Date(d.timestamp);
    const cur = by.get(d.scientificName);
    if (!cur) {
      by.set(d.scientificName, {
        sci: d.scientificName, com: d.commonName, n: 1,
        bestConf: d.confidence, lastAt: at, firstAt: at,
        topId: d.id, topAt: at, topUrl: d.soundscapeUrl,
      });
      continue;
    }
    cur.n += 1;
    if (at > cur.lastAt) cur.lastAt = at;
    if (at < cur.firstAt) cur.firstAt = at;
    if (d.confidence > cur.bestConf) {
      cur.bestConf = d.confidence;
      cur.topId = d.id;
      cur.topAt = at;
      cur.topUrl = d.soundscapeUrl;
    }
  }

  return [...by.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map((a) => ({
      sci: a.sci,
      com: a.com,
      n: a.n,
      best_conf: round4(a.bestConf),
      last_seen: localStamp(tz, a.lastAt),
      first_seen: localStamp(tz, a.firstAt),
      // Upstream put a BirdNET-Pi filename here and recording.php resolved it.
      // We put the BirdWeather detection id in detection_id and let our own
      // recording route resolve the soundscape; top_file stays informational.
      top_file: a.topUrl,
      detection_id: a.topId ? Number(a.topId) : null,
      top_at: a.topAt ? localStamp(tz, a.topAt) : null,
    }));
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
