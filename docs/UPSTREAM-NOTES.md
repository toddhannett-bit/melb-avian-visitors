# What Theodore already solved

Notes from [theodore.net/projects/AvianVisitors](https://theodore.net/projects/AvianVisitors/),
with every parameter **verified against `avian/frontend/apt.js`** in the repo
rather than taken from the write-up alone.

This is the highest-value thing upstream has that isn't in its README. The
layout engine is tuned, and the tuning is *documented with its reasoning*. We
should adopt the numbers and skip the rediscovery.

> **Licence note.** These are published facts and parameters, not code we're
> taking. Reimplementing a spiral packer from a described exponent is fine;
> vendoring `apt.js` would pull us into CC-BY-NC-SA. Write our own, use his
> constants as the starting point, credit him.

---

## 1. The layout engine — adopt this wholesale

My earlier plan said only "size by log-count or rank". He's already solved it
properly, and better than that.

**Viewport-budget normalisation, not per-tile caps.** The comment at
`apt.js:1140` explains why, from real failure:

> *"The old per-tile cap made every loud bird look identical (Anna n=398, Crow
> n=31 and Phoebe n=26 all hit ceiling and rendered the same size) AND it
> allowed total area to overflow narrow viewports so birds got dropped
> off-screen."*

This matters enormously here, where **Spotted Dove is 31–43% of all
detections**. A naive cap would flatten Dove, Raven, Blackbird and Miner into
identical blobs. His normalisation makes relative size track the relative call
ratio instead.

The tuned set (`apt.js:1151–1176`), verbatim:

| Parameter | Value | Purpose |
|---|---|---|
| `packingBudgetFrac` | 0.46 (n≤4) → 0.40 (n≤12) → 0.34 (n≤24) → 0.28 | Share of viewport area the cluster aims to fill. Steps down as species count grows |
| `countExp` | **0.65** | Count→area exponent. "n=400 reads ~5× bigger than n=30 without the loudest bird drowning everything else" |
| `minTileAreaFrac` | 0.0100 (n≤8) → 0.0075 (n≤20) → 0.0055 | Floor, so even an n=1 rarity stays recognisable |
| `ellipseAspectBias` | 2.1 | Wider clusters on landscape viewports |
| `GRID_STRIDE` | 4 px | Occupancy-grid cell size; smaller = slower |
| `COLLAGE_PAD` | 3 cells | Bird-to-bird breathing room |
| `COLLAGE_LABEL_PAD` | 1 cell | Labels are thin ink; decoupled so a name doesn't reserve a bird-sized moat |
| `FLY_PROB` | **0.15** | Chance of the flight pose. Rolled once per window appearance |
| shrink step | 0.93 linear (≈0.86 area), ≤10 iterations | Scale-to-fit loop when tiles overflow |
| poll | 30 s | `POLL_MS` |

**Algorithm:** centre-outward spiral packing onto an occupancy grid; collision
by **binary silhouette masks as base64 bit-arrays**, stored sparse (only "on"
cells) so tests are linear in opaque area, not bounding box. Full re-pack rather
than incremental insertion — *"repacking ~10 species at the current grid stride
(4px) takes <20ms in V8 on a Pi 4 client."*

Verified to hold from 390 px phones to 4K.

**Our takeaway:** `countExp: 0.65` and viewport-budget normalisation directly
answer the open question in `PLAN.md` §4.2. Start there. With only ~25 species
on a back-yard mic we're in his `n ≤ 24 → 0.34` band, or arguably sparser still.

## 2. Labels nested into the silhouette

Names are laid **along the bird's own edge**, not captioned underneath. Each
candidate edge run is scored on how much of the name it carries, how straight it
stays (chord length vs traced path), and how far the letters would lean;
the winner gets a sweep test against neighbouring masks so strokes can't collide.
`LABEL_SEAT = 0.35`, swept 0.05–0.80 with everything from 0.05–0.65 giving
identical results.

Lovely, and expensive. **Phase 4 at the earliest.** Labels are off by default on
the frame anyway.

## 3. The art pipeline's real failure rate

The write-up is more honest than the repo README, and it strongly supports
[our switch to historical plates](ART-SOURCES.md):

- ~**3% anatomical defects in perched poses, ~5% in flight**
- Flight poses needed **5–6 regeneration attempts per species** — Gemini reads
  feather masses as extra wings and draws three
- The bundled set only exists because of a substantial manual audit pass

**And a new finding this surfaces:** `FLY_PROB = 0.15`, so the flight pose —
the one that costs 5–6 attempts — is shown **15% of the time**. Gould's
lithographs are overwhelmingly perched or standing birds; flight plates are
rare in the 1840s volumes.

~~So: ship perched-only, set `FLY_PROB = 0`.~~ **Superseded.** That followed
from using Gould plates, which are overwhelmingly perched birds. We are
generating the four missing species instead (see
[`ART-SOURCES.md`](ART-SOURCES.md)), and the eighteen we already ship have
flight poses, so keeping `FLY_PROB = 0.15` costs four extra images and keeps
the collage's variety. His failure rate still stands as a warning: **review
every flight pose**, and expect to regenerate some.

## 4. Hosting — confirms our architecture

He serves `bird.onethreenine.net` from the Pi via **Cloudflare Tunnel**, to get
public HTTPS without exposing a home IP. That's the workaround our design makes
unnecessary: because we read his detections back out of BirdWeather, there is no
tunnel, no port forward, no dynamic DNS, and nothing exposed on his network.

Worth noting he also offers **Cloudflare Browser Rendering** to generate the
frame PNG server-side, so a Pi Zero just fetches a finished image instead of
rendering the collage itself. That is precisely the `/frame.png` route
`PLAN.md` §7 proposes — independently arrived at, and now with a known-good
implementation path.

## 5. E-ink timing (for later)

- **12 seconds per panel refresh** — *"these displays are mechanical processes,
  and physically move pigment around with an electric field"*
- Refreshes at most every **15 minutes**, and only when the birds actually changed
- Backing plate prints in two pieces (printer bed), superglued, then hot-glued
  to the frame

## 6. Microphone — his is *less* weatherproof than ours needs to be

Directly relevant to [`HARDWARE.md`](HARDWARE.md). His mic is a USB lavalier on
an **apartment balcony** on a 3D-printed base, and he is candid:

> *"these two prints are 'california weather grade' (lol) for now and really
> aren't meant for any weather besides clear blue skys"*

An all-weather enclosure is listed as future work.

**Two things follow.** First, it confirms the cheap path — the reference build
is a lavalier on a balcony, not a sealed instrument, and it works. Second,
**Melbourne is not California.** Melbourne does horizontal rain, and a
back-yard mount needs more than an upturned jar. Either keep the capsule under
a genuine eave, or budget an enclosure. This is the one place where his design
does *not* transfer, and it's the thing the A$499 PUC was actually selling.

Also concrete, for our Tier 1: the **Zero 2 W needs a swap file configured and
Wi-Fi power-save disabled** to cope with 512 MB. Add that to the build notes.

## 7. The live deployment — and what it accidentally proves

[`bird.onethreenine.net`](https://bird.onethreenine.net/) ("Apartment Birds")
is the reference deployment. Two things worth having.

**The view structure**, richer than the repo suggests, and a good menu to pick
from for `PLAN.md` §3:

- Time windows **1H / 12H / 24H / 7D / ALL**
- **Heard Recently** — by date, with an hourly timeline
- **By Period** — detections by recency
- **Top Species** — for the selected window
- **First Detections** — newest lifelist additions
- **Today's Rhythm** — today's pulse against the weekly average
- Taxonomic filters (Family / Genus / Species / Rarity), per-detection
  confidence and "last heard", plus an atlas/stats view

**A calibration point.** His public `stats` endpoint reports **57,959
detections across 56 species since 2026-05-15** — about four months from a
single apartment-balcony microphone. That is the realistic expectation for a
single back-yard mic, and it lines up with the nearest station's ~25
species/month. Our own mic will land in the same range: *tens* of species, not
hundreds.

**And the risk, demonstrated on the reference project itself.** As of
2026-09-20 the site serves `as_of: 2026-09-07`, `today: 2 detections`,
`last_hour: 0`. The `last-modified` header from origin is **13 days old** —
`cf-cache-status: HIT, age: 18` against `max-age=30`, so this is the cache
working correctly and the origin genuinely serving stale data. His station has
been down or disconnected since 7 September.

No criticism intended — it's a Raspberry Pi in someone's apartment, and this is
exactly what Raspberry Pis in apartments do. **That's the point.** It is the
single best evidence for the fallback we specced: a single hobbyist mic *will*
go quiet, sometimes for weeks, and the app has to notice and say so rather than
silently render an empty sky. Concretely, ours should:

- treat "no detections in N hours" as a **state**, not an empty list;
- fall back to the 5 km neighbourhood cluster and label it honestly;
- surface "last heard from your mic: 13 days ago" rather than hiding it.

**One convention, free:** `dims.json` is a flat public map of every
illustration's pixel dimensions, keyed by scientific-name slug, with `-2`
marking the second (flight) pose — `acanthis-flammea` / `acanthis-flammea-2`.
The Brisbane fork uses the same `-2` convention, so an art import can rely on it.

## 8. Costs, for the record

Base mic system **~US$80**; e-ink frame build **~US$362** (13.3" panel $299.99,
wooden frame $21.99). Install runs unattended in 20–40 min.

---

## What we take

| Take | Leave |
|---|---|
| `countExp: 0.65` + viewport-budget normalisation | The PHP/SQLite backend |
| The full tuning table above as our starting point | `apt.js` itself (licence) |
| Silhouette-mask collision, sparse bit-arrays | Kachō-e AI generation |
| 30 s poll, full re-pack (<20 ms — it's cheap) | Cloudflare Tunnel (we don't need it) |
| `/frame.png` via server-side rendering | Flight poses (`FLY_PROB = 0`) |
| The honest failure rates, as evidence for plates | "California weather grade" mounting |

Source: [theodore.net/projects/AvianVisitors](https://theodore.net/projects/AvianVisitors/) ·
[`apt.js`](https://github.com/Twarner491/AvianVisitors/blob/main/avian/frontend/apt.js)
