/**
 * The eight actions apt.js calls on birdnet-api.php, served from BirdWeather.
 *
 * Upstream anchors everything on a "station date" taken from the Pi's own
 * clock. We take it from Australia/Melbourne (see time.ts for why that is
 * load-bearing rather than cosmetic).
 */
import {
  counts, dailyCounts, fetchDetections, searchSpecies, topSpecies, stations,
  type Detection, type Period,
} from './birdweather.ts';
import { buildGate, type SpeciesGate } from './gate.ts';
import type { Config } from './config.ts';
import { collapseBySpecies, round2, round4 } from './shape.ts';
import {
  addDays, daysBetween, isoNow, localDate, localHour, localSlot, localStamp,
} from './time.ts';

export interface Ctx {
  cfg: Config;
  gate: SpeciesGate;
  /** The station's local "today". */
  today: string;
  /** The day being viewed — today unless the date pager moved. */
  date: string;
}

export function makeCtx(cfg: Config, gate: SpeciesGate, date?: string | null): Ctx {
  const today = localDate(cfg.tz);
  return { cfg, gate, today, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today };
}

const period = (ctx: Ctx, p: Omit<Period, 'timezone'>): Period => ({
  ...p, timezone: ctx.cfg.tz,
});

/** Drop species the gate rejected. */
const passes = (ctx: Ctx, d: Detection) => ctx.gate.allowed.has(d.speciesId);

async function windowDetections(ctx: Ctx, hours: number): Promise<Detection[]> {
  // "ALL" arrives as an absurd hour count so the frontend needs no second
  // code path; we translate it into a wide day window rather than paging
  // the entire archive.
  const days = hours >= 1_000_000 ? 3650 : Math.max(1, Math.ceil(hours / 24));
  const { detections } = await fetchDetections({
    stationIds: ctx.cfg.stationIds,
    period: period(ctx, { count: days, unit: 'day' }),
    scoreGte: ctx.cfg.scoreGte,
  });
  if (hours >= 1_000_000) return detections.filter((d) => passes(ctx, d));
  const cutoff = Date.now() - hours * 3_600_000;
  return detections.filter((d) => passes(ctx, d) && Date.parse(d.timestamp) >= cutoff);
}

const anchorOf = (ctx: Ctx) => localStamp(ctx.cfg.tz, new Date());

/** Fields every dated action repeats. */
function dateBlock(ctx: Ctx) {
  return {
    date: ctx.date,
    station_date: ctx.today,
    is_today: ctx.date === ctx.today,
    anchor: anchorOf(ctx),
  };
}

// ---------------------------------------------------------------- stats

export async function stats(ctx: Ctx) {
  const allTime = period(ctx, { count: 3650, unit: 'day' });
  const dayPeriod = period(ctx, { from: ctx.date, to: ctx.date });
  const weekPeriod = period(ctx, { count: 7, unit: 'day' });

  const [all, todayCounts, week, lastHourDet, daily, allSp, daySp, weekSp] =
    await Promise.all([
      counts({ stationIds: ctx.cfg.stationIds, period: allTime }),
      counts({ stationIds: ctx.cfg.stationIds, period: dayPeriod }),
      counts({ stationIds: ctx.cfg.stationIds, period: weekPeriod }),
      windowDetections(ctx, 1),
      dailyCounts({ stationIds: ctx.cfg.stationIds, period: allTime }),
      gatedSpeciesCount(ctx, allTime),
      gatedSpeciesCount(ctx, dayPeriod),
      gatedSpeciesCount(ctx, weekPeriod),
    ]);

  // Detection counts come from the cheap aggregate and so are ungated; the
  // spike measured that gap at ~0.5%, immaterial for a headline number.
  // SPECIES counts are not immaterial — ungated, a week would claim 52
  // species against a life list of 36 — so those go through the gate.
  return {
    totals: { detections: all.detections, species: allSp },
    today: { detections: todayCounts.detections, species: daySp },
    last_hour: { detections: lastHourDet.length },
    week: { detections: week.detections, species: weekSp },
    started: daily[0]?.date ?? null,
    ...dateBlock(ctx),
    as_of: isoNow(),
  };
}

/** Species in a window that survive the gate. One cheap upstream query. */
async function gatedSpeciesCount(ctx: Ctx, p: Period): Promise<number> {
  const rows = await topSpecies({ stationIds: ctx.cfg.stationIds, period: p });
  return rows.filter((r) => ctx.gate.allowed.has(r.speciesId)).length;
}

// ------------------------------------------------------------- lifelist

export async function lifelist(ctx: Ctx) {
  // topSpecies gives all-time totals but no first/last seen, so we pair it
  // with a 90-day walk for the dates. Species last heard before that window
  // keep their totals and report the oldest date we can actually see —
  // honest, and better than a null the atlas has to render around.
  const [rows, seen] = await Promise.all([
    topSpecies({
      stationIds: ctx.cfg.stationIds,
      period: period(ctx, { count: 3650, unit: 'day' }),
    }),
    windowDetections(ctx, 24 * 90),
  ]);

  interface Span { first: Date; last: Date; bestConf: number }
  const spans = new Map<string, Span>();
  for (const d of seen) {
    const at = new Date(d.timestamp);
    const cur = spans.get(d.scientificName);
    if (!cur) spans.set(d.scientificName, { first: at, last: at, bestConf: d.confidence });
    else {
      if (at < cur.first) cur.first = at;
      if (at > cur.last) cur.last = at;
      if (d.confidence > cur.bestConf) cur.bestConf = d.confidence;
    }
  }

  const species = rows
    .filter((r) => ctx.gate.allowed.has(r.speciesId))
    .map((r) => {
      const span = spans.get(r.scientificName);
      return {
        sci: r.scientificName,
        com: r.commonName,
        first_seen: span ? localStamp(ctx.cfg.tz, span.first) : null,
        last_seen: span ? localStamp(ctx.cfg.tz, span.last) : null,
        n: r.count,
        best_conf: span ? round4(span.bestConf) : null,
      };
    })
    .sort((a, b) => (a.first_seen ?? '').localeCompare(b.first_seen ?? ''));

  return { species, as_of: isoNow() };
}

// --------------------------------------------------------------- recent

export async function recent(ctx: Ctx, hours: number) {
  const detections = await windowDetections(ctx, hours);
  const windowStart = hours >= 1_000_000
    ? null
    : localStamp(ctx.cfg.tz, new Date(Date.now() - hours * 3_600_000));

  return {
    hours,
    ...dateBlock(ctx),
    reset_at_midnight: false,
    midnight_clamped: false,
    window_start: windowStart,
    species: collapseBySpecies(detections, ctx.cfg.tz),
    site_name: ctx.cfg.siteName,
    as_of: isoNow(),
  };
}

// -------------------------------------------------------------- species

/**
 * One species in full: its lifetime summary and every detection we can see.
 *
 * Powers the postcard — the all-time count, first-heard date, rarity label
 * and the Recordings list, each row of which plays through recording.php.
 */
export async function species(ctx: Ctx, sci: string, limit: number, offset: number) {
  const cap = Math.max(1, Math.min(1000, limit));
  const speciesId = await resolveSpeciesId(sci);
  if (!speciesId) {
    return {
      sci, summary: null, detections: [],
      page: { limit: cap, offset, returned: 0 },
      as_of: isoNow(),
    };
  }

  const allTime = period(ctx, { count: 3650, unit: 'day' });
  // The recordings list is a page; the summary is not. Counting the page
  // would report "5 detections all time" for a bird heard 29,000 times, so
  // the lifetime figures come from the per-day aggregate instead — one cheap
  // query that spans the whole history without paging it.
  const [{ detections }, daily] = await Promise.all([
    fetchDetections({
      stationIds: ctx.cfg.stationIds,
      period: allTime,
      scoreGte: ctx.cfg.scoreGte,
      speciesId,
      cap: offset + cap,
    }),
    dailyCounts({ stationIds: ctx.cfg.stationIds, period: allTime, speciesIds: [speciesId] }),
  ]);
  const active = daily.filter((d) => d.total > 0);

  // Newest first, matching upstream's ORDER BY Date DESC, Time DESC.
  const sorted = detections
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const rows = sorted.slice(offset, offset + cap).map((d) => {
    const stamp = localStamp(ctx.cfg.tz, new Date(d.timestamp));
    const [day, time] = stamp.split(' ');
    return {
      detection_id: Number(d.id),
      d: day, t: time,
      file: d.soundscapeUrl,
      conf: round4(d.confidence),
    };
  });

  const newest = sorted[0];
  const summary = newest ? {
    com: newest.commonName,
    total: active.reduce((sum, d) => sum + d.total, 0) || sorted.length,
    // Day precision: the aggregate is per-day, so pair the earliest active
    // date with midnight rather than invent a time we do not have.
    first_seen: active.length
      ? `${active[0]!.date} 00:00:00`
      : localStamp(ctx.cfg.tz, new Date(sorted[sorted.length - 1]!.timestamp)),
    last_seen: localStamp(ctx.cfg.tz, new Date(newest.timestamp)),
    best_conf: round4(Math.max(...sorted.map((d) => d.confidence))),
  } : null;

  return {
    sci, summary, detections: rows,
    page: { limit: cap, offset, returned: rows.length },
    as_of: isoNow(),
  };
}

// ----------------------------------------------------------- timeseries

export async function timeseries(ctx: Ctx, days: number) {
  const span = Math.max(1, Math.min(90, days));
  const daily = await dailyCounts({
    stationIds: ctx.cfg.stationIds,
    period: period(ctx, { count: span, unit: 'day' }),
  });
  const recent30 = await windowDetections(ctx, 24 * 30);

  const byHour = new Map<number, number>();
  for (const d of recent30) {
    const h = localHour(ctx.cfg.tz, new Date(d.timestamp));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }

  return {
    days: span,
    daily: daily.map((d) => ({ date: d.date, detections: d.total, species: d.species })),
    by_hour: [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, detections]) => ({ hour, detections })),
    as_of: isoNow(),
  };
}

// ------------------------------------------------------------ firstseen

export async function firstseen(ctx: Ctx, limit: number) {
  const lookback = await windowDetections(ctx, 24 * 90);
  const first = new Map<string, { com: string; at: Date; total: number }>();
  for (const d of lookback) {
    const cur = first.get(d.scientificName);
    const at = new Date(d.timestamp);
    if (!cur) first.set(d.scientificName, { com: d.commonName, at, total: 1 });
    else {
      cur.total += 1;
      if (at < cur.at) cur.at = at;
    }
  }
  const species = [...first.entries()]
    .sort((a, b) => b[1].at.getTime() - a[1].at.getTime())
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map(([sci, v]) => ({
      sci, com: v.com,
      first_seen: localStamp(ctx.cfg.tz, v.at),
      total: v.total,
    }));
  return { ...dateBlock(ctx), species, as_of: isoNow() };
}

// ------------------------------------------------------------- calendar

export async function calendar(ctx: Ctx) {
  const daily = await dailyCounts({
    stationIds: ctx.cfg.stationIds,
    period: period(ctx, { count: 3650, unit: 'day' }),
  });
  const days = daily
    .filter((d) => d.date <= ctx.today)
    .map((d) => ({ date: d.date, detections: d.total, species: d.species }));
  return {
    station_date: ctx.today,
    first_date: days[0]?.date ?? null,
    last_date: days.length ? days[days.length - 1]!.date : null,
    days,
    as_of: isoNow(),
  };
}

// --------------------------------------------------------------- rhythm

export async function rhythm(ctx: Ctx, days: number, hours: number) {
  const span = Math.max(1, Math.min(30, days));
  const mode = hours === 168 ? 'week' : hours >= 1_000_000 ? 'all-day' : 'day';
  const isToday = ctx.date === ctx.today;

  const slotCounts = (det: Detection[], divisor: number) => {
    const by = new Map<number, number>();
    for (const d of det) {
      const s = localSlot(ctx.cfg.tz, new Date(d.timestamp));
      by.set(s, (by.get(s) ?? 0) + 1);
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, n]) => ({ slot, n: divisor === 1 ? n : round2(n / divisor) }));
  };

  let todaySlots: { slot: number; n: number }[];
  let avgSlots: { slot: number; n: number }[];

  if (mode === 'week') {
    const last14 = await windowDetections(ctx, 24 * 14);
    const cut = Date.now() - 168 * 3_600_000;
    todaySlots = slotCounts(last14.filter((d) => Date.parse(d.timestamp) > cut), 7);
    avgSlots = slotCounts(last14.filter((d) => Date.parse(d.timestamp) <= cut), 7);
  } else {
    const dayDet = await dayDetections(ctx, ctx.date);
    const priorFrom = addDays(ctx.date, -span);
    const prior = await rangeDetections(ctx, priorFrom, addDays(ctx.date, -1));
    todaySlots = slotCounts(dayDet, 1);
    avgSlots = slotCounts(prior, span);
  }

  const nowSlot = isToday && mode !== 'week' ? localSlot(ctx.cfg.tz, new Date()) : 1439;
  const rangeStart = hours <= 1 ? Math.max(0, nowSlot - 59)
    : hours <= 12 ? Math.max(0, nowSlot - 719) : 0;

  return {
    days: span, hours, mode,
    ...dateBlock(ctx),
    is_today: isToday,
    slots: 1440,
    today: todaySlots.map((s) => ({ slot: s.slot, detections: s.n })),
    avg: avgSlots.map((s) => ({ slot: s.slot, avg: s.n })),
    now_slot: nowSlot,
    now_hour: Math.floor(nowSlot / 60),
    range_start_slot: rangeStart,
    range_end_slot: hours <= 12 ? nowSlot : 1439,
    as_of: isoNow(),
  };
}

// --------------------------------------------------------------- hourly

export async function hourly(ctx: Ctx, limit: number) {
  const det = await dayDetections(ctx, ctx.date);
  const cap = Math.max(1, Math.min(30, limit));

  interface Acc { sci: string; com: string; total: number; hours: Map<number, number> }
  const by = new Map<string, Acc>();
  for (const d of det) {
    let acc = by.get(d.scientificName);
    if (!acc) {
      acc = { sci: d.scientificName, com: d.commonName, total: 0, hours: new Map() };
      by.set(d.scientificName, acc);
    }
    const h = localHour(ctx.cfg.tz, new Date(d.timestamp));
    acc.hours.set(h, (acc.hours.get(h) ?? 0) + 1);
    acc.total += 1;
  }

  const species = [...by.values()]
    .sort((a, b) => b.total - a.total || a.sci.localeCompare(b.sci))
    .slice(0, cap)
    .map((a) => ({
      sci: a.sci, com: a.com, total: a.total,
      hours: [...a.hours.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([hour, n]) => ({ hour, n })),
    }));

  return {
    ...dateBlock(ctx),
    is_today: ctx.date === ctx.today,
    anchor_hour: ctx.date === ctx.today ? localHour(ctx.cfg.tz, new Date()) : 23,
    species,
    as_of: isoNow(),
  };
}

// --------------------------------------------------------------- helpers

async function dayDetections(ctx: Ctx, date: string): Promise<Detection[]> {
  return rangeDetections(ctx, date, date);
}

/** Scientific name -> BirdWeather species id, for the per-species queries. */
const speciesIdCache = new Map<string, string | null>();

async function resolveSpeciesId(sci: string): Promise<string | null> {
  const key = sci.toLowerCase();
  if (speciesIdCache.has(key)) return speciesIdCache.get(key)!;
  const found = await searchSpecies(sci);
  speciesIdCache.set(key, found);
  return found;
}

async function rangeDetections(ctx: Ctx, from: string, to: string): Promise<Detection[]> {
  if (daysBetween(from, to) < 0) return [];
  const { detections } = await fetchDetections({
    stationIds: ctx.cfg.stationIds,
    period: period(ctx, { from, to }),
    scoreGte: ctx.cfg.scoreGte,
  });
  return detections.filter((d) => passes(ctx, d));
}

export { buildGate, stations, round4 };
