#!/usr/bin/env python3
"""Generate the illustrations the local species list is missing, in the style we already ship.

Adapted from AvianVisitors' pregen.py, with three changes:

  1. The Gemini image API moved. `gemini-2.5-flash-image` is retired
     (2 October 2026) and image generation now goes through
     /v1beta/interactions rather than :generateContent. Default model is
     gemini-3.1-flash-image ("Nano Banana 2").
  2. The style reference is one of OUR OWN cutouts rather than a sourced
     Edo-period print. The eighteen birds already in web/avian/assets/
     illustrations are kachō-e, so using one guarantees the four new birds
     match the set they are joining — which is the entire point. Upstream had
     to tell you to go and find prints yourself.
  3. The anti-reference is likewise ours. Common Myna's failure mode is
     drifting toward Noisy Miner: same yellow facial skin, same urban
     Melbourne niche, and the Noisy Miner is already in the collection for the
     model to be shown and told NOT to copy.

Needs a paid Gemini key. Free-tier keys do not serve image models.

    export GEMINI_API_KEY=...
    python3 tools/art/generate_missing.py --dry-run     # show the plan, call nothing
    python3 tools/art/generate_missing.py
    python3 tools/art/generate_missing.py --species "Turdus merula" --force

Then cut out the cream ground and rebuild the collage tables:

    python3 tools/art/cutout.py
    python3 tools/art/build_masks.py --illustrations web/avian/assets/illustrations --frontend web
"""
from __future__ import annotations
import argparse, base64, json, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path

ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
# gemini-3.1-flash-image drifts: airbrush gradients, no scalloped feather
# edges. The first four birds were generated on it, rejected, and redone on
# pro — so pro is the default rather than the flag you have to remember.
DEFAULT_MODEL = 'gemini-3-pro-image'
ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'web' / 'avian' / 'assets' / 'illustrations'
HERE = Path(__file__).resolve().parent

# Every gated species the example cluster has heard and we cannot draw, most-heard
# first, as (all-time detections, scientific, common). The source is
# action=lifelist, which is already gated — a species SCORE_GTE rejects is a
# misidentification, not a missing illustration, and must never appear here.
#
# Empty since 2026-09-21: all 51 species heard to that date are drawn, the
# last 19 of them (0.07% of gated detections between them) for the atlas
# rather than the collage, so no species card shows the empty nest. A species
# the station hears for the first time goes here until it is drawn, then
# moves to SHIPPED.
#
# Keeping this by hand is the thing docs/FUTURE.md §1 proposes to automate.
MISSING = []

# The species we ship. Eighteen were imported from two other AvianVisitors
# forks (see docs/ART-SOURCES.md); the rest were made here with this script.
# They are listed so --species can regenerate any of them, which --force is
# still required to actually overwrite.
#
# Do NOT batch-regenerate all of them for consistency's sake. The imported
# eighteen are coherent with each other — same palette, same restraint — and
# the ones made here were each reviewed against a field guide, several over
# many attempts. Redraw a bird because it is wrong, not to make it match.
SHIPPED = [
    ('Alisterus scapularis', 'Australian King-Parrot'),
    ('Gymnorhina tibicen', 'Australian Magpie'),
    ('Hydroprogne caspia', 'Caspian Tern'),
    ('Acridotheres tristis', 'Common Myna'),
    ('Turdus merula', 'Eurasian Blackbird'),
    ('Sturnus vulgaris', 'European Starling'),
    ('Eolophus roseicapilla', 'Galah'),
    ('Cracticus torquatus', 'Gray Butcherbird'),
    ('Ardea alba', 'Great Egret'),
    ('Passer domesticus', 'House Sparrow'),
    ('Dacelo novaeguineae', 'Laughing Kookaburra'),
    ('Corvus mellori', 'Little Raven'),
    ('Vanellus miles', 'Masked Lapwing'),
    ('Manorina melanocephala', 'Noisy Miner'),
    ('Strepera graculina', 'Pied Currawong'),
    ('Trichoglossus moluccanus', 'Rainbow Lorikeet'),
    ('Anthochaera carunculata', 'Red Wattlebird'),
    ('Columba livia', 'Rock Pigeon'),
    ('Streptopelia chinensis', 'Spotted Dove'),
    ('Pardalotus striatus', 'Striated Pardalote'),
    ('Cacatua galerita', 'Sulphur-crested Cockatoo'),
    ('Caligavis chrysops', 'Yellow-faced Honeyeater'),
    # Drawn here from the measured species list, most-heard first. The trailing
    # number is all-time gated detections at 2026-09-21.
    ('Grallina cyanoleuca', 'Magpie-lark'),                          # 4583
    ('Corvus tasmanicus', 'Forest Raven'),                           # 1240
    ('Zosterops lateralis', 'Silvereye'),                            # 555
    ('Corvus coronoides', 'Australian Raven'),                       # 448
    ('Cacatua sanguinea', 'Little Corella'),                         # 428
    ('Fulica atra', 'Eurasian Coot'),                                # 391
    ('Glossopsitta concinna', 'Musk Lorikeet'),                      # 272
    ('Chroicocephalus novaehollandiae', 'Silver Gull'),              # 190
    ('Anthochaera chrysoptera', 'Little Wattlebird'),                # 129
    ('Phaps chalcoptera', 'Common Bronzewing'),                      # 120
    ('Strepera versicolor', 'Gray Currawong'),                       # 74
    ('Carduelis carduelis', 'European Goldfinch'),                   # 57
    ('Phylidonyris novaehollandiae', 'New Holland Honeyeater'),      # 54
    ('Coracina novaehollandiae', 'Black-faced Cuckooshrike'),        # 33
    ('Ptilotula penicillata', 'White-plumed Honeyeater'),            # 23
    ('Poodytes gramineus', 'Little Grassbird'),                      # 18
    ('Calyptorhynchus funereus', 'Yellow-tailed Black-Cockatoo'),    # 18
    ('Pachycephala rufiventris', 'Rufous Whistler'),                 # 10
    ('Cacomantis flabelliformis', 'Fan-tailed Cuckoo'),              # 9
    ('Psephotus haematonotus', 'Red-rumped Parrot'),                 # 8
    ('Threskiornis molucca', 'Australian Ibis'),                     # 8
    ('Rhipidura albiscapa', 'Gray Fantail'),                         # 7
    ('Cacatua tenuirostris', 'Long-billed Corella'),                 # 7
    ('Chenonetta jubata', 'Maned Duck'),                             # 6
    ('Tadorna tadornoides', 'Australian Shelduck'),                  # 5
    ('Rhipidura leucophrys', 'Willie-wagtail'),                      # 4
    ('Pardalotus punctatus', 'Spotted Pardalote'),                   # 4
    ('Acrocephalus australis', 'Australian Reed Warbler'),           # 3
    ('Acanthiza nana', 'Yellow Thornbill'),                          # 1
]

# One of our own birds, used purely for its painting style. A plain species
# with flat colour zones reads the style most clearly.
STYLE_REF = 'streptopelia-chinensis.png'

# Per-species style reference, where the default one cannot show what the
# species needs. The Spotted Dove is a mid-toned brown bird, which teaches
# flat colour zones well and teaches nothing at all about painting a white
# bird: given it, the model produced a Little Corella as a pale uncoloured
# outline drawing with soft gradients, twice, at a measured saturation of
# 0.25 against 0.32-0.41 for the trial's good birds.
#
# A white bird needs to be shown a white bird from the same set — how the
# off-white and pale grey zones are laid down, and where the ink goes when
# the subject has almost no colour of its own.
#
# WARNING: cacatua-galerita.png shows its bird gripping a twig. The default
# reference does not, which is why no perch leaked into the first twenty-odd
# birds — and one appeared through the Little Corella's toes at the same
# angle the moment this override was used. The style correction below tells
# the model to ignore it. If a perch shows up on a corella, that is where it
# came from.
STYLE_REFS = {
    'Cacatua sanguinea': 'cacatua-galerita.png',      # Sulphur-crested Cockatoo
    'Cacatua tenuirostris': 'cacatua-galerita.png',
    'Chroicocephalus novaehollandiae': 'ardea-alba.png',  # Great Egret
    'Threskiornis molucca': 'ardea-alba.png',
    'Tadorna tadornoides': 'ardea-alba.png',
}

# species -> a cutout we already ship that the model is known to drift toward.
#
# Every pair here is one we already ship the confusable half of, which is what
# makes the anti-reference possible: the model is shown the bird it must NOT
# draw. Magpie-lark matters most — it is the largest gap in the list at 4,583
# detections, and "magpie" in the name pulls hard toward the Australian Magpie
# that is already in the set.
ANTI_REFS = {
    'Acridotheres tristis': ('manorina-melanocephala.png', 'Noisy Miner'),
    'Grallina cyanoleuca': ('gymnorhina-tibicen.png', 'Australian Magpie'),
    'Corvus tasmanicus': ('corvus-mellori.png', 'Little Raven'),
    'Corvus coronoides': ('corvus-mellori.png', 'Little Raven'),
    'Anthochaera chrysoptera': ('anthochaera-carunculata.png', 'Red Wattlebird'),
    'Strepera versicolor': ('strepera-graculina.png', 'Pied Currawong'),
    'Cacatua sanguinea': ('cacatua-galerita.png', 'Sulphur-crested Cockatoo'),
    'Cacatua tenuirostris': ('cacatua-galerita.png', 'Sulphur-crested Cockatoo'),
    'Glossopsitta concinna': ('trichoglossus-moluccanus.png', 'Rainbow Lorikeet'),
    'Phylidonyris novaehollandiae': ('anthochaera-carunculata.png', 'Red Wattlebird'),
    'Ptilotula penicillata': ('caligavis-chrysops.png', 'Yellow-faced Honeyeater'),
}

POSES = {1: 'perched', 2: 'in flight with wings spread'}

# Appended to every prompt. Written against the drift actually observed when
# the first four birds were generated on gemini-3.1-flash-image and compared
# with the eighteen made on 2.5: the newer model added soft airbrush gradients
# the prompt forbids, and dropped the scalloped feather edges that give the
# older set its woodblock character. Both faults pull the same way — away from
# print, toward digital painting — so they are corrected together.
STYLE_CORRECTION = """

### Style correction — read this last and treat it as overriding

This illustration must sit beside existing prints in the same collection
without looking like it came from a different process. Two specific faults to
avoid, both of which have occurred:

ABSOLUTELY NO SOFT SHADING. No airbrush, no smooth tonal gradient across the
back or breast, no blended volume, no rendered roundness, no glow. Where one
colour meets another there is a CRISP EDGE, not a fade. A wing is a flat shape
of colour against another flat shape of colour. If you are tempted to make the
body look three-dimensional by darkening one side, do not: this is a printed
flat image, not a painting of a solid object.

FEATHER STRUCTURE, WHERE IT BELONGS, IS DRAWN AS SHAPES RATHER THAN TEXTURE.
Where the real bird plainly shows overlapping feathers — a starling's spangled
back, a dove's wing coverts — draw them as individual scalloped shapes with
visible outlines, laid in rows, not as soft mottling, speckling, noise or
blur.

BUT LESS THAN YOU THINK, AND ONLY WHERE THE REAL BIRD SHOWS IT. Confine it to
the wing coverts and scapulars. The breast, belly, head and nape stay flat
colour. A bird that is a uniform colour in life — a black raven, a black
blackbird — is drawn as a flat silhouette of that colour with clean wing and
tail edges and NO scalloping whatever: outlining every feather on a glossy
black bird produces something that looks like a pangolin and matches no
photograph of it. This has happened and had to be redrawn.

The test is the photograph: if you would not notice the feather edges looking
at the bird, do not draw them. These prints are viewed a few hundred pixels
wide, where detail that is not in the real bird reads as dirt rather than
as fineness.

Linework: confident, slightly varied in weight, clearly visible. Not thin
uniform vector strokes.

THE BIRD IS ONE CONNECTED SHAPE. Every part touches the body: both legs join
the belly, every toe joins its foot, the tail joins the rump. Do NOT leave
claws, toes or any other element floating detached in the empty space near
the bird. A single loose fragment ruins the print — the collage packs birds
by their outline, so a stray claw sitting off on its own reserves blank
canvas beside the bird and reads as dirt on the paper. Draw the feet
complete and attached to the legs, or do not draw them at all.

NOTHING ON THE BIRD IS LEFT PAPER-WHITE. Every part that is white in life —
a white face shield, a white bill, a white crown, a white belly, a white wing
patch — must be painted as a pale warm GREY, blue-grey or ivory that is
clearly DARKER than the cream ground, with a visible ink outline around it.
Never leave it as bare paper and never paint it in the ground's own colour.

This is not a stylistic preference. The ground is removed afterwards by a
matting step that decides what is bird and what is paper by how it looks. A
white shield on cream paper looks like paper, so it is cut away and the bird
arrives with a hole in its face. That has happened to a Eurasian Coot's
frontal shield and bill, a Galah's crown and a Yellow-faced Honeyeater's
belly. Painting those areas a shade or two down from the paper costs nothing
and makes them survive.

ONE BIRD. Exactly one, alone. Not a pair, not one bird with a second half
hidden behind it. An Australian Raven and a Magpie-lark both came back as two
overlapping birds; the collage places a single cut-out shape, so a second
bird is not a bonus, it is a ruined print.

NOTHING ELSE IS DRAWN EXCEPT THAT BIRD.

No border, no frame, no plate edge: the cream ground runs to all four edges
of the image. Do not add a dark band, rule or margin at the top or anywhere
else — one appeared on a Little Corella and had to be cropped out.

No perch. NO branch, twig, stick, rail or line beneath or through the feet,
not even a faint one. The toes curl as if grasping, and grasp nothing: the
bird floats on the paper. THE STYLE REFERENCE MAY ITSELF SHOW A PERCH — one
of the prints in this collection does — and that is one of the things you
must not copy from it, along with its species, posture and markings. A twig
appeared through a Little Corella's toes at the same angle as the one in its
style reference. The cutout step that follows removes the ground and keeps
the subject, so a drawn perch survives as a stick through the bird's feet.

The target is an Edo-period woodblock print: flat inked areas, crisp
boundaries, decorative feather patterning. Not a digital airbrush painting.
"""


def load_env_file(root: Path) -> None:
    """Read KEY=value lines from a .env at the repo root into the environment.

    Saves retyping the key on every run. .env is gitignored, and nothing here
    ever prints or logs the value. An already-set environment variable wins,
    so an explicit `export`/`$env:` still overrides the file.
    """
    path = root / '.env'
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError as err:
        print(f'  note   could not read {path.name}: {err}', file=sys.stderr)


def check_key(root: Path, key: str) -> int:
    """Say where the key came from and whether it is shaped like a key.

    Written after a run failed six times with API_KEY_INVALID and there was no
    way to tell whether the key was wrong, stale, or being mangled on its way
    out of .env. Never prints the key: only its length, its first four and
    last four characters, and anything suspicious in between.
    """
    env_path = root / '.env'
    from_env_var = 'GEMINI_API_KEY' in os.environ and not env_path.exists()
    print(f'  .env present     : {env_path.exists()}  ({env_path})')
    if env_path.exists():
        raw = env_path.read_bytes()
        print(f'  .env bytes       : {len(raw)}')
        if raw.startswith(b'\xef\xbb\xbf'):
            print('  !! .env starts with a UTF-8 BOM. If GEMINI_API_KEY is the '
                  'first line its name will not match. Save the file as UTF-8 '
                  'without BOM, or put a comment line above it.')
        names = [ln.split('=', 1)[0].strip() for ln in
                 raw.decode('utf-8', 'replace').splitlines()
                 if '=' in ln and not ln.strip().startswith('#')]
        print(f'  .env keys        : {names or "(none)"}')

    if not key:
        print('  RESULT           : no key found at all')
        return 1

    print(f'  key source       : {"environment" if from_env_var else "environment or .env"}')
    print(f'  key length       : {len(key)}')
    print(f'  key shape        : {key[:4]}…{key[-4:]}')
    odd = [c for c in key if not (c.isalnum() or c in '-_')]
    if odd:
        print(f'  !! unexpected characters in the key: {[hex(ord(c)) for c in odd]}')
        print('     Quotes, spaces or a carriage return usually mean the value '
              'was pasted with them. The parser strips wrapping quotes and '
              'whitespace, so anything left is inside the value.')
    if not key.startswith('AIza'):
        print('  !! Google API keys normally start with "AIza". This one does '
              'not, so it may be a key for a different service, or truncated.')
    if len(key) != 39:
        print(f'  !! Google API keys are normally 39 characters; this is {len(key)}.')

    # Cheapest possible live check: list models. No image is generated.
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models?key={key}',
        headers={'User-Agent': 'melb-avian-visitors/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode())
        names = [m.get('name', '') for m in body.get('models', [])]
        image = [n for n in names if 'image' in n]
        print(f'  RESULT           : key is VALID — {len(names)} models visible')
        print(f'  image models     : {len(image)}'
              + ('' if image else '  !! none — image generation needs a paid key'))
        for n in image[:6]:
            print(f'                     {n}')
        return 0
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:200].replace('\n', ' ')
        print(f'  RESULT           : key REJECTED — HTTP {err.code}')
        print(f'                     {detail}')
        if err.code == 400:
            print('     API_KEY_INVALID means the string itself is wrong: '
                  'revoked, from a deleted project, or mistyped. Make a new '
                  'one at aistudio.google.com/apikey and replace it in .env.')
        return 1
    except urllib.error.URLError as err:
        print(f'  RESULT           : could not reach Google — {err.reason}')
        return 1


def slugify(sci: str) -> str:
    return re.sub(r'[^a-z]+', '-', sci.lower()).strip('-')


def load_prompt() -> str:
    """Upstream's prompt, minus its reference-handling section.

    That section is dropped and rebuilt per request, because upstream's own
    numbering contradicts itself — the body says the style print is IMAGE 2
    while the reference section calls it IMAGE 3 — and because we attach a
    different set of references anyway. Numbering the images wrong is not a
    cosmetic problem: it is how you get a bird painted in the style of its own
    anatomy photo.
    """
    body = (HERE / 'prompt.template.md').read_text(encoding='utf-8').split('## Prompt', 1)[1]
    head = body.split('### Reference handling')[0].strip()
    tail = body.split('### Anatomy', 1)[1]
    return head, '### Anatomy' + tail


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def reference_section(labels: list[str], com: str) -> str:
    """Describe exactly the images we are about to attach, in order.

    Only ONE attached image may claim authority over colour. When a previous
    pose of the same species is attached it takes that role, and the anatomy
    photograph is demoted to shape and pattern. Letting both claim it produced
    a Galah drawn soft dusty pink perched and vivid orange-red in flight: the
    photograph is a real bird in real light, the print is not, and the model
    followed the photograph.
    """
    has_pose1 = 'pose1' in labels
    lines = ['### Reference handling', '']
    for i, kind in enumerate(labels, start=1):
        if kind == 'anatomy' and has_pose1:
            lines.append(
                f'- IMAGE {i} (POSITIVE, anatomy ONLY) is a photograph of {com}. Take '
                f'from it ONLY the shape and the ARRANGEMENT of markings: proportions, '
                f'where the wing bar sits, which parts are dark and which are pale. '
                f'Do NOT take colour from it. It is a photograph of a living bird in '
                f'daylight and its colours are far more saturated than this '
                f'collection\'s. The colours come from the print in IMAGE '
                f'{labels.index("pose1") + 1}, not from here.')
        elif kind == 'anatomy':
            lines.append(
                f'- IMAGE {i} (POSITIVE, anatomy) is a photograph of {com}. Match its '
                f'proportions, head colour, throat, wing pattern, back colour, tail '
                f'pattern, bill colour and leg colour. Take ONLY anatomy and colour '
                f'from it — not its style, pose, background or lighting. If it shows '
                f'worn or non-breeding plumage, render the brightest adult breeding '
                f'plumage instead.')
        elif kind == 'style':
            lines.append(
                f'- IMAGE {i} (POSITIVE, style) is an existing print from this same '
                f'collection, of a DIFFERENT species. IGNORE its species entirely. '
                f'Borrow ONLY its painting technique: the flat colour zones, the '
                f'sparse confident linework, the cream ground, the palette. Your '
                f'output must look like it belongs beside it on the same wall. Do '
                f'NOT copy its posture, proportions or markings.')
        elif kind == 'pose1':
            lines.append(
                f'- IMAGE {i} (POSITIVE, THE COLOUR AUTHORITY) is the perched print of '
                f'{com} from this very set, drawn moments ago. This is the SAME '
                f'INDIVIDUAL in a different pose, so every colour must match it '
                f'exactly: the same black, the same browns, the same greys, the '
                f'same bill and leg colour, the same amount of feather structure '
                f'and the same weight of line. Someone will see these two prints '
                f'side by side and they must look like one bird, not two. Copy '
                f'its palette and its level of detail; change only the pose.')
        elif kind.startswith('anti:'):
            other = kind.split(':', 1)[1]
            lines.append(
                f'- IMAGE {i} (NEGATIVE, anti-reference) is a {other}. It is a '
                f'DIFFERENT species that this one is frequently confused with, and '
                f'it is already in this collection. Do NOT copy its plumage, body '
                f'colour or head pattern. It is attached so you know what to avoid.')
    lines.append('')
    lines.append(f'Treat the anatomy image for identity ONLY and the style image for '
                 f'technique ONLY. The output should be an Edo-period woodblock print '
                 f'of {com}, painted by whoever painted the style image.')
    return '\n'.join(lines)


def build_prompt(head: str, tail: str, sci: str, com: str, pose: int,
                 notes: dict, labels: list[str]) -> str:
    prompt = '\n\n'.join([head, reference_section(labels, com), tail])
    prompt = (prompt
              .replace('{com_name}', com)
              .replace('{sci_name}', sci)
              .replace('{pose}', POSES[pose]))
    # The head still refers to the style print as IMAGE 2 in upstream's wording.
    style_index = labels.index('style') + 1
    prompt = prompt.replace('IMAGE 2', f'IMAGE {style_index}')
    prompt += STYLE_CORRECTION
    note = notes.get(sci)
    if note:
        prompt += f'\n\n### Species-specific requirements\n\n{note}\n'
    return prompt


def fetch_anatomy(sci: str, com: str, cache: Path) -> Path | None:
    """A photograph of the species, to anchor identity.

    BirdWeather serves one per species and we already rely on it as the
    frontend's art fallback, so it needs no new dependency or key. Cached, so
    a regeneration run does not re-fetch. Drop your own file at
    references/<slug>.jpg to override.
    """
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / f'{slugify(sci)}.jpg'
    if dest.exists():
        return dest
    try:
        body = json.dumps({
            'query': 'query($n:String!){ searchSpecies(query:$n, first:1)'
                     '{ nodes { imageUrl } } }',
            'variables': {'n': sci},
        }).encode()
        req = urllib.request.Request('https://app.birdweather.com/graphql', body,
                                     {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        url = (((data.get('data') or {}).get('searchSpecies') or {})
               .get('nodes') or [{}])[0].get('imageUrl')
        if not url:
            print(f'  note   no anatomy photo for {com}; generating without one')
            return None
        with urllib.request.urlopen(url, timeout=90) as resp:
            dest.write_bytes(resp.read())
        return dest
    except Exception as err:
        print(f'  note   anatomy photo for {com} failed ({err}); continuing without')
        return None


def request_image(api_key: str, model: str, prompt: str, images: list[Path],
                  timeout: int = 180) -> bytes | None:
    """POST to the interactions endpoint.

    The body is a flat `input` array of typed blocks — NOT the older
    `contents`/`parts` shape that :generateContent used, and not `inputs`
    plural, which returns 400 "Unknown parameter 'inputs'". Documented at
    https://ai.google.dev/gemini-api/docs/image-generation:

        {"model": "...", "input": [
            {"type": "text",  "text": "..."},
            {"type": "image", "data": "<base64>", "mime_type": "image/jpeg"}
        ]}
    """
    blocks: list[dict] = [{'type': 'text', 'text': prompt}]
    for path in images:
        blocks.append({
            'type': 'image',
            'data': b64(path),
            'mime_type': 'image/png' if path.suffix.lower() == '.png' else 'image/jpeg',
        })
    body = json.dumps({'model': model, 'input': blocks}).encode()
    req = urllib.request.Request(ENDPOINT, body, {
        'Content-Type': 'application/json',
        'x-goog-api-key': api_key,
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    return first_image(payload)


def first_image(payload) -> bytes | None:
    """Walk the response for the first base64 image, whatever it is nested in.

    The response shape has changed once already; searching for the data rather
    than indexing a fixed path means the next rename does not break this.
    """
    stack = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            for key in ('data', 'b64_json', 'bytesBase64Encoded'):
                val = node.get(key)
                if isinstance(val, str) and len(val) > 2048:
                    try:
                        return base64.b64decode(val)
                    except Exception:
                        pass
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--out', type=Path, default=ART)
    ap.add_argument('--species', action='append', metavar='SCI',
                    help='only this scientific name; repeatable. Accepts a '
                         'species we already ship, which --force then '
                         'regenerates.')
    ap.add_argument('--min-detections', type=int, default=0, metavar='N',
                    help='only species heard at least N times all-time. The '
                         'list is a long tail: 1 draws everything (29 species), '
                         '100 draws the top ten, 1000 draws the top two.')
    ap.add_argument('--pose', type=int, choices=[1, 2],
                    help='only this pose (1 perched, 2 flight) — for cheap '
                         'single-image trials of a prompt or model change')
    ap.add_argument('--force', action='store_true', help='regenerate existing files')
    ap.add_argument('--dry-run', action='store_true', help='print the plan, call nothing')
    ap.add_argument('--check-key', action='store_true',
                    help='report where the API key came from and whether '
                         'Google accepts it, then exit. Generates no images.')
    ap.add_argument('--print-prompt', action='store_true',
                    help='print the full prompt for the first target and exit')
    ap.add_argument('--api-key', default=os.environ.get('GEMINI_API_KEY', ''))
    ap.add_argument('--cache', type=Path, default=HERE / 'references',
                    help='where anatomy photos are cached')
    args = ap.parse_args()

    if not args.api_key:
        load_env_file(ROOT)
        args.api_key = os.environ.get('GEMINI_API_KEY', '')

    if args.check_key:
        return check_key(ROOT, args.api_key)

    notes = {k: v for k, v in
             json.loads((HERE / 'species-notes.json').read_text(encoding='utf-8')).items()
             if not k.startswith('_')}
    head, tail = load_prompt()
    if args.species:
        # Named species may be undrawn or already shipped; both are valid
        # targets, and --force is what decides whether a shipped one is
        # actually overwritten.
        known = {sci: com for _, sci, com in MISSING}
        known.update({sci: com for sci, com in SHIPPED})
        targets, unknown = [], []
        for want in args.species:
            if want in known:
                targets.append((want, known[want]))
            else:
                unknown.append(want)
        if unknown:
            print('not a species this project knows: ' + ', '.join(unknown),
                  file=sys.stderr)
            if MISSING:
                print('  undrawn: ' + ', '.join(sci for _, sci, _ in MISSING[:5]) + ', …',
                      file=sys.stderr)
            else:
                print('  every known species is already drawn; name one from '
                      'SHIPPED to redraw it', file=sys.stderr)
            return 2
    else:
        targets = [(sci, com) for n, sci, com in MISSING
                   if n >= args.min_detections]
    if not targets:
        if not MISSING and not args.species:
            print('nothing to draw: every species in MISSING is drawn. Use '
                  '--species NAME --force to redraw one.', file=sys.stderr)
        else:
            print('nothing to draw: nothing matches --species/--min-detections',
                  file=sys.stderr)
        return 2

    if args.print_prompt:
        sci, com = targets[0]
        # Same label order the real run builds, so the IMAGE numbering in the
        # printed prompt matches what the model is actually sent.
        labels = ['anatomy', 'style'] + (['anti'] if sci in ANTI_REFS else [])
        print(build_prompt(head, tail, sci, com, args.pose or 1, notes, labels))
        return 0

    # References always come from the shipped set, never from --out: when
    # --out is a scratch directory for comparison it is empty, and the style
    # reference is the whole point of the run.
    # Chosen per species below; this is only the fallback for the error check.
    style = ART / STYLE_REF
    if not style.exists():
        print(f'error: style reference missing: {style}', file=sys.stderr)
        return 1

    if not args.dry_run and not args.api_key:
        print('error: no GEMINI_API_KEY.\n'
              '       Set it in the environment, pass --api-key, or put\n'
              '         GEMINI_API_KEY=your-key\n'
              '       in a .env file at the repo root (gitignored).\n'
              '       It must be a paid key: free-tier keys do not serve\n'
              '       image models.', file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    made = skipped = failed = 0

    for sci, com in targets:
        slug = slugify(sci)
        for pose in ((args.pose,) if args.pose else (1, 2)):
            dest = args.out / (f'{slug}.png' if pose == 1 else f'{slug}-{pose}.png')
            if dest.exists() and not args.force:
                print(f'  skip   {dest.name} (exists)')
                skipped += 1
                continue

            refs, labels = [], []
            anatomy = fetch_anatomy(sci, com, args.cache)
            if anatomy:
                refs.append(anatomy); labels.append('anatomy')
            species_style = ART / STYLE_REFS.get(sci, STYLE_REF)
            if not species_style.exists():
                species_style = style
            refs.append(species_style); labels.append('style')
            # The flight pose is drawn from scratch unless it is shown the
            # perched one: same species, two independent requests, and the
            # colours drifted apart — a Forest Raven came back flat black
            # perched and blue-grey in flight, and a Eurasian Coot changed
            # register entirely between the two.
            if pose == 2:
                first = args.out / f'{slug}.png'
                if first.exists():
                    refs.append(first); labels.append('pose1')

            anti = ANTI_REFS.get(sci)
            # Never attach the same print as both style and anti-reference.
            # Little Corella wants the Sulphur-crested Cockatoo for its
            # technique — it is the only painted white bird in the set — and
            # is also most likely to be confused with it. Sending that one
            # image twice, once as "borrow this" and once as "do not draw
            # this", is a contradiction. The style section already says to
            # ignore the reference's species and not copy its markings, and
            # the species note names the yellow crest specifically, so the
            # positive use is the one worth keeping.
            if anti and species_style.name == anti[0]:
                anti = None
            if anti and (ART / anti[0]).exists():
                refs.append(ART / anti[0]); labels.append(f'anti:{anti[1]}')

            prompt = build_prompt(head, tail, sci, com, pose, notes, labels)
            if args.dry_run:
                print(f'\n=== {com} ({sci}) pose {pose} -> {dest.name} ===')
                print(f'  model: {args.model}')
                print(f'  refs : {", ".join(f"{i+1}={l}" for i, l in enumerate(labels))}')
                print(f'  note : {"yes" if sci in notes else "none"}')
                print(f'  prompt: {len(prompt)} chars')
                made += 1
                continue

            for attempt in range(3):
                try:
                    data = request_image(args.api_key, args.model, prompt, refs)
                    if data:
                        dest.write_bytes(data)
                        print(f'  wrote  {dest.name}  ({len(data)//1024} KB)')
                        made += 1
                        break
                    print(f'  retry  {dest.name}: no image in response')
                except urllib.error.HTTPError as err:
                    detail = err.read()[:400].decode('utf-8', 'replace')
                    # A 4xx is our bug — the body is malformed, the model name
                    # is wrong, or the key lacks billing. Retrying it just
                    # prints the same thing three times.
                    if 400 <= err.code < 500 and err.code != 429:
                        print(f'  FAILED {dest.name}: HTTP {err.code} {detail}')
                        failed += 1
                        break
                    print(f'  retry  {dest.name}: HTTP {err.code} {detail}')
                except Exception as err:
                    print(f'  retry  {dest.name}: {err}')
                time.sleep(4 * (attempt + 1))
            else:
                print(f'  FAILED {dest.name}')
                failed += 1

    verb = 'would generate' if args.dry_run else 'generated'
    print(f'\n{verb} {made}, skipped {skipped}, failed {failed}')
    if made and not args.dry_run:
        print('\nnext: python3 tools/art/cutout.py'
              '\n      python3 tools/art/build_masks.py --illustrations web/avian/assets/illustrations --frontend web'
              '\nthen review each bird against a field guide before committing.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
