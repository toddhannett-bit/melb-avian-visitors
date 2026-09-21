# A Melbourne AvianVisitors

**Status:** the feasibility plan this was built from. Kept as written, because
the reasoning is more useful than a tidy retrospective would be.
**Date:** 2026-09-20 (revised after the spike)
**Location:** inner north-west Melbourne, VIC
**Reference project:** [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors)
**Spike results:** [`docs/SPIKE.md`](docs/SPIKE.md) — §4.1, §5 and §6 below are rewritten from it
**Hardware:** [`docs/HARDWARE.md`](docs/HARDWARE.md) — your own mic, Phase 1, ~A$35–130
**Art sources:** [`docs/ART-SOURCES.md`](docs/ART-SOURCES.md) — what already exists for Australia
**Upstream notes:** [`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md) — the tuned layout parameters, taken from Theodore's write-up and verified in his code

---

## Verdict

**Feasible, and cheaper than expected — because the hard part turns out to be
already solved for Melbourne.**

The headline risk going in was "AvianVisitors needs a Raspberry Pi with a
microphone in a window; our friend has neither, and a web app can't hear
birds." That risk is gone. Melbourne is densely covered by public BirdNET
stations whose data is queryable, live, anonymously, for free.

Verified today against the live BirdWeather GraphQL API:

| Measure (greater Melbourne bounding box) | Value |
|---|---|
| Public stations reporting in the last 30 days | **78** |
| Stations actively detecting in inner Melbourne | **39** |
| Detections, last 24 hours, inner Melbourne | **13,139** |
| Detections, last 30 days | **546,135** |
| Distinct species, last 30 days | **125** |
| Distinct species, last 90 days | **183** |
| Most recent detection at time of check | **< 2 minutes old** |

**For this location specifically** (spike, 2026-09-20): there is a live station
just over a kilometre away — `30108` — plus five more within 5 km, together
logging ~50,000 detections and 62 species a month. That is effectively a
microphone in the same neighbourhood.

So day one can ship with **no hardware at all**, and if the friend later wants
their own microphone in their own window, they buy a Pi, register it with
BirdWeather, and we change one parameter in a query. The architecture below is
built around that upgrade path deliberately.

The real work is not data. It's **art** (169 species to illustrate) and
**signal quality** (BirdNET false positives are a visible problem in this
dataset). Both are bounded and addressed below.

---

## 1. What AvianVisitors actually is

Worth being precise, because we are porting the *idea*, not the *code*.

It is a fork of BirdNET-Pi with an overlay on top:

- **Detection:** a USB lavalier mic in a window feeding BirdNET-Pi's
  `BirdNET_GLOBAL_6K_V2.4` TFLite model (6,522 species labels), running on a Pi.
- **Backend:** ~10,000 lines of PHP in `avian/api/` reading BirdNET-Pi's local
  SQLite database. `birdnet-api.php` alone serves `stats`, `lifelist`,
  `timeseries`, `firstseen`, `recent`, `rhythm`, `hourly`, `calendar`.
- **Frontend:** ~6,600 lines of vanilla JS (`apt.js`) plus `stamps.js`, drawing a
  collage of cut-out bird illustrations laid out against precomputed silhouette
  masks (`dims.json` / `masks.json`).
- **Art:** 666 PNGs — 498 kachō-e illustrations covering 249 species in two poses
  each (perched + flight), generated with Gemini 2.5 Flash Image on a flat cream
  ground, then background-removed with BiRefNet and cropped.
- **Frame (optional):** a second Pi screenshots the website, mats the image onto
  an A5 opening, and pushes it to a Pimoroni Inky Impression 13.3" Spectra 6
  e-ink panel, refreshing only when the birds change.

### What we can reuse, and what we can't

| Component | Reusable for us? | Why |
|---|---|---|
| The concept and visual language | **Yes, fully** | It's the whole point |
| Art generation pipeline (`pregen.py` → `cutout.py` → `build_masks.py` → `verify.py`) | **Yes, conceptually** | Already supports `--ebird-region`, so `AU-VIC` is a documented path. Needs a model bump (§5) |
| The 666 existing illustrations | **Almost none — 14 of 183 species** | Its set is western-US. Overlap is only the tramp species: House Sparrow, Starling, Rock Pigeon, Mallard, Peregrine, Barn Owl, Osprey, Cattle Egret, Great Egret, Caspian Tern, Sanderling, Black-bellied Plover, California Quail, Ring-necked Pheasant |
| PHP API layer | **No** | Assumes a PHP host colocated with a BirdNET-Pi SQLite file. We have neither — replaced by a Worker serving the same shapes (§2) |
| `apt.js` frontend | **Yes — fork it** | Licence is a non-issue for personal use, and it's 6,600 lines of *tuned* renderer. Keep it; swap what's underneath (§2) |
| Frame code (`frame/`) | **Yes, unmodified** | It already has an `--image-url` mode that just renders a PNG from a URL. See §7 |

### Licensing — resolved: it doesn't matter

AvianVisitors is **CC-BY-NC-SA-4.0**, inherited from BirdNET-Pi. Non-commercial,
share-alike.

**This is personal, not commercial, so the licence costs us nothing.** Comply and
move on: credit upstream, license this repo CC-BY-NC-SA-4.0 too, done. The
earlier recommendation to clean-room the frontend was discipline bought for a
commercial option that doesn't exist.

That changes the build substantially — see §2.

## 2. Data architecture

### Three tiers, same app

```
Tier 1  — your own mic         →  stationIds: ["<your id>"]       ← PRIMARY
Tier 0  — neighbourhood        →  public stations within R km     ← fallback + "nearby" view
Tier 2  — enrichment/fallback  →  eBird data/obs/geo/recent (human sightings)
```

**Tier 1 is the product**, not a later upgrade: the point of buying a mic is
that the app shows *your back yard*. Tier 0 becomes the fallback for when that
mic drops out, plus an optional "within 5 km" view.

Crucially this **changes nothing architecturally**. Your mic publishes to
BirdWeather like every other station, so it is one more `stationId` and Phase
1's only difference is which one. See [`docs/HARDWARE.md`](docs/HARDWARE.md)
§3 — notably, it means **no tunnel into the home network**: no port forwarding,
no dynamic DNS, no Cloudflare tunnel, unlike upstream, which serves its site
from the Pi itself. We can build and test the whole app against station `30108`
while the hardware ships, then flip one config value.

Tier 2 is optional and covers "what's around that the mics can't hear" (raptors,
waterbirds, anything quiet).

### BirdWeather GraphQL — verified working

Endpoint `https://app.birdweather.com/graphql`, POST, **no auth, no token**,
explorer at `/graphiql`. Relevant queries confirmed present:

`detections`, `species`, `stations`, `counts`, `topSpecies`,
`dailyDetectionCounts`, `timeOfDayDetectionCounts`, `birdnetSightings`,
`ebirdSightings`, `searchSpecies`, `allSpecies`.

Verified working query (reproduce with `curl`):

```graphql
{
  detections(
    period: {count: 1, unit: "day"}
    ne: {lat: -37.6, lon: 145.2}
    sw: {lat: -38.0, lon: 144.7}
    first: 3
  ) {
    totalCount
    nodes {
      timestamp confidence probability score
      species { commonName scientificName imageUrl }
      station { id name }
      soundscape { url }          # FLAC of the actual 3s clip
    }
  }
}
```

Note `soundscape.url` — **we get the actual audio**. "Tap the bird, hear the
recording that triggered it, from a mic 800m from your house, twelve minutes
ago" is a better feature than anything in the reference project's web UI, and
it's free.

Also note `species.imageUrl` — BirdWeather serves a photo per species. That's our
**art fallback**, and it lets Phase 1 ship before a single illustration exists.

### Caching and citizenship

BirdWeather publishes a schema but **no documented rate limits, terms of use, or
attribution requirements**. That's a soft risk, not a blocker. Mitigations:

- All queries go through **our** server function; the browser never hits
  BirdWeather directly. One upstream request serves all our viewers.
- Cache aggressively: 5 min for live detections, 1 h for daily aggregates,
  24 h for species metadata. At that rate we make ~300 upstream requests/day
  total, regardless of traffic.
- Attribute BirdWeather and the contributing stations prominently in the UI.
- Email support@birdweather.com before launch, describe the use, ask if the
  volume is acceptable. Costs nothing and converts an unknown into a yes/no.

### eBird (Tier 2, optional)

Free key from `ebird.org/api/keygen`, ~1,000 requests/day, non-commercial.
`GET /v2/data/obs/geo/recent` for sightings near a point; `GET
/v2/product/spplist/AU-VIC` for the Victorian species list. Key must be
server-side only. We need this anyway for the range filter in §4.

### Proposed approach: fork the frontend, replace the backend

With the licence no longer a constraint, **don't rebuild the collage renderer.**
Upstream's `apt.js` is ~6,600 lines of *tuned* frontend — the viewport-budget
packer, `countExp: 0.65`, silhouette-mask collision, label nesting, and the whole
view set. Rebuilding that from scratch is a week of work to arrive somewhere
worse.

The only thing genuinely incompatible is the data layer. `apt.js` calls
`./avian/api/birdnet-api.php?action=…`, which reads BirdNET-Pi's **local SQLite**.
We don't have a Pi serving the site. (`birdweather.php` doesn't help — it's an
admin facade for the *upload* token, not a data source.)

**So: keep the frontend, reimplement the eight endpoints it calls as a Cloudflare
Worker backed by BirdWeather.** The frontend never knows the difference.

| | |
|---|---|
| Static files | `index.html`, `apt.js`, `styles.css`, `dims.json`, `masks.json`, cutouts — Cloudflare Pages |
| Worker | Routes `/avian/api/birdnet-api.php?action=…` and serves the same JSON from BirdWeather GraphQL, cached in KV |
| PHP | **None.** The path is just a URL shape we honour |

The shapes are simple and flat, and upstream's live site documents them. For
example `lifelist`:

```json
{"species":[{"sci":"Corvus brachyrhynchos","com":"American Crow",
  "first_seen":"2026-05-15 16:04:21","last_seen":"2026-09-07 08:59:16",
  "n":1740,"best_conf":0.9708}]}
```

— which is nearly a direct rendering of BirdWeather's `topSpecies` plus
first/last detection. The eight actions are `stats`, `lifelist`, `timeseries`,
`firstseen`, `recent`, `rhythm`, `hourly`, `calendar`, each documented in
comments at `apt.js:3246`.

**Upstream even gives us the offline contract for free.** Its live site currently
returns `{"error":"sensor offline","action":"recent"}` — the frontend already
knows how to render "the mic isn't reporting". That's §3's honest empty state,
already built.

Estimated: **a few days for the shim**, against a week-plus to rebuild the
renderer. And we inherit every future fix upstream makes to the frontend.

**What we still write ourselves:** the quality filter (§4.1), the Australian art
set (§5), the `/frame.png` route (§7), and the Melbourne-specific seasonal logic.

### Hosting

- **Cloudflare Pages + Workers**, free tier, comfortably at this scale.
- **Domain ~A$15–25/yr.** Total running cost **~A$25/year.**
- You own both, so the site does not depend on anything in the house it watches.

## 3. What the app actually shows

Following the reference project's instinct — this is an *ambient art object*
first and a dashboard second. In priority order:

1. **The collage.** Birds heard near the window in the last N hours,
   drawn as overlapping cut-out illustrations, sized by how often they were
   heard. This is the product.
2. **Time control.** Last hour / today / this week. The reference project's
   `rhythm` and `hourly` views are the good idea here — Melbourne's dawn chorus
   is a genuinely different shape from its 4pm lorikeet racket.
3. **Tap a bird** → common + scientific name, when it was last heard, which
   station heard it, **play the recording**, and a line of context.
4. **First-of-season / new species** callout. Southern-hemisphere calendar
   (see §4), so this is *our* logic, not ported.
5. **An honest empty state.** Not a nice-to-have: the reference deployment has
   been serving 13-day-old data since its Pi went quiet on 7 September (see
   [`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md) §7). "Nothing heard" must
   be a designed state that says *when* the mic was last heard from and offers
   the neighbourhood view — never a blank collage.
6. **Responsive down to phone.** Stated requirement: viewable on any device.
   The collage layout needs to reflow, not just scale — design masks at two
   aspect ratios from the start.

Upstream's own view set is a good menu to pick from: 1H/12H/24H/7D/ALL windows,
*Heard Recently*, *By Period*, *Top Species*, *First Detections* and *Today's
Rhythm* (today's pulse against the weekly average).

---

## 4. Melbourne-specific problems

These are the things a straight port would get wrong.

### 4.1 False positives are real — but confidence is the wrong knob

*Rewritten from measured data; see [the spike](docs/SPIKE.md) §2.*

The original instinct here was to gate on BirdNET confidence. A 12,000-detection
sweep of the local stations shows that fails badly:

| Gate | Species kept | Implausible kept | Real rarities kept | Detections kept |
|---|---|---|---|---|
| confidence ≥ 0.85 | 39 | 2 | 5 of 8 | 59.9% |
| confidence ≥ 0.90 | 28 | 1 | 2 of 8 | 43.2% |
| **score ≥ 6.0** | **39** | **0** | **8 of 8** | **99.5%** |

The clinching case: a single **Glossy Black-Cockatoo** detection carries
confidence **0.930** — higher than the mean of 21,000 Spotted Dove detections
(0.838) and higher than a genuine Laughing Kookaburra (0.830). Confidence is
BirdNET's certainty *within the clip*; it knows nothing about whether the bird
belongs here. Tightening it deletes the charismatic rarities while keeping the
junk.

BirdWeather's `score` blends confidence with locality priors and separates
cleanly — Glossy Black-Cockatoo 3.72, Kookaburra 8.60. It is filterable
server-side via `scoreGte`, so it is free to apply.

**The filter, in three tiers:**

1. `score >= 6.0` → enters the collage.
2. `score 4.5-6.0` **and** on the eBird `AU-VIC` list → "possible visitor",
   rendered faintly or in a side strip, never as a confident claim.
3. Below 4.5, or off the AU-VIC list → discarded.

Plus **corroboration** for anything rare: 2+ detections or 2+ distinct stations
before promotion. That is what catches Superb Lyrebird, which slips through at
exactly 6.00 and which a range whitelist would also wave through, since
lyrebirds are genuinely Victorian — just not in the inner suburbs.

Known casualties at this setting: Tawny Frogmouth (4.94), Peregrine Falcon
(5.29), European Greenfinch (5.55). All real, all lost. Tier 2 is what gets them
back.

**Rare birds are the feature, not the noise.** "A Kookaburra was heard on
Tuesday morning" is the most interesting thing in a month of this data. The
filter's job is to make that claim trustworthy, not to avoid making it.

### 4.2 The soundscape is inner-urban and heavily introduced

Top species within 5 km, last 30 days:

| | Species | Detections | Cumulative |
|---|---|---|---|
| 1 | Spotted Dove * | 21,315 | 42.7% |
| 2 | Little Raven | 6,679 | 56.0% |
| 3 | Eurasian Blackbird * | 6,651 | 69.4% |
| 4 | Noisy Miner | 5,947 | 81.3% |
| 5 | Rainbow Lorikeet | 2,758 | 86.8% |
| 6 | Common Myna * | 2,098 | 91.0% |
| 7 | Australian Magpie | 1,807 | 94.6% |
| 8 | Red Wattlebird | 930 | **96.5%** |

\* introduced

**Eight species are 95% of everything.** Metro-wide it was 23; here it is
denser and more urban than the metro average.

**Layout consequence:** Spotted Dove alone is 42.7% of detections. A collage
sized by raw count is a picture of one dove — **and upstream already solved
this**. Theodore normalises tile areas against a viewport budget with a
count→area exponent of **0.65**, after hitting exactly this failure with
per-tile caps ("Anna n=398, Crow n=31 and Phoebe n=26 all hit ceiling and
rendered the same size"). Adopt his tuning table rather than rediscovering it —
see [`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md) §1.

**Editorial consequence:** four of the top six are introduced. This is not a
nature scene, it is an inner-city one — doves, blackbirds, mynas and ravens,
with lorikeets and magpies over the top. Lean into that. The Galah and the
Kookaburra read as events precisely because the baseline is so urban.

### 4.2b The day has a shape, and it is free

Detections by hour, 30 days, 5 km cluster, local time — a hard 6am peak, a quiet
middle, a 5pm second wind:

```
 6:00  398  ##############################################
 7:00  291  #################################
12:00   31  ###
17:00  145  ################
```

And the species split by time of day: Spotted Dove and Rainbow Lorikeet peak at
dawn; **Eurasian Blackbird and Little Raven peak at 18:00**. A collage that
changes character across the day costs one extra query
(`timeOfDayDetectionCounts`) and no extra data source. Keep timestamps in
`Australia/Melbourne` — BirdWeather returns correct `+10:00`/`+11:00` offsets,
and normalising to UTC smears the chorus.

### 4.3 Southern hemisphere

Every seasonal assumption inverts. Spring is September–November (it is spring
right now). Breeding season, dawn chorus peak, migrant arrivals — all shifted six
months. Any "first of spring" logic must be written fresh, and all timestamps
handled in `Australia/Melbourne` with AEST/AEDT transitions (BirdWeather returns
`+10:00` / `+11:00` offsets correctly, so don't normalise to UTC and lose it).

### 4.4 Model coverage

BirdNET performs comparatively well in Australia — Oceania is among its stronger
regions, because the model's range estimates lean on eBird density and Australia
has good eBird coverage. Every species in our 183 is in the 6,522-label set by
construction. This is not a concern; noted for completeness.

---

## 5. The art — no longer the cost centre

*Rewritten. See [`docs/ART-SOURCES.md`](docs/ART-SOURCES.md) for the full
survey.*

Two people have already localised bird art for Australia, and between them they
cover **6 of the top 8 species — 95% of all detections**:

- **[`AvianVisitors-Upper-Brookfield`](https://github.com/simonwilsondesign-create/AvianVisitors-Upper-Brookfield)**
  — 43 Australian species, AI-generated through the upstream Gemini pipeline,
  Brisbane-biased, **CC-BY-NC-SA-4.0**.
- **[`fugleramme` PR #124](https://github.com/arnegiacomo/fugleramme/pull/124)**
  — 20 species cut from **John and Elizabeth Gould's *The Birds of Australia***
  by a contributor in Sydney, no AI, **CC BY-SA 4.0**. Open, not merged; the
  maintainer asked for cleaner cutting.

Nobody has done Melbourne, and nobody has done the introduced species.

### The gap is structural, and the fix is obvious

The holes in the top 8 are **Eurasian Blackbird** and **Little Raven**; widen to
the top 16 and add **European Starling**, **Forest Raven**, **Eurasian Coot**.

Gould painted Australian *natives* in the 1840s, while the Acclimatisation
Society of Victoria was still busy releasing the blackbirds. A corpus drawn from
*The Birds of Australia* structurally cannot contain the birds that now make up
two-thirds of the noise in an inner-Melbourne back yard.

But Gould also published ***The Birds of Great Britain*** (1862–73) and ***The
Birds of Asia*** (1850–83) — same artists, same lithographic style, same public
domain. Blackbird, Starling and House Sparrow come out of *Great Britain*;
Spotted Dove out of *Asia*. One visual language covers the natives and the
blow-ins, which is historically exact: Gould documented both worlds.

### Recommendation: real plates, not AI pastiche

The earlier plan had us generating ~45 species with Gemini in a Gould
*pastiche*. The Sydney contributor has demonstrated the better version — use the
actual plates.

| | AI pastiche | Real plates |
|---|---|---|
| Licence | Murky; inherits NC-SA via their prompt | **Public domain, clean** |
| Fidelity | ~3% defects perched, ~5% flight; 5–6 attempts per flight pose | It *is* the reference illustration |
| Model risk | `gemini-2.5-flash-image` retires **2 Oct 2026** | None |
| Consistency | Drifts across a batch | One artist, one press |

**And drop the flight poses.** Upstream shows the flight pose only 15% of the
time (`FLY_PROB = 0.15`) yet it cost him 5–6 regeneration attempts per species,
because Gemini reads feather masses as extra wings. Gould's lithographs are
overwhelmingly perched birds anyway. Shipping perched-only halves the art scope
again and skips his single worst failure mode. Add flight later only where a
plate happens to exist.

**The work reduces to five plates.** Reuse the ~23 species already covered
(preferring Fugleramme's CC BY-SA plates over Upper Brookfield's NC-SA AI where
both exist), then cut Blackbird, Little Raven, Starling, Forest Raven and
Eurasian Coot ourselves from the matching Gould volumes. That reaches ~99%
coverage of the local list.

**This removes the Gemini pipeline from the critical path entirely** — no API
key, no retirement deadline, no drift review, and no reason to inherit NC-SA.

Two things carry over unchanged: the **palette constraint** for a possible e-ink
panel (§7), and a **synonym-aware taxonomy map** — BirdWeather calls Spotted
Dove `Streptopelia chinensis` while Upper Brookfield files it as `Spilopelia
chinensis`, and naive string matching silently loses the single most-detected
bird.

And it's worth contributing back: `hyprcs` did twenty natives; we'd be adding
the introduced species nobody has done, from the matching volumes.

## 6. Phases

| Phase | What | Rough effort |
|---|---|---|
| **P0 — Spike** | ~~Confirm the area, pick a radius, pull local data, eyeball the false-positive tail.~~ **Done** — [`docs/SPIKE.md`](docs/SPIKE.md) | ✅ |
| **P0.5 — Order the parts** | Pi Zero 2 W build, ~A$130. Order early; the Zero 2 W is backordered at some AU retailers | 10 min |
| **P2.5 — Build the mic** | Assemble, run it at your place for a week, **add Tailscale**, register its BirdWeather station (public, rounded location) | ~1 day + a week's soak |
| **P1 — The shim** | Fork the frontend as-is; write the Worker that serves its eight endpoints from BirdWeather, cached in KV. Built against station `30108`. At the end of this the real collage renders, with upstream's US art standing in. | ~4 days |
| **P2 — Quality filter** | `score >= 6.0` gate, corroboration rule, eBird AU-VIC whitelist (§4.1). Tune against local data. | ~2 days |
| **P3 — Core art** | Import the ~23 existing Australian plates; cut Blackbird, Little Raven, Starling, Forest Raven, Eurasian Coot from Gould's *Great Britain* / *Asia*. No Gemini. **This is the moment it stops being a dashboard and becomes the thing.** | ~2 days |
| **P4 — Art fill + polish** | Remaining tail. Mask/layout tuning, time-of-day collage shift, PWA install, share card, seasonal logic. | ~1 week |
| **P5 — Hand it over** *(agreed)* | **Stage one:** give the URL, neighbourhood view. **Stage two:** install the mic, flip the station ID, it becomes one back yard | an afternoon |
| **P6 — E-ink frame** *(optional)* | See §7. | ~1 week + A$600 |

P1–P3 is the honest MVP: **a week and a half of evenings**. The spike shrank the
art set from 169 species to 8-for-96%; the art survey found 6 of those 8 already
drawn; and the licensing answer means we fork a tuned renderer instead of
building one.

**Sort the mic early** — it's the only thing with a lead time, and the app gets
built against a neighbour's mic in the meantime.

---

Ideas beyond stage two, and the artwork-gap watcher that should come first,
are in `docs/FUTURE.md`.

## 7. The e-ink path — protect it now, build it later

The reference project's frame is a Pi that **screenshots a URL** and pushes the
image to the panel. It has four source modes, one of which is
`--image-url https://.../frame.png`, which renders whatever PNG that URL serves.

**This means the frame requires no bespoke work from us, as long as our web app
exposes a route that returns a panel-sized PNG.** So:

> **Build `/frame.png` in Phase 1, even though nothing consumes it.**
> A `?frame=1` layout variant plus a server-side screenshot at panel resolution.
> It's an afternoon now. Retrofitting it into a finished frontend is a week.

Theodore arrived at the same design independently and delegates it to
**Cloudflare Browser Rendering**, so a Pi Zero fetches a finished PNG instead of
rendering the collage itself. We're already on Cloudflare, so that's a
known-good path rather than a guess. Panel constraints for later: **12 seconds
per refresh**, so it refreshes at most every 15 minutes and only when the birds
actually changed.

Plus the palette constraint in §5. Those two decisions are the entire cost of
keeping the e-ink option alive, and both are cheap today.

Hardware, when the time comes (reference BOM, USD):

| Qty | Item | ~Price |
|---|---|---|
| 1 | Pimoroni Inky Impression 13.3" (Spectra 6) | $300 |
| 1 | Raspberry Pi 3 A+ or Zero 2 W | $25–35 |
| 1 | A4 wood photo frame | $22 |
| 1 | Cable + USB brick | $16 |
| | **Total** | **~$365 USD (~A$600 landed)** |

CAD and 3D-print files for the backing are in the reference repo's
`frame/hardware/`. The panel is the whole cost; everything else is rounding.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| BirdWeather changes its API, adds auth, or asks us to stop | **High** — it's our only data source | Email them before launch. Keep the proxy layer thin so eBird can substitute. Cache hard so we're cheap to host |
| ~~Gemini image model retires 2 Oct 2026~~ | **Eliminated** | Switched to public-domain historical plates; no image model in the pipeline |
| False positives make the collage untrustworthy | **Medium** | §4.1's three-layer filter; tune with someone local watching |
| Nearby stations go offline; the area goes quiet | **Medium** | Radius fallback — widen the search until N stations respond, and say so in the UI |
| ~~Art review is 8–12 h and stalls the project~~ | **Very low** | 6 of the top 8 already exist in public Australian sets; the remaining gap is ~5 Gould plates |
| **Your own mic goes offline** — hobbyist mics do, and **the reference deployment itself has been stale since 7 Sep**; nearby station `26279` since 15 Sep | **Medium → expect it** | Auto-fall back to the 5 km cluster and say so. "Nothing heard" is a designed state showing when the mic last reported, never a blank collage |
| Back-yard mic sees far fewer species than the cluster (25 vs 62/month) | **Low — it's the point** | Design for intimacy over variety; offer a "within 5 km" toggle as a second view |
| **A budget mic lowers detection scores, and §4.1's filter gates on score** | **Medium** | `score >= 6.0` was tuned on the neighbours' mics. Re-tune against your own station after its first week, or good birds vanish silently. Config value, not a rewrite — but not optional |
| A Pi is a computer in someone else's house | **Low** | It will want an SD card in two years. Agree now who that falls to |
| Inheriting CC-BY-NC-SA limits future options | **Low, unless commercial** | Clean-room it. §1 |
| The precise location of a home mic is sensitive | **Low** | Never publish coordinates; set the BirdWeather station's location to a rounded suburb-level point, not the house — station pages are public. The radius query doesn't need precision |

---

## 9. Open questions — all answered

1. ~~Melbourne, Australia?~~ ✅ Victoria.
2. ~~Where exactly?~~ ✅ **Inner north-west Melbourne.** Anchor station `30108`.
3. ~~Own microphone?~~ ✅ **Yes, iteration one.** ~A$130 Pi Zero 2 W build.
4. ~~Art style?~~ ✅ **Gould's real lithographs**, not an AI imitation.
5. ~~Could this ever be commercial?~~ ✅ **No — personal.** So CC-BY-NC-SA is
   free to accept, and we fork the tuned frontend rather than rebuild it (§2).
6. ~~E-ink: real intention or maybe?~~ Still open, but the two cheap decisions
   (§7) hold either way.
7. ~~Who owns hosting and the domain?~~ ✅ **You do**, plus maintenance.
   ~A$25/year. Put **Tailscale** on the Pi before it leaves your hands.
8. ~~Nearest station alone or the cluster?~~ ✅ Your own mic, cluster as fallback.
9. ~~Ship it in one go or in stages?~~ ✅ **Two stages** — the URL and the
   neighbourhood view first, the mic second. It de-risks the launch (if the Pi
   will not join the Wi-Fi, the site still works) and the thing visibly
   transforms when the mic comes online.

**Nothing is blocking. Order the Pi parts and start on the shim.**

## Appendix — reproducing the numbers

Every figure in this document came from live queries run 2026-09-20. To re-run:

```bash
curl -sS -X POST https://app.birdweather.com/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ counts(period: {count: 30, unit: \"day\"}, ne: {lat: -37.6, lon: 145.2}, sw: {lat: -38.0, lon: 144.7}) { detections species stations } }"}'
```

Bounding boxes used: greater Melbourne `sw(-38.6, 144.3) → ne(-37.4, 145.7)`;
inner Melbourne `sw(-38.0, 144.7) → ne(-37.6, 145.2)`.

Sources: [BirdWeather API](https://app.birdweather.com/api/index.html) ·
[GraphiQL explorer](https://app.birdweather.com/graphiql) ·
[eBird API 2.0](https://documenter.getpostman.com/view/664302/S1ENwy59) ·
[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
[BirdNET global performance assessment](https://www.sciencedirect.com/science/article/pii/S1470160X25014827) ·
[AvianVisitors](https://github.com/Twarner491/AvianVisitors)
