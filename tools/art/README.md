# Art pipeline

**All 51 species** the example Melbourne cluster had heard to 2026-09-21 are
drawn, perched and
in flight — 102 illustrations. `MISSING` in `generate_missing.py` is empty;
a species the station hears for the first time goes there until it is drawn.

**The last 19 were not justified by detection share.** Between them they are
**0.07% of gated detections** — the least-heard is a Yellow Thornbill heard
exactly once. They were drawn for the **atlas**, which gives every species a
card however rarely it is heard and shows an empty nest where art is missing:
before this round, that was 19 empty nests in 51 cards. Weigh the same trade
before drawing a newcomer that has been heard once or twice.

**Budget for review, not just generation.** That round took 56 images for
39 finished ones, roughly US$7–13 on `gemini-3-pro-image`: a honeyeater
drawn as a pair, a four-winged parrot, a Gray Currawong with no white (which
made it a fourth raven), and a Long-billed Corella that needed six attempts
because its species note kept over-steering the bill. The notes that fixed
them are in `species-notes.json`.

We generate these rather than using historical plates, and
[`docs/ART-SOURCES.md`](../../docs/ART-SOURCES.md) explains why that reverses an
earlier recommendation: the birds already shipping are clean-silhouette
kachō-e, and Gould plates complete with branches would sit beside them looking
like a different project. Consistency beats provenance when you are filling
gaps rather than building a set.

## Running it

Needs a **paid** Gemini key — free-tier keys do not serve image models. Run
these from the repository root, on the branch (PR #1), with Python 3 and
Pillow available.

Three ways to supply the key, in the order the script looks:

1. `--api-key ...` on the command line
2. the `GEMINI_API_KEY` environment variable
3. a `.env` file at the repo root — **the easy one**, since it survives new
   terminals and reboots:

   ```bash
   cp .env.example .env     # then paste your key into it
   ```

   `.env` is gitignored, and the script never prints or logs the value. An
   environment variable, if set, still wins over the file.

   To set it globally on Windows instead, so every terminal has it:

   ```powershell
   [Environment]::SetEnvironmentVariable('GEMINI_API_KEY','your-key','User')
   ```

   That writes it to your user registry hive; reopen the terminal for it to
   take effect.

```bash

python3 tools/art/generate_missing.py --dry-run    # plan only, calls nothing
python3 tools/art/generate_missing.py              # everything in MISSING
python3 tools/art/cutout.py                        # strip the cream ground
python3 tools/art/verify_cutouts.py                # catch broken birds
python3 tools/art/build_masks.py \
    --illustrations web/avian/assets/illustrations --frontend web
```

**Run `verify_cutouts.py` every time.** It is free and it catches the fault
that eyeballing a contact sheet misses: a toe or claw drawn floating detached
from the bird. `gemini-3-pro-image` did exactly that to the Red Wattlebird's
feet, two loose fragments at 0.2% and 0.1% of its area — invisible at thumbnail
size, obvious once the collage reserves blank canvas around them. A detached
fragment fails the run; a slightly clipped edge only warns, because several
of the inherited birds have one.

Then **look at every bird before committing**. Upstream measured ~3% anatomical
defects on perched poses and ~5% on flight, and needed 5–6 attempts per flight
pose because the model reads feather masses as extra wings. Regenerate one bird
with `--species "Turdus merula" --force`.

## Models, and the style drift

| model | ~cost / image | notes |
|---|---|---|
| `gemini-3.1-flash-image` | $0.045–0.15 | **not good enough** — see below |
| `gemini-3-pro-image` | $0.13–0.24 | **use this.** "Nano Banana Pro" |
| `gemini-2.5-flash-image` | $0.039 | what the existing 18 were made with — **retires 2 Oct 2026** |

The first four birds generated on 3.1 came out close but not identical to the
eighteen made on 2.5: **soft airbrush gradients the prompt explicitly
forbids**, and **no scalloped feather-edge structure**, which is the most
recognisable thing about the collection's look. Both faults pull the same
way — away from woodblock print, toward digital painting.

`STYLE_CORRECTION` in `generate_missing.py` is appended to every prompt to
counter exactly that, and it is the first thing to edit if drift reappears.
Tune it against what you actually see, not against what the template says.

**Tested on one image** (Little Raven, perched — the clearest case, since a
large dark bird hides nothing). `gemini-3-pro-image` with the correction
block restores the scalloped feather-edge rows and the flat colour zones, and
sits beside the 2.5-generated Pied Currawong and Australian Magpie without
looking like a different process. `gemini-3.1-flash-image` does not, with or
without the block. The roughly 3× price is worth it at this volume — the
whole set is a couple of dollars.

Test a style change on one image before spending on eight:

```bash
python3 tools/art/generate_missing.py \
    --species "Corvus mellori" --pose 1 \
    --model gemini-3-pro-image --out /tmp/trial --force
```

To try a different model without destroying working art, generate into a
scratch directory first — style and anti-references still come from the
shipped set, so this works with an empty `--out`:

```bash
python3 tools/art/generate_missing.py \
    --model gemini-3-pro-image --out /tmp/art-pro --force
```

Compare, then copy the keepers over the originals and re-run `cutout.py` and
`build_masks.py`.

## What this changes from upstream's `pregen.py`

**The API moved.** `gemini-2.5-flash-image` retires 2 October 2026, and image
generation now goes through `/v1beta/interactions` rather than
`:generateContent`. Default model is `gemini-3.1-flash-image`.

**The style reference is one of our own birds.** Upstream tells you to go and
find Edo-period prints yourself, because it can't bundle someone else's art. We
don't need to: the eighteen cutouts we already ship *are* the target style, so
`streptopelia-chinensis.png` goes in as the style reference and the four new
birds are matched against the exact set they're joining.

**The anti-reference is ours too.** Common Myna's failure mode is drifting into
Noisy Miner — same yellow facial skin, same inner-Melbourne niche, and both are
in this collage. So the Noisy Miner we already ship is attached as a negative
reference with instructions not to copy it.

**The image numbering is rebuilt per request.** Upstream's template contradicts
itself — the body calls the style print IMAGE 2, the reference section calls it
IMAGE 3 — and it assumes an anatomy photo we weren't attaching. The reference
section is now generated to describe exactly the images being sent, in order.
Getting this wrong is not cosmetic: it is how you get a bird painted in the
style of its own anatomy photo.

## Files

| | |
|---|---|
| `generate_missing.py` | The generator. `--dry-run` shows the plan without calling anything |
| `species-notes.json` | Diagnostic field marks per species, appended to the prompt. This is where you fix a bird the model keeps getting wrong |
| `prompt.template.md` | Upstream's kachō-e prompt, used as-is |
| `cutout.py` | Upstream's BiRefNet matting step (first run downloads ~1 GB) |
| `build_masks.py` | Upstream's mask builder → `dims.json` + `masks.json` |
| `import_art.py` | Gathers existing cutouts from the Brisbane and US forks |
| `fetch_plates.py` | Downloads PD historical plates from Commons. Works; the cutting is what doesn't |
| `references/` | Cached anatomy photos, one per species. Drop your own `<slug>.jpg` to override |

## The species notes matter

Most of the value here is in `species-notes.json`, not the code. Each entry
names the field marks that carry the identity and the look-alike to avoid — for
example, the Little Raven's pale white iris and the explicit instruction that
*no* white may appear in the plumage, because Australian Magpie and Pied
Currawong are both in this same collage and a white shoulder patch would turn
the raven into one of them.

Add entries as you find drift. They carry forward to every future regeneration.
