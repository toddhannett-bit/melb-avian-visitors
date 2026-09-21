# The shim

Serves the AvianVisitors frontend's `birdnet-api.php` contract from
BirdWeather's public API, so the forked frontend runs with no Raspberry Pi, no
PHP, no SQLite and no tunnel into anyone's house.

```
a mic ──► BirdWeather ──► this Worker (cached) ──► forked frontend
```

## Status

The eight endpoints `apt.js` calls are implemented and verified against the six
live stations configured in `wrangler.toml`. `npm run live` currently passes
**31/31**.

| Action | Source | Score-filtered |
|---|---|---|
| `recent` | paged detections | **exactly**, per detection |
| `hourly` | paged detections, one local day | **exactly** |
| `rhythm` | paged detections, minute-of-day slots | **exactly** |
| `stats` | `counts` + `topSpecies` | species yes, detection totals no |
| `timeseries` | `dailyDetectionCounts` + 30d detections | by-hour yes, daily no |
| `lifelist` | `topSpecies` + 90d detections for dates | by species |
| `firstseen` | 90d detections | **exactly** |
| `calendar` | `dailyDetectionCounts` | no (it only marks which days have data) |

Plus:

| route | purpose |
|---|---|
| `?action=species&sci=` | one species: lifetime summary and its recordings, for the postcard |
| `recording.php` | resolves a detection to its BirdWeather soundscape and 302s to it (see below) |
| `wiki.php` | species description, slanted to Australia (see below), cached a week |
| `cutout.php` | a vendored illustration, falling back to a BirdWeather photo |
| `menu.php` | deliberately empty — there is no Pi to administer |
| `/healthz` | which stations we read, and when each last heard anything |

`species` pages its recordings but takes its lifetime totals from the per-day
aggregate, because counting the page would report "5 detections all time" for
a bird heard 207,166 times.

## Two upstream landmines

Both cost real debugging time. Neither is documented by BirdWeather.

**1. `scoreGte: null` matches nothing.** An explicit null is compared against,
not treated as "no filter", so passing `scoreGte: opts.scoreGte ?? null` returns
zero detections. The variable has to be *absent*. This silently emptied every
detection-backed view.

**2. `totalCount` ignores the filter arguments.** It reports the same 92,976
whether `scoreGte` is 6, 9 or omitted — only `nodes` is filtered. An earlier
gate counted `totalCount` and concluded all 71 species passed, including the
Glossy Black-Cockatoo the whole filter exists to remove.

Also worth knowing: `sortBy: "timestamp"` returns nothing, and the `species`
query is a connection (`nodes { … }`), not a list.

## The quality gate

`score >= 6.0`, for the reasons measured in
[`../docs/SPIKE.md`](../docs/SPIKE.md) §2 — confidence
does not separate false positives here and score does.

Windowed views filter per detection upstream. Aggregate queries take no score
argument, so those are filtered by a species allow-list: **has this species ever
cleared the floor in the last 90 days?** Over the six example stations that
keeps 51 of 71 species and rejects 20, including every implausible one.

Corroboration (2+ detections, or 2+ stations) was tested and rejected — it
removes no additional junk, because none survives the floor anyway, and it costs
Willie-wagtail, Laughing Kookaburra and Long-billed Corella.

**Known casualties**, all genuine Melbourne birds that fall below the floor:
Tawny Frogmouth, Peregrine Falcon, Southern Boobook, Sacred Kingfisher,
Horsfield's Bronze-Cuckoo, Common Greenshank. These are what PLAN.md §4.1's
"possible visitor" tier is for — not yet built.

## Australian descriptions

Wikipedia's REST summary endpoint returns only the lead paragraph, which for
an introduced bird describes somewhere else entirely: the Spotted Dove's
reads as a bird of the Indian subcontinent. True, and useless to someone in
suburban Melbourne.

So `wiki.php` pulls the full article and pairs that lead with the paragraph
that says most about the species *here*, scored by place (Melbourne beats
Victoria beats Australia) and by topic. Introduction, distribution and urban
habitat score up; nesting, egg and plumage minutiae score **down**, because a
paragraph about nest construction that happens to say "urban Melbourne" would
otherwise outrank the distribution paragraph — which is exactly what happened
to the Little Raven before the penalties existed.

What that produces:

- **Spotted Dove** — "In Australia they were introduced into Melbourne in the
  1860s and have since spread out"
- **Common Myna** — "first introduced to Australia between 1863 and 1872, in
  Victoria, to control insects in the market gardens of Melbourne"
- **Little Raven** — "more abundant and widespread in Melbourne since the
  1980s, spreading northwards and westwards, adapting well to its urban
  surrounds"

Tuning lives in `PLACE_WEIGHTS`, `TOPIC_WEIGHTS` and `TOPIC_PENALTIES`. Note
Wikipedia rate-limits a shared egress IP hard; the week-long cache means
production makes one request per species, but testing will get 429s.

## Resolving a recording

BirdWeather has **no singular `detection(id:)` query** — only the `detections`
connection — so a recording cannot be fetched by id alone. An earlier version
queried that non-existent field and every recording failed with "recording
unavailable".

Two paths instead:

1. **Fast.** The postcard always loads `action=species` before any of its rows
   can be clicked, and that response already carries every soundscape URL, so
   the handler stashes a detection-id → url map as it goes past. One KV entry
   per species, not per detection: 500 rows would be 500 writes against a
   1,000/day free-tier limit.
2. **Slow.** On a cold cache or a directly-opened link, walk that species'
   recent detections and find the id. About a second.

The Worker only ever redirects; the audio never passes through it.

## A dev gotcha

`wrangler dev` **simulates KV locally and persists it** to `.wrangler/state`,
so once a namespace is bound, a code change can appear to do nothing while a
stale cached response is served — a 36 ms reply where a real query takes four
seconds is the tell. Clear it:

```bash
rm -rf worker/.wrangler/state
```

## Running it

```bash
npm install
npm test          # unit tests: timezone maths, gate serialisation
npm run live      # hits the real API and the real stations
npm run dev       # wrangler, http://localhost:8787
```

`npm run dev` works with no KV namespace bound — the cache degrades to a
pass-through. Bind one before deploying:

```bash
wrangler kv namespace create CACHE   # then paste the id into wrangler.toml
```

## Configuration

All in `wrangler.toml` `[vars]`:

| Var | Meaning |
|---|---|
| `STATION_IDS` | The neighbourhood cluster, public stations within ~5 km of you |
| `OWN_STATION_ID` | **Stage two.** Set this to your own station and every view narrows to your back yard. Empty until then |
| `TIMEZONE` | `Australia/Melbourne`. Load-bearing — see `src/time.ts` |
| `SCORE_GTE` | The gate. Re-tune after your mic's first week; a less sensitive capsule scores lower across the board |
| `SITE_NAME` | Shown in the frontend's header |

## Timezone

A Worker runs in UTC; Melbourne is 10–11 hours ahead. A naive date is
*yesterday* for most of the local day, and the dawn chorus smears across the
boundary. Everything dated goes through `src/time.ts`, which works in the
station's zone, and `InputDuration` carries `timezone` so BirdWeather resolves
day boundaries the same way we do. The AEST/AEDT change is covered by tests.
