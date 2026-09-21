#!/usr/bin/env python3
"""Fetch public-domain historical bird plates from Wikimedia Commons.

Works. Produces good source plates. What it does NOT do is turn them into
collage-ready cutouts — see docs/ART-SOURCES.md "Why the plates stalled".

Wikimedia rules learned the hard way, all of them enforced server-side:

  * Fetching originals from upload.wikimedia.org gets you a 429 telling you to
    use thumbnails instead. On a shared cloud egress IP this happens almost
    immediately.
  * Thumbnail widths must be one of the standard sizes: 20, 40, 60, 120, 250,
    330, 500, 960, 1280, 1920, 3840. Anything else is a 400, whatever the docs
    for `iiurlwidth` imply. 1600px and 1024px are both rejected.
  * Send a real User-Agent with contact details, and back off generously.

Usage:
    python3 tools/art/fetch_plates.py --list          # show what it would get
    python3 tools/art/fetch_plates.py --out plates/
"""
from __future__ import annotations
import argparse, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = 'https://commons.wikimedia.org/w/api.php'
UA = ('melb-avian-visitors/0.1 '
      '(https://github.com/toddhannett-bit/melb-avian-visitors; '
      'personal bird-collage project)')
STANDARD_WIDTHS = (3840, 1920, 1280, 960, 500, 330, 250)

# Species we still need art for, and the Commons search that finds their plate.
# The Elizabeth Gould set reached Commons via rawpixel, whose own file
# description says "A higher resolution with no attribution required can be
# downloaded: rawpixel.com/category/public_domain" — so the CC-BY-SA tag on
# the Commons copy is the uploader's claim over a work rawpixel publishes as
# public domain, and the underlying 1840s lithograph is PD regardless.
TARGETS = {
    'anthochaera-carunculata':
        'incategory:"The Birds of Australia (John Gould)" carunculata',
    'corvus-coronoides':
        'incategory:"The Birds of Australia (John Gould)" "White-eyed Crow"',
    # Not yet located as single plate images on Commons — both are present
    # only inside whole-book PDF scans. See docs/ART-SOURCES.md.
    # 'turdus-merula': ...,
    # 'acridotheres-tristis': ...,
}


def get(url: str, raw: bool = False, tries: int = 5):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            resp = urllib.request.urlopen(req, timeout=120)
            return resp.read() if raw else json.load(resp)
        except Exception as err:
            if attempt == tries - 1:
                print(f'   giving up: {err}', file=sys.stderr)
                return None
            time.sleep(6 * (attempt + 1))


def api(**params):
    return get(API + '?' + urllib.parse.urlencode({**params, 'format': 'json'}))


def find(query: str) -> dict | None:
    res = api(action='query', list='search', srsearch=query, srnamespace=6, srlimit=3)
    if not res or not res['query']['search']:
        return None
    title = res['query']['search'][0]['title']
    time.sleep(3)
    info = api(action='query', titles=title, prop='imageinfo',
               iiprop='url|size|extmetadata',
               iiextmetadatafilter='LicenseShortName|ImageDescription|Artist')
    if not info:
        return None
    page = list(info['query']['pages'].values())[0]
    img = (page.get('imageinfo') or [{}])[0]
    if not img.get('url'):
        return None
    meta = img.get('extmetadata', {})
    strip = lambda k: re.sub('<[^>]+>', '', (meta.get(k) or {}).get('value', '')).strip()
    return {
        'title': title,
        'width': img['width'], 'height': img['height'],
        'licence': strip('LicenseShortName'),
        'artist': strip('Artist'),
        'description': strip('ImageDescription')[:220],
        'descriptionurl': img.get('descriptionurl', ''),
    }


def thumb_url(title: str, width: int) -> str:
    """Commons thumbnails live at a path derived from the md5 of the filename."""
    import hashlib
    name = title[len('File:'):].replace(' ', '_')
    digest = hashlib.md5(name.encode()).hexdigest()
    quoted = urllib.parse.quote(name)
    return (f'https://upload.wikimedia.org/wikipedia/commons/thumb/'
            f'{digest[0]}/{digest[0:2]}/{quoted}/{width}px-{quoted}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=Path('plates'))
    ap.add_argument('--width', type=int, default=1280,
                    help=f'one of {STANDARD_WIDTHS}')
    ap.add_argument('--list', action='store_true', help='look up, do not download')
    args = ap.parse_args()

    if args.width not in STANDARD_WIDTHS:
        print(f'error: {args.width} is not a standard Commons thumbnail width; '
              f'pick one of {STANDARD_WIDTHS}', file=sys.stderr)
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for slug, query in TARGETS.items():
        print(f'\n{slug}')
        found = find(query)
        if not found:
            print('   not found')
            continue
        print(f"   {found['width']}x{found['height']}  {found['licence']}")
        print(f"   {found['description'][:110]}")
        manifest[slug] = found
        if args.list:
            time.sleep(3)
            continue
        time.sleep(3)
        data = get(thumb_url(found['title'], args.width), raw=True)
        if data:
            (args.out / f'{slug}.jpg').write_bytes(data)
            print(f'   saved {len(data) // 1024} KB at {args.width}px')
        time.sleep(3)

    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8')
    print(f'\n{len(manifest)} plate(s) -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
