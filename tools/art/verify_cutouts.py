#!/usr/bin/env python3
"""Geometric sanity check on cut-out illustrations.

Upstream ships verify.py, which sends each bird back through Gemini Vision to
re-identify it. That catches species drift and costs money. This catches a
different and cheaper class of fault, for free, and should run after every
generation:

  * DETACHED FRAGMENTS — a toe or claw drawn floating in space, unconnected to
    the bird. The collage packs by silhouette, so a stray fragment reserves
    empty canvas beside the bird and looks like dirt on the print. This is the
    fault that got a careful human's twenty plates rejected upstream
    ("floating elements"), and gemini-3-pro-image produced it on the Red
    Wattlebird's feet.
  * EDGE CLIPPING — the bird touching the frame, meaning the generator
    cropped it and a foot or tail tip is missing.
  * NEAR-EMPTY ALPHA — the cutout removed almost everything.

Usage:
    python3 tools/art/verify_cutouts.py                  # whole library
    python3 tools/art/verify_cutouts.py corvus-mellori   # named slugs
"""
from __future__ import annotations
import argparse, sys
from pathlib import Path

# A fragment smaller than this share of the bird is ignorable dirt; larger and
# it is a body part that came adrift. The Red Wattlebird's loose toes were
# 0.4% and 0.2% of its area; the worst false positive in the existing library
# is a 16px speck at 0.002%.
FRAGMENT_SHARE = 0.001
ALPHA_ON = 40


# Anti-aliasing and a stray outline pixel will touch the frame on plenty of
# otherwise fine art. Only flag an edge when enough of it is covered to mean
# the generator actually cropped the bird.
EDGE_SHARE = 0.02


def check(path: Path):
    from PIL import Image
    import numpy as np
    from scipy import ndimage

    alpha = np.array(Image.open(path).convert('RGBA').getchannel('A')) > ALPHA_ON
    faults, warnings = [], []
    if alpha.sum() < alpha.size * 0.01:
        faults.append('almost nothing left after cutout')
        return faults, warnings

    labels, count = ndimage.label(alpha)
    if count > 1:
        sizes = ndimage.sum(alpha, labels, range(1, count + 1))
        total = sizes.sum()
        loose = [int(s) for s in sorted(sizes, reverse=True)[1:]
                 if s / total >= FRAGMENT_SHARE]
        if loose:
            pct = ', '.join(f'{s} px ({s / total:.1%})' for s in loose)
            faults.append(f'{len(loose)} detached fragment(s): {pct}')

    edges = {
        'top': alpha[0, :].sum(), 'bottom': alpha[-1, :].sum(),
        'left': alpha[:, 0].sum(), 'right': alpha[:, -1].sum(),
    }
    h, w = alpha.shape
    span = {'top': w, 'bottom': w, 'left': h, 'right': h}
    touching = [f'{k} ({int(v)} px, {v / span[k]:.0%})'
                for k, v in edges.items() if v / span[k] >= EDGE_SHARE]
    if touching:
        warnings.append('clipped at ' + ', '.join(touching))
    return faults, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('slugs', nargs='*', help='check only these (default: all)')
    ap.add_argument('--dir', type=Path,
                    default=Path(__file__).resolve().parents[2]
                    / 'web' / 'avian' / 'assets' / 'illustrations')
    args = ap.parse_args()

    paths = ([args.dir / f'{s}.png' for s in args.slugs] if args.slugs
             else sorted(args.dir.glob('*.png')))
    missing = [p for p in paths if not p.exists()]
    for p in missing:
        print(f'  ?  {p.name}: not found', file=sys.stderr)
    paths = [p for p in paths if p.exists()]

    bad = warned = 0
    for p in paths:
        faults, warnings = check(p)
        if faults:
            bad += 1
            print(f'  FAIL  {p.stem}')
            for f in faults:
                print(f'          {f}')
        elif warnings:
            warned += 1
            print(f'  warn  {p.stem}')
            for w in warnings:
                print(f'          {w}')
    print(f'\n{len(paths) - bad - warned}/{len(paths)} clean, '
          f'{warned} with warnings, {bad} needing regeneration')
    # Only a detached fragment fails the run. A clipped edge is worth seeing
    # but is not worth blocking on, and several inherited birds have one.
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
