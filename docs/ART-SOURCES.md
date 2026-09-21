# Has anyone already localised the art for Australia?

**Short answer: partly, by two different people, in two different styles — and
between them they already cover 6 of the measured top 8 species.** Neither set
is a drop-in, and the gaps are exactly the birds that dominate an inner-suburban
Melbourne back yard.

*Researched 2026-09-20. Cross-reference: [`tools/spike/`](../tools/spike/).*

---

## What exists

### 1. `simonwilsondesign-create/AvianVisitors-Upper-Brookfield`

A fork of AvianVisitors localised for **Upper Brookfield, Brisbane**. Carries
**86 illustration files — 43 Australian species**, two poses each, generated
through the upstream Gemini pipeline (it also carries a
`wes-anderson-birds-white-background.md` prompt, so the maintainer has been
restyling).

Covers, among others: Spotted Dove, Noisy Miner, Rainbow Lorikeet, Australian
Magpie, Pied Currawong, Galah, Grey Butcherbird, Rock Pigeon, Masked Lapwing,
Sulphur-crested Cockatoo, Laughing Kookaburra, Tawny Frogmouth, Crested Pigeon,
Superb Fairywren, Crimson Rosella, Yellow-tailed Black-Cockatoo.

**Licence: CC-BY-NC-SA-4.0**, inherited from AvianVisitors/BirdNET-Pi.
**Style: AI-generated**, same pipeline as upstream.
**Bias: subtropical Queensland** — brush turkey, pheasant coucal, figbird,
blue-faced honeyeater, regent bowerbird. A good chunk is irrelevant to Victoria.

### 2. `arnegiacomo/fugleramme` — PR #124, by `hyprcs`

A contributor **in Sydney** added **20 Australian species** to Fugleramme, a
separate e-ink bird-frame project. Nineteen are cut from **John and Elizabeth
Gould's *The Birds of Australia*** (1840–48); the Common Myna comes from
Keulemans' plate in Legge's *A History of the Birds of Ceylon*.

The contributor is explicit: *"No bird pixels were AI-generated or repainted."*
Preparation was conventional cropping, alpha masking, proportional resizing and
flat paper backing.

Covers: Rainbow Lorikeet, Laughing Kookaburra, Magpie-lark, Superb Fairywren,
Yellow-faced Honeyeater, Crimson Rosella, Brown Thornbill, Olive-backed Oriole,
Little Wattlebird, Australian Magpie, Sulphur-crested Cockatoo, Galah, Noisy
Miner, Common Myna, Australian White Ibis, Crested Pigeon, Red Wattlebird,
Tawny Frogmouth, Yellow-tailed Black-Cockatoo, Rose Robin.

**Licence: artwork CC BY-SA 4.0, code MIT** — materially freer than the
AvianVisitors line.
**Status: not merged.** The maintainer asked for revisions on cutting
precision, floating elements and sharp angles.

### 3. Everything else

Of ~25 AvianVisitors forks, the regional-artwork pattern is established —
`InspectaG/AvianVisitors-Central-North-America-Artwork`, `EvijaDaukste/
AvianVisitorsLV` (Latvia) — but Upper Brookfield is the only Australian one.
Fugleramme itself is 800+ cut-outs over 400+ species, all public-domain plates,
but **Scandinavian, British and central European**; the maintainer lists
Australia nowhere.

**Nobody has done Melbourne. Nobody has done the introduced species.**

---

## How much do they actually cover?

Cross-referenced against the real 90-day species list from `docs/SPIKE.md`. *(Note: naive
scientific-name matching gets this wrong — BirdWeather calls Spotted Dove
`Streptopelia chinensis` while Upper Brookfield files it as `Spilopelia
chinensis`. Same bird. Any matcher we build needs a synonym-aware taxonomy map,
not string equality.)*

| # | Species | Cum. % | Upper Brookfield | Gould / Fugleramme |
|---|---|---|---|---|
| 1 | Spotted Dove * | 31.5% | **YES** | – |
| 2 | Little Raven | 51.6% | – | – |
| 3 | Eurasian Blackbird * | 65.7% | – | – |
| 4 | Noisy Miner | 73.8% | **YES** | **YES** |
| 5 | Rainbow Lorikeet | 81.0% | **YES** | **YES** |
| 6 | Common Myna * | 87.1% | – | **YES** |
| 7 | Australian Magpie | 92.1% | **YES** | **YES** |
| 8 | Red Wattlebird | 95.1% | – | **YES** |
| 9 | Magpie-lark | 96.4% | – | **YES** |
| 10 | Pied Currawong | 97.2% | **YES** | – |
| 11 | European Starling * | 97.8% | – | – |
| 12 | Forest Raven | 98.1% | – | – |
| 13 | Galah | 98.4% | **YES** | **YES** |
| 14 | Grey Butcherbird | 98.7% | **YES** | – |
| 15 | Rock Pigeon * | 98.8% | **YES** | – |

\* introduced

- Upper Brookfield covers **17 of 71** local species
- Gould/Fugleramme covers **14 of 71**
- Either covers **23 of 71**
- **Of the top 8 — 95% of all detections — 6 are covered on paper.** In
practice only **4** are: the two that come from Fugleramme's PR (Common Myna,
Red Wattlebird) are in an unmerged branch, not a set we can vendor.

### The gap is the introduced birds, and that is not a coincidence

The two holes in the top 8 are **Eurasian Blackbird** and **Little Raven**.
Widen to the top 16 and you add **European Starling**, **Forest Raven**,
**Eurasian Coot**.

Gould painted Australian *natives* in the 1840s. Blackbirds, starlings and
spotted doves were barely established then — the Acclimatisation Society of
Victoria was still busy releasing them. A corpus drawn from *The Birds of
Australia* structurally cannot contain the birds that now make up two-thirds of
the noise in an inner-Melbourne back yard.

**But Gould also published *The Birds of Great Britain* (1862–73) and *The
Birds of Asia* (1850–83).** Same artists, same lithographic style, same public
domain. Blackbird, Starling, House Sparrow come out of *Great Britain*; Spotted
Dove out of *Asia*. So one visual language covers both the natives and the
blow-ins — which is, pleasingly, historically exact: Gould documented both
worlds, and his books are the reason we know what Victoria sounded like before
the blackbirds arrived.

---

## Recommendation

**Switch from AI generation to historical plates.** The earlier plan had us
generating ~45 species with Gemini in a Gould *pastiche*. The Sydney contributor
has demonstrated the better version: use the actual plates.

| | AI pastiche | Real plates |
|---|---|---|
| Licence | Murky; inherits NC-SA if we use their prompt | **Public domain, clean** |
| Fidelity | Species drift, twigs, mismatched pairs | It's the reference illustration |
| Effort | Generate + review + regenerate | Source, crop, mask |
| Model risk | `gemini-2.5-flash-image` retires 2 Oct 2026 | None |
| Consistency | Drifts across a batch | One artist, one press |

**Plan:**

1. Take the **~23 species already covered**, preferring Fugleramme's plates
   (CC BY-SA, cleaner licence) over Upper Brookfield's AI (NC-SA) where both
   exist. Fix the cutting issues the Fugleramme maintainer flagged.
2. Cut **Eurasian Blackbird, Little Raven, European Starling, Forest Raven,
   Eurasian Coot** from Gould's *Great Britain* / *Asia* volumes ourselves.
   That is **five plates** to reach ~99% coverage of the local list.
3. Fill the remaining tail from the same sources as it appears.

**This removes the Gemini pipeline from the critical path entirely** — no API
key, no model-retirement deadline, no US$9, no drift review. It also removes
the strongest reason to inherit AvianVisitors' NC-SA licence.

**And it's worth contributing back.** `hyprcs` did twenty; we'd be adding the
introduced species nobody has done, from the matching Gould volumes. That PR is
still open and asking for exactly this kind of care.

---

## Why the plates stalled — attempted 2026-09-20

I tried to source and cut the four missing plates. **Sourcing works. Cutting
does not.** The honest state, so nobody repeats it:

### What worked

- **Wikimedia Commons has the plates.** `tools/art/fetch_plates.py` finds and
  downloads them. It encodes three rules learned the hard way, all enforced
  server-side: fetching originals gets a 429 telling you to use thumbnails;
  thumbnail widths must be one of 20/40/60/120/250/330/500/960/1280/1920/3840
  (1600 and 1024 are both rejected with a 400); and you need a real
  User-Agent and generous backoff, because a shared cloud egress IP is
  throttled almost immediately.
- **Red Wattlebird**: Elizabeth Gould's *Anthochaera carunculata* on a
  banksia, 1733×2500. Beautiful, and exactly the register we want.
- **Australian Raven**: Elizabeth Gould's *Corvus coronoides*, 1717×2500,
  in the same set — the stand-in for Little Raven, which wasn't split as a
  species until 1967 and so has no plate of its own.
- **The licence question resolved.** These reached Commons via rawpixel, and
  the uploader tagged them `{{self|cc-by-sa-4.0}}` — but rawpixel's own file
  description says *"A higher resolution with no attribution required can be
  downloaded: rawpixel.com/category/public_domain"*. The BY-SA tag is an
  uploader's claim over a work its own source publishes as public domain, and
  the underlying 1840s lithograph is PD regardless. Usable.
- **Background removal works.** `rembg` with `isnet-general-use` strips the
  cream paper and the printed caption cleanly in about 8 seconds.

### What did not work

**Separating the bird from the plant.** Gould plates put the bird on a
branch, and that is the whole charm of them — but `rembg` treats bird and
banksia as one salient object, so the cutout arrives with a frond attached.

I tried to separate them by colour and connectivity: suppress the olive
foliage, erode to break the thin bridge at the feet, keep the largest blob,
dilate back. It failed badly. A Red Wattlebird's plumage is cream-streaked
and desaturated — the same signature as the foliage — so the filter ate the
bird's own markings and left a shredded carcass. See
`plate-wattlebird-failed.png`. The plant-included version is better than the
"fixed" one.

This is the same wall the Fugleramme maintainer described when rejecting
`hyprcs`'s twenty plates for "cutting precision, floating elements and sharp
angles" — and that contributor was cutting by hand, carefully.

### The real choice this exposes

Not "plates vs AI" but **consistency**. The 18 species we already ship are
clean-silhouette AI cutouts from the Brisbane fork. Four Gould plates
complete with branches would sit beside them looking like a different
project. Mixing is worse than either option pure:

| | Cost | Result |
|---|---|---|
| **Four AI cutouts** in the Brisbane style | ~US$1, an hour of review | 22 consistent birds, ~98% of detections |
| **Hand-cut the four plates** | ~20 min each with a lasso tool | 4 lovely birds that clash with 18 others |
| **Re-do all 22 as plates** | days, mostly manual | The best-looking outcome, and the most work |

Earlier in this document I recommended plates over AI. That recommendation
holds only for a *whole set*. For four birds joining eighteen, it is wrong.

## The remaining gap, measured 2026-09-21

Twenty-two species drawn, fifty-one heard. The shipped art already covers
**98.17% of gated detections**, so this is not really a collage problem any
more — it is an atlas one. The atlas gives every species a card however
rarely it is heard, and an undrawn species shows the empty nest: 29 nests in
51 cards.

| threshold | species | images | reaches |
|---|---|---|---|
| `--min-detections 1000` | 2 | 4 | 99.40% of detections |
| `--min-detections 100` | 10 | 20 | 99.93% |
| `--min-detections 1` | 29 | 58 | 100% |

Magpie-lark alone is 4,583 detections and takes coverage from 98.17% to
99.13%. Everything below it is worth 0.87% between them. Generation skips
files that already exist, so a run at a high threshold now and a lower one
later only draws the difference.

## What the trial run established

Ten images across four rounds, before committing to the rest.

**The global style rule is not enough for a uniformly dark bird.** Same run,
same model, same prompt: Forest Raven, which carries "draw the body as FLAT
BLACK" in its species note, came out flat and clean; Little Raven, which did
not, kept brown scalloped coverts across the whole wing. The anatomy photo
shows the bronze sheen strong light puts on black feathers and the model
follows it unless the species note says otherwise.

**The style reference has to be able to show what the species needs — and
brings its own baggage.** Little Corella failed twice as a pale outline
drawing with soft gradients, because every generation was shown the Spotted
Dove: a mid-toned brown bird that teaches flat colour zones well and nothing
about painting a white one. Shown the Sulphur-crested Cockatoo instead it
came back painted correctly — and with a twig through its toes, because that
print shows its own bird gripping one. A reference is copied more literally
than "borrow only its technique" implies.

**A regeneration can be a downgrade.** The trial's Eurasian Blackbird was
worse than the one already shipping: navy with brown scalloped coverts,
against a current version that is properly flat black. Only visible by
putting them side by side at matched size. Do that before replacing
anything.

One measurement to distrust: mean saturation of the drawn area separated the
washed-out birds from the good ones at 0.25 against 0.32-0.41, and then
ranked the *best* of three Corellas as the least saturated. A white bird is
correctly low-saturation. The number was a proxy for mixed-colour birds and
carries no information on a pale one.

## Running the pipeline

The Python tools need dependencies the rest of the project does not:

```
python -m pip install -r requirements.txt      # Windows
python3 -m pip install -r requirements.txt     # macOS / Linux
```

Then, in order, and not out of order:

```
npm run art:generate -- --min-detections 100
npm run art:cutout
npm run art:verify
npm run art:masks
```

**The order matters and used to fail silently.** `build_masks.py` reads each
illustration's alpha channel to get its silhouette. An illustration that
still has its cream ground has no transparency, so its silhouette is the
whole rectangle — and since the collage packs by silhouette, that reserves a
bird-sized box of blank paper. Run once on ten un-cut birds, it reported
"built 64 masks" and success. It now refuses, names the offending slugs, and
writes nothing.

## Knowing when a new gap appears

Twenty-two species drawn, fifty-one detected, and nothing tells you when a
bird arrives that we cannot draw — the atlas just shows the empty nest. A
weekly job to surface that as a work item is specified in
`docs/FUTURE.md` §1, including the part that is easy to get wrong: only
species that pass the score gate count, or the list fills with
misidentifications the gate is supposed to be throwing away.

## Sources

[AvianVisitors-Upper-Brookfield](https://github.com/simonwilsondesign-create/AvianVisitors-Upper-Brookfield) ·
[fugleramme](https://github.com/arnegiacomo/fugleramme) ·
[fugleramme PR #124](https://github.com/arnegiacomo/fugleramme/pull/124) ·
[AvianVisitors forks](https://github.com/Twarner491/AvianVisitors/forks) ·
[Belkins BirdNET](https://github.com/Belkins/belkins-birdnet) ·
[Hackaday coverage](https://hackaday.com/2026/09/04/the-birds-outside-drawn-for-you-automatically/)
