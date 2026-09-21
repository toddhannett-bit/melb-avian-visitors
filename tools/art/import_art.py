#!/usr/bin/env python3
"""Assemble the illustration set for the local species list.

We do not generate art (see docs/ART-SOURCES.md — the plan is Gould's public
domain lithographs, not an AI pastiche of them). This script gathers the
cutouts that already exist for our species from the two Australian-relevant
sources, normalises them, and rebuilds the collage tables.

Sources, in priority order:
  1. simonwilsondesign-create/AvianVisitors-Upper-Brookfield  (43 AU species)
  2. Twarner491/AvianVisitors                                 (western US set)

Both are CC-BY-NC-SA-4.0, which this project accepts (personal use).

Cutouts are stored at a 560px long side, matching what dims.json records, so
we ship roughly a tenth of the source bytes for no visible difference.

Usage:
    python3 tools/art/import_art.py --species-file <(…) --ub DIR --us DIR
    python3 tools/art/import_art.py --list-missing
"""
from __future__ import annotations
import argparse, json, re, shutil, sys
from pathlib import Path

DIM_MAX = 560

# BirdWeather and the Brisbane fork disagree on some genera. Same bird.
SYNONYMS = {
    'streptopelia-chinensis': 'spilopelia-chinensis',
}

def slugify(sci: str) -> str:
    return re.sub(r'[^a-z]+', '-', sci.lower()).strip('-')

def variants(slug: str) -> list[str]:
    """Perched and flight filenames for a slug, upstream's `-2` convention."""
    return [f'{slug}.png', f'{slug}-2.png']

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--species', type=Path, required=True,
                    help='JSON list of {sci, com} we want art for')
    ap.add_argument('--ub', type=Path, required=True, help='Upper Brookfield illustrations dir')
    ap.add_argument('--us', type=Path, required=True, help='upstream illustrations dir')
    ap.add_argument('--out', type=Path, default=Path('web/avian/assets/illustrations'))
    ap.add_argument('--max-side', type=int, default=DIM_MAX)
    args = ap.parse_args()

    from PIL import Image

    wanted = json.loads(args.species.read_text(encoding='utf-8'))
    args.out.mkdir(parents=True, exist_ok=True)

    found, missing, credits = 0, [], {}
    for row in wanted:
        slug = slugify(row['sci'])
        key = SYNONYMS.get(slug, slug)
        got_any = False
        for src_dir, label in ((args.ub, 'upper-brookfield'), (args.us, 'avianvisitors')):
            for name in variants(key):
                src = src_dir / name
                if not src.exists():
                    continue
                # Keep the BirdWeather spelling as the filename so the frontend,
                # which asks by scientific name, finds it without a lookup.
                dest = args.out / name.replace(key, slug)
                if dest.exists():
                    continue
                im = Image.open(src).convert('RGBA')
                w, h = im.size
                if max(w, h) > args.max_side:
                    s = args.max_side / max(w, h)
                    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
                im.save(dest, 'PNG', optimize=True)
                credits.setdefault(row['com'], label)
                got_any = True
            if got_any:
                break
        if got_any:
            found += 1
        else:
            missing.append(row)

    print(f'imported art for {found}/{len(wanted)} species -> {args.out}')
    by_src: dict[str, int] = {}
    for label in credits.values():
        by_src[label] = by_src.get(label, 0) + 1
    for label, n in sorted(by_src.items()):
        print(f'  {n:>3} from {label}')
    if missing:
        print(f'\nno art for {len(missing)} species:')
        print('  ' + ', '.join(m['com'] for m in missing))

    (args.out.parent / 'CREDITS.json').write_text(
        json.dumps(credits, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    return 0

if __name__ == '__main__':
    sys.exit(main())
