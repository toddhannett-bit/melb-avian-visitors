# P0 spike — measured findings

**Run:** 2026-09-20 · **Location:** inner north-west Melbourne, VIC
**Source:** BirdWeather GraphQL, anonymous · **Scripts:** [`tools/spike/`](../tools/spike/)

This is the half-day spike [`PLAN.md`](../PLAN.md) called for. It answered more
than expected, and two findings change the plan rather than confirm it.

---

## 1. Station coverage — dense enough to build on, thin enough to worry

| Radius from the centre point | Stations active in last 14 days |
|---|---|
| 1 km | 0 |
| 2 km | **1** |
| 5 km | 6 |
| 8 km | 9 |
| 12 km | 18 |
| 20 km | 27 |

The nearest six, which are the cluster this repository ships with:

| Station | ID | Last detection |
|---|---|---|
| anchor (nearest) | `30108` | 2026-09-20 17:05 |
| second | `16110` | 2026-09-20 17:09 |
| third | `10847` | 2026-09-20 17:08 |
| fourth | `19263` | 2026-09-20 08:41 |
| fifth | `26279` | 2026-09-15 09:54 |
| sixth | `30491` | 2026-09-19 18:00 |

The anchor is close enough to be, for practical purposes, a microphone in the
same neighbourhood — a few streets away.

**Volumes:**

- Anchor station alone, 30 days: **11,167 detections, 25 species**
- 5 km cluster (6 stations), 30 days: **49,951 detections, 62 species**
- 5 km cluster, 90 days: **71 species**

Either scope is a viable product. The single nearest station is the more honest
"this window"; the 5 km cluster is richer and more robust.

**Risk this surfaces:** station `26279` has been silent since 15 September, and
`30491` since the 19th. Hobbyist mics go offline. With only **one** station
inside 2 km, a single-station view is a single point of failure. The app needs
to widen its radius automatically until it has N live stations, and say so in
the UI rather than silently showing an empty sky.

---

## 2. The quality filter — confidence is the wrong knob

`PLAN.md` §4.1 proposed gating on BirdNET confidence. **That is wrong, and the
data says so clearly.**

Threshold sweep over 12,000 sampled detections (30 days, 5 km cluster). Three
species were marked implausible for inner-suburban Melbourne (Glossy
Black-Cockatoo, Osprey, Caspian Tern) and eight marked real-but-rare (Laughing
Kookaburra, Musk Lorikeet, Long-billed Corella, Galah, Silvereye, Common
Bronzewing, White-plumed Honeyeater, Black-faced Cuckooshrike):

| Gate | Species kept | Implausible kept | Real rarities kept | Detections kept |
|---|---|---|---|---|
| none | 49 | 3 | 8 | 100% |
| confidence ≥ 0.75 | 47 | 3 | 8 | 87.9% |
| confidence ≥ 0.85 | 39 | 2 | 5 | 59.9% |
| confidence ≥ 0.90 | 28 | 1 | 2 | 43.2% |
| score ≥ 5.0 | 44 | 1 | 8 | 99.9% |
| **score ≥ 6.0** | **39** | **0** | **8** | **99.5%** |
| score ≥ 7.0 | 33 | 0 | 7 | 90.2% |

Why confidence fails, concretely:

| Species | Confidence | Score | Real here? |
|---|---|---|---|
| Glossy Black-Cockatoo | **0.930** | 3.72 | No |
| Southern Boobook | 0.905 | 4.21 | Plausible |
| Laughing Kookaburra | 0.830 | 8.60 | Yes |
| Spotted Dove (mean of 21,000) | 0.838 | 7.26 | Yes, constantly |

The single Glossy Black-Cockatoo detection is **more confident than the mean of
21,000 Spotted Dove detections** and more confident than a real Kookaburra.
Confidence is BirdNET's within-clip certainty; it knows nothing about whether
the bird belongs here. Tightening it deletes the charismatic rarities — the most
interesting thing in the dataset — while keeping the junk.

BirdWeather's `score` blends confidence with locality priors, and it separates
cleanly. **Recommendation: gate on `score ≥ 6.0`**, which BirdWeather supports
server-side via `scoreGte`, so it costs nothing to apply.

### Known casualties and the fix

`score ≥ 6.0` drops some genuine Melbourne birds: **Tawny Frogmouth** (4.94),
Peregrine Falcon (5.29), European Greenfinch (5.55). And it lets **Superb
Lyrebird** through at exactly 6.00 — a bird of the Dandenongs, not the inner
suburbs, and one an AU-VIC range whitelist would *also* wave through.

So a single threshold isn't enough. Three tiers:

1. **score ≥ 6.0** → enters the collage.
2. **score 4.5–6.0 and on the AU-VIC list** → "possible visitor", shown faintly
   or in a separate strip, never as a confident claim.
3. **below 4.5, or off the AU-VIC list** → discarded.

Plus corroboration for anything rare: require 2+ detections, or 2+ distinct
stations, before a species is promoted. That is what catches the Lyrebird.

The rare-but-real birds are a **feature**, not noise to suppress. "A Kookaburra
was heard on Tuesday morning" is the best thing that happened in this dataset
all month, and the filter's job is to make that claim trustworthy — not to
avoid making it.

---

## 3. What you'd actually see — and it's smaller than we thought

Top species within 5 km, 30 days:

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
| 9 | Magpie-lark | 499 | 97.5% |
| 10 | Pied Currawong | 212 | 97.9% |

\* introduced

**Eight species are 95% of everything you'd hear.** Metro-wide the figure was
23. This is inner, dense suburbia, and its soundscape is overwhelmingly a
handful of loud urban generalists — four of the top six introduced.

### Consequences

**Art scope collapses.** Of 71 species in 90 days, only **8** have usable
illustrations upstream. But after the score gate the working set is **~39–45
species**, not the 169 estimated metro-wide. At two poses each that's ~90 images
of review, roughly **2–3 hours**, not 8–12. Art is no longer a phase to defer —
it can land in week two, and `PLAN.md`'s phasing should be rewritten accordingly.

**Layout cannot be count-proportional.** Spotted Dove is 42.7% of detections. A
collage sized by raw count is a picture of one dove. Size by log-count, by rank,
or by share of *days present* rather than share of detections.

**The editorial angle is sharper than expected.** This isn't a nature scene, it's
an inner-city one: doves, blackbirds, mynas and ravens, with lorikeets and
magpies over the top. Lean into it. The Kookaburra and the Galah are events
precisely because the baseline is so urban.

---

## 4. The dawn chorus is real, and sharply bimodal

Detections by hour, 30 days, 5 km cluster, local time:

```
 4:00      18  ##
 5:00      35  ####
 6:00     398  ##############################################
 7:00     291  #################################
 8:00      85  #########
 9:00      70  ########
10:00      27  ###
11:00      21  ##
12:00      31  ###
13:00      30  ###
14:00      11  #
15:00      81  #########
16:00      60  ######
17:00     145  ################
18:00      65  #######
```

A hard 6am peak, a quiet middle, a 5pm second wind. And the species split by
time of day:

| Species | Peak | Shape (0–23h) |
|---|---|---|
| Spotted Dove | 06:00 | `......##++.....++.......` |
| Noisy Miner | 07:00 | `.....+##++++#+++#+......` |
| Rainbow Lorikeet | 07:00 | `.....+###+......+#+.....` |
| Little Raven | 18:00 | `......+...+...+.#+#.....` |
| Eurasian Blackbird | 18:00 | `...+.#.+..........#.....` |

Blackbirds and ravens own the dusk; doves and lorikeets own the dawn. This is a
genuine, free feature — a collage that changes character across the day, with no
extra data source. `timeOfDayDetectionCounts` returns it in one query.

Note the timestamps come back as `+10:00` / `+11:00`. Keep them in
`Australia/Melbourne`; don't normalise to UTC or the chorus smears.

---

## 5. What changes in the plan

| `PLAN.md` section | Change |
|---|---|
| §4.1 quality filter | **Rewrite.** Confidence gate replaced by `score ≥ 6.0` + AU-VIC whitelist + corroboration, three tiers |
| §4.2 layout | Add: Spotted Dove at 42.7% forces log/rank sizing |
| §5 art scope | **169 species → ~39–45.** Effort 8–12 h → 2–3 h |
| §6 phasing | Art moves from P3-and-defer to week two; P2 filter work gets more weight |
| §9 Q1, Q2 | **Answered.** Melbourne AU; anchor station `30108`, fallback cluster of 6 |
| New risk | Only one station within 2 km; needs auto-widening radius + honest empty state |

---

## Reproducing

```bash
python3 tools/spike/score_sweep.py   # threshold sweep, §2
python3 tools/spike/art_scope.py     # art coverage + species lists, §3
```

Station IDs used: `30108` (anchor), plus `16110`, `10847`, `19263`, `26279`,
`30491` for the 5 km cluster. These are other people's public stations; swap
them for a cluster near you before drawing any conclusions about your own sky.
