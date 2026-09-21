/**
 * melb-avian-visitors — a BirdWeather-backed stand-in for BirdNET-Pi's local API.
 *
 * The AvianVisitors frontend is forked unchanged and still asks for
 * `./avian/api/birdnet-api.php?action=…`. Nothing here is PHP; that path is
 * simply the contract we honour, so the frontend never learns its data now
 * comes from a public API rather than a SQLite file on a Pi in the next room.
 *
 * See PLAN.md §2 and docs/UPSTREAM-NOTES.md.
 */
import { readConfig, type Env } from './config.ts';
import { cached, TTL } from './cache.ts';
import {
  buildGate, reviveGate, serialiseGate,
  type SerialisedGate, type SpeciesGate,
} from './gate.ts';
import * as actions from './actions.ts';
import { makeCtx } from './actions.ts';
import { fetchDetections, searchSpecies, stations } from './birdweather.ts';
import { isoNow } from './time.ts';
import { BEST_RECORDING_CAP, BEST_RECORDING_WINDOWS_DAYS, pickBestRecording } from './recording.ts';
import {
  authorised, handleLogin, loginPage, passwordFor, wantsPage,
} from './auth.ts';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30',
  'access-control-allow-origin': '*',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The password gate, if one is set. Everything is behind it — pages,
    // assets, audio, API — so the form is a front door, not a curtain.
    const secret = passwordFor(env);
    if (secret) {
      if (url.pathname === '/enter' && request.method === 'POST') {
        return handleLogin(request, secret);
      }
      if (!await authorised(request, secret)) {
        // A browser navigating gets the form. Anything else — an <img> on a
        // stale tab, a fetch, curl — gets a plain 401, because handing back a
        // login page where a PNG was expected only produces a broken image.
        if (wantsPage(request)) {
          return loginPage(url.pathname + url.search);
        }
        return new Response('This one needs a password.', {
          status: 401,
          headers: { 'content-type': 'text/plain; charset=utf-8',
                     'cache-control': 'no-store' },
        });
      }
      // Already in, but following a stale link to the door: send them home.
      if (url.pathname === '/enter') {
        return new Response(null, { status: 303, headers: { location: '/' } });
      }
    }

    if (url.pathname === '/avian/api/birdnet-api.php') return api(url, env);
    if (url.pathname === '/avian/api/recording.php') return recording(url, env);
    if (url.pathname === '/avian/api/cutout.php') return cutout(url, env);
    if (url.pathname === '/avian/api/menu.php') return menu();
    if (url.pathname === '/avian/api/wiki.php') return wiki(url, env);
    if (url.pathname === '/healthz') return health(env);

    // Anything else is a static file from the forked frontend.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('not found', { status: 404 });
  },
};

async function api(url: URL, env: Env): Promise<Response> {
  const cfg = readConfig(env);
  const action = url.searchParams.get('action') ?? 'stats';
  const date = url.searchParams.get('date');
  const num = (key: string, dflt: number) => {
    const raw = Number.parseInt(url.searchParams.get(key) ?? '', 10);
    return Number.isFinite(raw) ? raw : dflt;
  };

  let gate: SpeciesGate;
  try {
    gate = await gateFor(cfg, env);
  } catch (err) {
    return offline(action, err);
  }

  const ctx = makeCtx(cfg, gate, date);
  const key = `v1:${action}:${cfg.stationIds.join(',')}:${ctx.date}:${url.search}`;

  try {
    switch (action) {
      case 'stats':
        return json(await cached(env.CACHE, key, TTL.stats, () => actions.stats(ctx)));
      case 'lifelist':
        return json(await cached(env.CACHE, key, TTL.lifelist, () => actions.lifelist(ctx)));
      case 'recent':
        return json(await cached(env.CACHE, key, TTL.recent,
          () => actions.recent(ctx, num('hours', 24))));
      case 'timeseries':
        return json(await cached(env.CACHE, key, TTL.timeseries,
          () => actions.timeseries(ctx, num('days', 30))));
      case 'firstseen':
        return json(await cached(env.CACHE, key, TTL.firstseen,
          () => actions.firstseen(ctx, num('limit', 10))));
      case 'calendar':
        return json(await cached(env.CACHE, key, TTL.calendar, () => actions.calendar(ctx)));
      case 'rhythm':
        return json(await cached(env.CACHE, key, TTL.rhythm,
          () => actions.rhythm(ctx, num('days', 7), num('hours', 24))));
      case 'hourly':
        return json(await cached(env.CACHE, key, TTL.hourly,
          () => actions.hourly(ctx, num('limit', 15))));
      case 'species': {
        const sci = url.searchParams.get('sci') ?? '';
        if (!sci) return json({ error: 'sci= required' }, 400);
        const payload = await cached(env.CACHE, key, TTL.species,
          () => actions.species(ctx, sci, num('limit', 500), num('offset', 0)));
        await rememberSoundscapes(env, sci, payload.detections);
        return json(payload);
      }
      default:
        return json({ error: 'unknown action' }, 404);
    }
  } catch (err) {
    return offline(action, err);
  }
}

/**
 * Upstream's own contract for "the mic isn't reporting", which the frontend
 * already knows how to render. Its live site returns exactly this shape, so
 * an outage degrades into a designed state rather than a blank collage.
 */
function offline(action: string, err: unknown): Response {
  console.error(`action ${action} failed:`, err);
  return json({ error: 'sensor offline', action }, 503);
}

const soundscapeKey = (sci: string) => `v1:soundscapes:${sci.toLowerCase()}`;
const bestRecordingKey = (sci: string) => `v1:best-recording:${sci.toLowerCase()}`;

/** Hosts we will redirect audio to. */
const MEDIA_HOSTS = new Set(['media.birdweather.com', 'app.birdweather.com']);

/**
 * Validate a caller-supplied media URL.
 *
 * This endpoint is public and redirects wherever it is told, so without an
 * allowlist it would be an open redirect — anyone could hand out a link on
 * our domain that lands on theirs. Only https on BirdWeather's own media
 * hosts is accepted.
 */
function birdweatherMedia(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!MEDIA_HOSTS.has(parsed.hostname)) return null;
  return parsed.toString();
}

/**
 * Cache one detection-id -> soundscape-url map per species.
 *
 * BirdWeather has no singular `detection(id:)` query — only the `detections`
 * connection — so a recording cannot be looked up by id alone. But the
 * postcard always loads `action=species` before any of its rows can be
 * clicked, and that response already carries every URL. So we stash the map
 * as it goes past.
 *
 * One KV entry per species, not one per detection: 500 rows would otherwise
 * be 500 writes, and the free tier allows 1,000 a day.
 */
async function rememberSoundscapes(
  env: Env,
  sci: string,
  rows: { detection_id: number | null; file: string | null }[],
): Promise<void> {
  if (!env.CACHE) return;
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.detection_id && row.file) map[String(row.detection_id)] = row.file;
  }
  if (!Object.keys(map).length) return;
  try {
    await env.CACHE.put(soundscapeKey(sci), JSON.stringify(map),
      { expirationTtl: 86_400 });
  } catch {
    // A cache write failure only costs us the fast path below.
  }
}

/**
 * Resolve a detection to its BirdWeather soundscape and hand the browser
 * straight to it. Upstream served the Pi's own WAV here; we redirect rather
 * than proxy so the audio never travels through the Worker.
 */
async function recording(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get('detection');
  const sci = url.searchParams.get('sci') ?? '';
  const file = url.searchParams.get('file') ?? '';

  // The postcard's recording rows ask by `file`, not by id: the frontend's
  // recordingSources() sends { file, detection } and detection is null
  // outside educator mode. Since our `species` action puts the soundscape URL
  // straight into that field, the answer is already in the request.
  if (file) {
    const target = birdweatherMedia(file);
    if (target) return Response.redirect(target, 302);
    return json({ error: 'not a recording url' }, 400);
  }

  // By name alone: the atlas card's play button and the species card's
  // Listen button. Upstream's Pi answered this from its own disk; without
  // this branch every one of those buttons got a 400 and said "no audio".
  if (!id) {
    if (!sci) return json({ error: 'sci=, file= or detection= required' }, 400);
    return bestRecording(sci, env);
  }

  try {
    // Fast path: the map the postcard's own species call left behind.
    if (env.CACHE && sci) {
      const raw = await env.CACHE.get(soundscapeKey(sci));
      if (raw) {
        const hit = (JSON.parse(raw) as Record<string, string>)[id];
        if (hit) return Response.redirect(hit, 302);
      }
    }

    // Slow path, for a cold cache or a link opened directly: walk this
    // species' recent detections and find the one with that id.
    if (sci) {
      const cfg = readConfig(env);
      const speciesId = await searchSpecies(sci);
      if (speciesId) {
        const { detections } = await fetchDetections({
          stationIds: cfg.stationIds,
          period: { count: 3650, unit: 'day', timezone: cfg.tz },
          scoreGte: cfg.scoreGte,
          speciesId,
          cap: 2000,
        });
        const found = detections.find((d) => d.id === id);
        if (found?.soundscapeUrl) return Response.redirect(found.soundscapeUrl, 302);
      }
    }
    return json({ error: 'no recording' }, 404);
  } catch (err) {
    console.error('recording lookup failed:', err);
    return json({ error: 'no recording' }, 404);
  }
}

/**
 * Redirect to the best recent clip of a species.
 *
 * The choice is kept for 12 hours per species. Recomputing it is up to four
 * BirdWeather pages, which is fine once but not on every press of a button a
 * four-year-old will press repeatedly; and a stable clip is nicer to hear
 * again anyway. One KV write per species per 12 hours stays well inside the
 * free tier's 1,000 a day.
 */
async function bestRecording(sci: string, env: Env): Promise<Response> {
  try {
    if (env.CACHE) {
      const hit = await env.CACHE.get(bestRecordingKey(sci));
      if (hit && birdweatherMedia(hit)) return Response.redirect(hit, 302);
    }
    const cfg = readConfig(env);
    const speciesId = await searchSpecies(sci);
    if (!speciesId) return json({ error: 'no recording' }, 404);

    for (const days of BEST_RECORDING_WINDOWS_DAYS) {
      const { detections } = await fetchDetections({
        stationIds: cfg.stationIds,
        period: { count: days, unit: 'day', timezone: cfg.tz },
        scoreGte: cfg.scoreGte,
        speciesId,
        cap: BEST_RECORDING_CAP,
      });
      const best = pickBestRecording(detections, (u) => birdweatherMedia(u) !== null);
      if (!best?.soundscapeUrl) continue;
      const target = birdweatherMedia(best.soundscapeUrl)!;
      if (env.CACHE) {
        try {
          await env.CACHE.put(bestRecordingKey(sci), target, { expirationTtl: 43_200 });
        } catch {
          // Only costs the fast path next time.
        }
      }
      return Response.redirect(target, 302);
    }
    return json({ error: 'no recording' }, 404);
  } catch (err) {
    console.error('best recording lookup failed:', err);
    return json({ error: 'no recording' }, 404);
  }
}

/**
 * A species description, from Wikipedia, slanted towards Australia.
 *
 * The REST summary endpoint returns only the lead paragraph, which for an
 * introduced bird describes somewhere else entirely — the Spotted Dove's
 * reads as a bird of the Indian subcontinent, which is true and useless to
 * someone in suburban Melbourne. So we pull the full article and pair that lead with
 * the paragraph that says most about the species HERE. For the Spotted Dove
 * that is "In Australia they were introduced into Melbourne in the 1860s and
 * have since spread out".
 *
 * Cached a week: a species account does not change.
 */

/** Places, most specific first. A paragraph naming Melbourne beats one
 *  naming Australia. */
const PLACE_WEIGHTS: [RegExp, number][] = [
  [/\bMelbourne\b/i, 6],
  [/\bVictoria(n)?\b/i, 4],
  [/\b(New South Wales|Queensland|Tasmania|South Australia|Western Australia)\b/i, 2],
  [/\bAustralian?\b/i, 2],
];
/** Topics a reader looking at a bird in their garden actually wants. */
const TOPIC_WEIGHTS: [RegExp, number][] = [
  [/\bintroduc|\bnaturalis|\bestablish|\bspread\b/i, 4],
  [/\bfound in\b|\brange\b|\bdistribut|\bnative to\b|\boccurs\b/i, 4],
  [/\bgarden|\bsuburb|\burban|\bpark\b/i, 3],
  [/\bcommon\b|\babundant\b/i, 1],
];
/** Breeding and diet minutiae. True, but not what you want first when a bird
 *  you just heard is on screen — and a nesting paragraph that happens to say
 *  "urban Melbourne" would otherwise outrank the distribution paragraph. */
const TOPIC_PENALTIES: [RegExp, number][] = [
  [/\bnest|\begg|\bclutch|\bincubat|\bfledg|\bnestling|\bchick/i, 6],
  [/\bplumage\b|\bmoult|\bsubspecies\b|\btaxonom/i, 3],
];

function scoreForAustralia(paragraph: string): number {
  let score = 0;
  for (const [re, weight] of PLACE_WEIGHTS) if (re.test(paragraph)) score += weight;
  if (!score) return 0; // must mention somewhere in Australia at all
  for (const [re, weight] of TOPIC_WEIGHTS) if (re.test(paragraph)) score += weight;
  for (const [re, weight] of TOPIC_PENALTIES) if (re.test(paragraph)) score -= weight;
  return score;
}

async function wiki(url: URL, env: Env): Promise<Response> {
  const sci = url.searchParams.get('sci') ?? '';
  if (!sci) return json({ error: 'sci= required' }, 400);

  const payload = await cached(env.CACHE, `v2:wiki:${sci.toLowerCase()}`, TTL.wiki,
    () => buildDescription(sci));
  if (!payload) return json({ error: 'no description' }, 404);
  return json(payload);
}

async function buildDescription(sci: string) {
  const query = new URLSearchParams({
    action: 'query', prop: 'extracts', explaintext: '1', redirects: '1',
    format: 'json', titles: sci.trim(),
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${query}`, {
    headers: {
      'user-agent': 'melb-avian-visitors/0.1 (https://github.com/toddhannett-bit/melb-avian-visitors)',
      accept: 'application/json',
    },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  const text = (page?.extract ?? '').trim();
  if (!text) return null;

  const paragraphs = text
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 90 && !p.startsWith('=='));
  if (!paragraphs.length) return null;

  const lead = paragraphs[0]!;
  let best = '';
  let bestScore = 0;  // a paragraph must score above zero to be worth showing
  for (const paragraph of paragraphs.slice(1)) {
    const score = scoreForAustralia(paragraph);
    if (score > bestScore) { best = paragraph; bestScore = score; }
  }

  const chosen = best && best !== lead ? [lead, best] : [lead];
  const title = page?.title ?? sci;
  return {
    title,
    extract: chosen.join('\n\n'),
    paragraphs: chosen,
    source: {
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
    },
  };
}

/**
 * The admin menu, deliberately empty.
 *
 * Upstream's admin surface configures the BirdNET-Pi it runs on — recording
 * settings, the BirdWeather upload token, educator scopes. We have no Pi to
 * administer: the mic's settings live in BirdWeather's own app, and ours are
 * in wrangler.toml. So this reports an unlocked, featureless menu rather than
 * 404ing, which the frontend swallows but logs.
 */
function menu(): Response {
  return json({
    items: [],
    chroma: 0,
    auth: {
      required: false,
      direct_local: false,
      lan_policy: false,
      password_configured: false,
      recovery: false,
    },
  });
}

/**
 * Serve a bird's cutout.
 *
 * Upstream read a PNG off the Pi's disk. We serve the illustrations vendored
 * into web/avian/assets/illustrations, and fall back to BirdWeather's own
 * species photo for the 33 species we have no art for yet. The photo is not a
 * cutout, so it will not appear in the collage — there is no silhouette mask
 * for it — but it gives the atlas and the postcard something true to show.
 */
async function cutout(url: URL, env: Env): Promise<Response> {
  const sci = url.searchParams.get('sci') ?? '';
  if (!sci) return json({ error: 'sci= required' }, 400);
  const pose = Number.parseInt(url.searchParams.get('pose') ?? '1', 10);
  const slug = sci.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  const file = pose > 1 ? `${slug}-2.png` : `${slug}.png`;

  if (env.ASSETS) {
    const hit = await env.ASSETS.fetch(
      new Request(`${url.origin}/avian/assets/illustrations/${file}`),
    );
    if (hit.ok) {
      // Art is immutable per revision; the frontend cache-busts with &v=.
      const headers = new Headers(hit.headers);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      return new Response(hit.body, { status: 200, headers });
    }
  }

  const photo = await cached(env.CACHE, `v1:photo:${slug}`, 86_400, async () => {
    const res = await fetch('https://app.birdweather.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query($n:String!){ searchSpecies(query:$n, first:1){ nodes { imageUrl } } }`,
        variables: { n: sci },
      }),
    });
    const body = (await res.json()) as {
      data?: { searchSpecies?: { nodes?: { imageUrl?: string }[] } };
    };
    return body.data?.searchSpecies?.nodes?.[0]?.imageUrl ?? null;
  });

  // Through the same allowlist as recording.php. BirdWeather serves these
  // from media.birdweather.com, so this costs nothing today — but the URL
  // comes from an upstream response rather than from us, and this route is
  // public, so it should not be able to redirect anywhere it likes.
  const target = photo ? birdweatherMedia(photo) : null;
  if (target) return Response.redirect(target, 302);
  return new Response('no art', { status: 404 });
}

/** Are we on our own mic or the neighbourhood, and when did we last hear anything? */
async function health(env: Env): Promise<Response> {
  const cfg = readConfig(env);
  const info = await cached(env.CACHE, `v1:health:${cfg.stationIds.join(',')}`, TTL.station,
    () => stations(cfg.stationIds));
  return json({
    source: cfg.ownStationId ? 'own-station' : 'neighbourhood',
    using_fallback: cfg.usingFallback,
    score_gte: cfg.scoreGte,
    timezone: cfg.tz,
    stations: info,
    as_of: isoNow(),
  });
}

async function gateFor(
  cfg: ReturnType<typeof readConfig>,
  env: Env,
): Promise<SpeciesGate> {
  const serialised = await cached<SerialisedGate>(
    env.CACHE,
    `v1:gate:${cfg.stationIds.join(',')}:${cfg.scoreGte}`,
    TTL.gate,
    async () => serialiseGate(await buildGate({
      stationIds: cfg.stationIds,
      scoreGte: cfg.scoreGte,
      tz: cfg.tz,
    })),
  );
  return reviveGate(serialised);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
