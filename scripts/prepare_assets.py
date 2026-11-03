"""
Turns the client's design files into web-ready assets for the 3D venue.

Run:  python scripts/prepare_assets.py

Sources (kept out of git — large print-resolution files):
  YIM Booth Signages/<n>.png       booth posters for the easels (numbered by the designer, not by booth)
  venue designs/event arc.png      the entrance arch, drawn on a flat light-blue background
  venue designs/stage design.png   stage render: LED wall, two logo banners, set furniture
  venue designs/YIM Venue Signages/<1-5>.png   area standees
  venue designs/organizer booths/<ORG>/...     backwall, table and standing-banner art

Outputs:
  public/booths/posters/<booth>.webp      1240 px wide, for close-up reading and the booth pop-up
  public/booths/posters/<booth>-sm.webp   384 px wide, what an easel shows from across the hall
  public/venue/signs/<id>.webp            area standees
  public/venue/arch.webp                  the arch with its background keyed out (alpha)
  public/venue/stage/led.webp             LED wall content, rebuilt where furniture covered it
  public/venue/stage/banner.webp          the logo banner either side of the LED
  public/venue/organizers/<org>-{backwall,table,banner}.webp
  public/venue/logos.webp                 organizer + supporter logo strip, for printed placeholders
  src/data/posters.json                   booth number -> poster files (read by src/main.js)
"""

import json
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGNAGES = os.path.join(ROOT, 'YIM Booth Signages')
DESIGNS = os.path.join(ROOT, 'venue designs')
PUB = os.path.join(ROOT, 'public')

# Designer file number -> official booth number (Team List sheet). Matched by each poster's title
# and its "supported by" logos. Two are matched by country because the poster titles differ from
# the sheet's innovation names (flagged so they can be confirmed): 4 "Time to Play" (TdH NL, Kenya)
# -> 22 Simba, and 19 "GOOD for a Sustainable Future" (India) -> 8 Mica to Microphones.
# Booth 12 (SAFE Steps) has no poster yet.
POSTER_TO_BOOTH = {
    1: 18, 2: 7, 3: 21, 4: 22, 5: 1, 6: 11, 7: 3, 8: 5, 9: 2, 10: 19, 11: 14, 12: 10,
    13: 23, 14: 6, 15: 15, 16: 24, 17: 9, 18: 4, 19: 8, 20: 20, 21: 17, 22: 16, 23: 13,
}
UNCONFIRMED = {4, 19}

SIGNS = {1: 'registration', 2: 'dealCorner', 3: 'mediaHub', 4: 'safeguarding', 5: 'innovationMarketplace'}


def save_webp(im, path, width=None, height=None, quality=88):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if width and im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if height and im.height != height:
        im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    im.save(path, 'WEBP', quality=quality, method=6)
    return im.size


def rel(p):
    return '/' + os.path.relpath(p, PUB).replace(os.sep, '/')


def posters():
    out_dir = os.path.join(PUB, 'booths', 'posters')
    manifest = {}
    for n, booth in sorted(POSTER_TO_BOOTH.items()):
        im = Image.open(os.path.join(SIGNAGES, f'{n}.png')).convert('RGB')
        lg = os.path.join(out_dir, f'{booth}.webp')
        sm = os.path.join(out_dir, f'{booth}-sm.webp')
        save_webp(im, lg, width=1240, quality=90)
        save_webp(im, sm, width=384, quality=85)
        manifest[str(booth)] = {'lg': rel(lg), 'sm': rel(sm), 'aspect': round(im.width / im.height, 4),
                                'source': f'YIM Booth Signages/{n}.png', 'confirmed': n not in UNCONFIRMED}
    with open(os.path.join(ROOT, 'src', 'data', 'posters.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(dict(sorted(manifest.items(), key=lambda kv: int(kv[0]))), fh, indent=2)
        fh.write('\n')
    missing = sorted(set(range(1, 25)) - {int(k) for k in manifest})
    print(f'  posters: {len(manifest)} booths, missing {missing}, unconfirmed booths '
          f'{sorted(POSTER_TO_BOOTH[n] for n in UNCONFIRMED)}')


def signs():
    for n, name in SIGNS.items():
        im = Image.open(os.path.join(DESIGNS, 'YIM Venue Signages', f'{n}.png')).convert('RGB')
        save_webp(im, os.path.join(PUB, 'venue', 'signs', f'{name}.webp'), width=1100)
    print(f'  signs: {", ".join(SIGNS.values())}')


def logo_strip():
    """The organizer + supporter logo block from the foot of a venue standee."""
    im = Image.open(os.path.join(DESIGNS, 'YIM Venue Signages', '1.png')).convert('RGB')
    foot = im.crop((0, int(im.height * 0.835), im.width, im.height))
    a = np.asarray(foot).astype(int)
    ink = np.where((255 * 3 - a.sum(axis=2)) > 60)
    y0, y1 = ink[0].min(), ink[0].max()
    x0, x1 = ink[1].min(), ink[1].max()
    pad = 20
    foot = foot.crop((max(0, x0 - pad), max(0, y0 - pad), min(foot.width, x1 + pad), min(foot.height, y1 + pad)))
    print(f'  logos: {save_webp(foot, os.path.join(PUB, "venue", "logos.webp"), width=1000)}')


def arch():
    """Key out the flat light-blue background by flood fill from the borders, so light blues
    inside the artwork (the sea at the foot of the pillars) are never touched."""
    im = Image.open(os.path.join(DESIGNS, 'event arc.png')).convert('RGB')
    im = im.crop((332, 38, 1668, 1097))          # the arch's front face, without its 3D side return
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    bg = a[h - 3, w // 2]                          # inside the opening, at the bottom
    close = (np.abs(a - bg).sum(axis=2) < 38)
    mask = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and close[ny, nx]:
                mask[ny, nx] = True
                q.append((ny, nx))
    # The pillars (with their inner frame strips) are solid all the way down: their sea artwork
    # shares the background's light blue and would otherwise be keyed out where it meets the edge.
    top = 96 - 38
    mask[top:, :218] = False
    mask[top:, 1150:] = False
    rgba = np.dstack([np.asarray(im), np.where(mask, 0, 255).astype(np.uint8)])
    out = Image.fromarray(rgba, 'RGBA')
    size = save_webp(out, os.path.join(PUB, 'venue', 'arch.webp'), width=1600, quality=90)
    print(f'  arch: {size}, {mask.mean() * 100:.0f}% keyed out')


def stage():
    """LED content and side banner from the stage render.

    In the render the four orange chairs, the armchair and the plant stand in front of the bottom
    of the LED wall, and the lectern covers the foot of the left banner. The LED crop is taken
    above the furniture and its bottom band rebuilt by fading the last clean rows into the LED
    navy; both banners use the right-hand one, which nothing covers.
    """
    im = Image.open(os.path.join(DESIGNS, 'stage design.png')).convert('RGB')
    led_box = (424, 162, 1488, 662)               # full LED wall in the render
    clean_bottom = 575                            # chair tops start just below this
    led = im.crop(led_box)
    a = np.asarray(led).astype(np.float32)
    cut = clean_bottom - led_box[1]
    # Below the chair line the render shows the white splash running straight down to the LED's
    # foot, so the last clean row is extended downward rather than faded (a fade read as a shelf).
    band = a[cut - 2:cut, :, :].mean(axis=0)
    a[cut:] = band
    led = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    print(f'  stage LED: {save_webp(led, os.path.join(PUB, "venue", "stage", "led.webp"), width=2048, quality=90)}')
    banner = im.crop((1492, 164, 1618, 704))
    print(f'  stage banner: {save_webp(banner, os.path.join(PUB, "venue", "stage", "banner.webp"), height=1024, quality=90)}')


def organizers():
    files = {
        'vewu': {'backwall': 'VEWU/Backwall.png', 'table': 'VEWU/Booth Table.png', 'banner': 'VEWU/Standing Banner.png'},
        'tdh': {'backwall': 'TdH/backwall.png', 'table': 'TdH/booth table.png', 'banner': 'TdH/standing banner.png'},
        'knh': {'backwall': 'KNH/backwall.png', 'banner': 'KNH/standing banner.png'},
    }
    for org, parts in files.items():
        for part, f in parts.items():
            im = Image.open(os.path.join(DESIGNS, 'organizer booths', f)).convert('RGB')
            out = os.path.join(PUB, 'venue', 'organizers', f'{org}-{part}.webp')
            size = save_webp(im, out, width={'backwall': 2048, 'table': 1024, 'banner': 768}[part], quality=88)
            print(f'  {org} {part}: {size}')


def photowall():
    """The YIM photowall, printed across the curved wall's lobby face (3:1). A 3072 px print for
    desktop (about 178 px per metre over the 17 m wall) and a 2048 px one for tablets."""
    im = Image.open(os.path.join(DESIGNS, 'Photowall - YIM.png')).convert('RGB')
    for name, w in (('photowall', 3072), ('photowall-sm', 2048)):
        size = save_webp(im, os.path.join(PUB, 'venue', f'{name}.webp'), width=w, quality=88)
        print(f'  {name}: {size}')


if __name__ == '__main__':
    import sys
    only = sys.argv[1:]
    if only:
        for name in only:
            globals()[name]()
        raise SystemExit(0)
    print('Preparing client art:')
    posters()
    signs()
    logo_strip()
    arch()
    stage()
    organizers()
    photowall()
