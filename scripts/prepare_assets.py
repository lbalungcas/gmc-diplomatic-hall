"""
Turns the client's design files into web-ready assets for the 3D venue.

Run:  python scripts/prepare_assets.py

Sources (kept out of git — large print-resolution files):
  venue designs/booth art/         the client's booth art drop, in the client's own folder names:
    Backwall Booth Design/<innovation>.png   the 24 backwall prints (2.0 x 2.44 m), named by innovation
    YIM Booth Signages/<n>.png               booth posters for the easels (numbered by the designer, not by booth)
    Organizers booth/<ORG>/...               backwall, table and standing-banner art
  venue designs/event arc.png      the entrance arch, drawn on a flat light-blue background
  venue designs/stage design.png   stage render: LED wall, two logo banners, set furniture
  venue designs/YIM Venue Signages/<1-5>.png   area standees
  (`YIM Booth Signages/` at the repo root and `venue designs/organizer booths/` are the previous
  drop, superseded by `booth art/` and no longer read.)

Outputs:
  public/booths/backwalls/<booth>.webp    the backwall print at the client's resolution
  public/booths/backwalls/<booth>-sm.webp 400 px wide, what a backwall shows from across the hall
  src/data/backwalls.json                 booth number -> backwall files and the print's accent colour
  public/booths/posters/<booth>.webp      1240 px wide, for close-up reading and the booth pop-up
  public/booths/posters/<booth>-sm.webp   384 px wide, what an easel shows from across the hall
  public/venue/signs/<id>.webp            area standees
  public/venue/arch.webp                  the arch with its background keyed out (alpha)
  public/venue/stage/led.webp             LED wall content, rebuilt where furniture covered it
  public/venue/stage/banner.webp          the logo banner either side of the LED
  public/venue/organizers/<org>-{backwall,table,banner}[-sm].webp   (-sm for tablets and kiosks)
  src/data/organizerArt.json              organizer id -> art files and their aspect ratios
  public/venue/logos.webp                 organizer + supporter logo strip, for printed placeholders
  src/data/posters.json                   booth number -> poster files (read by src/main.js)
"""

import json
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESIGNS = os.path.join(ROOT, 'venue designs')
BOOTH_ART = os.path.join(DESIGNS, 'booth art')
SIGNAGES = os.path.join(BOOTH_ART, 'YIM Booth Signages')
BACKWALLS = os.path.join(BOOTH_ART, 'Backwall Booth Design')
ORGANIZERS = os.path.join(BOOTH_ART, 'Organizers booth')
PUB = os.path.join(ROOT, 'public')

# Designer file number -> official booth number (Team List sheet). Matched by each poster's title
# and its "supported by" logos. Two are matched by country because the poster titles differ from
# the sheet's innovation names (flagged so they can be confirmed): 4 "Time to Play" (TdH NL, Kenya)
# -> 22 Simba, and 19 "GOOD for a Sustainable Future" (India) -> 8 Mica to Microphones.
POSTER_TO_BOOTH = {
    1: 18, 2: 7, 3: 21, 4: 22, 5: 1, 6: 11, 7: 3, 8: 5, 9: 2, 10: 19, 11: 14, 12: 10,
    13: 23, 14: 6, 15: 15, 16: 24, 17: 9, 18: 4, 19: 8, 20: 20, 21: 17, 22: 16, 23: 13, 24: 12,
}
UNCONFIRMED = {4, 19}

# Backwall print (file name without .png) -> official booth number. Each backwall carries the
# same title, theme and logos as that booth's poster, so this is the poster mapping by name; the
# two by-country matches above apply here too ("Time to Play" -> 22, "GOOD ..." -> 8).
BACKWALL_TO_BOOTH = {
    'D-KAWACH': 1,
    'Voice 4 Change': 2,
    'Steps and Respond': 3,
    'Screensafe Stories': 4,
    'Her Life, Her Choice': 5,
    'Eco-scouts': 6,
    'Secure Shield': 7,
    'GOOD for Sustainable Future': 8,
    'Gain Line': 9,
    'Safe Scan': 10,
    'Plan International': 11,
    'Safe Steps': 12,
    'Zero Harm Tracker': 13,
    'PAUSE': 14,
    'Balmanch': 15,
    'Safe Together': 16,
    'Hands Off, Hearts On': 17,
    'Red Ant Movement': 18,
    'MAPPING CHILD LABOUR RISKS IN THE E-WASTE WORLD IN EASTERN SAMAR, PHILIPPINES': 19,
    'Positive Discipline Champions': 20,
    'Empower Chatbot': 21,
    'Time to Play': 22,
    'Child-led Research': 23,
    'Youth-Led Solutions to End Violence Against Children_ From Ideas to Impact': 24,
}
BACKWALL_UNCONFIRMED = {'Time to Play', 'GOOD for Sustainable Future'}

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


def backwalls():
    """The 24 backwall prints. Each is 787 x 960 px for a 2.0 x 2.44 m wall, which is all the
    client supplied, so the large version is kept at that size; the small one is what every
    booth shows until a visitor walks up (src/modules/boothGrid.js swaps them). The accent is the
    colour of the band across the foot of the print: the team's theme colour, which the booth's
    table runner and number sign pick up."""
    out_dir = os.path.join(PUB, 'booths', 'backwalls')
    found = {os.path.splitext(f)[0] for f in os.listdir(BACKWALLS) if f.lower().endswith('.png')}
    unknown = sorted(found - set(BACKWALL_TO_BOOTH))
    if unknown:
        raise SystemExit(f'backwalls: no booth number for {unknown} (add them to BACKWALL_TO_BOOTH)')
    manifest = {}
    for name, booth in BACKWALL_TO_BOOTH.items():
        path = os.path.join(BACKWALLS, name + '.png')
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert('RGB')
        a = np.asarray(im)
        band = a[int(im.height * 0.90):int(im.height * 0.98)].reshape(-1, 3)
        accent = '#%02X%02X%02X' % tuple(int(c) for c in np.median(band, axis=0))
        lg = os.path.join(out_dir, f'{booth}.webp')
        sm = os.path.join(out_dir, f'{booth}-sm.webp')
        save_webp(im, lg, quality=90)
        save_webp(im, sm, width=400, quality=86)
        manifest[str(booth)] = {'lg': rel(lg), 'sm': rel(sm), 'aspect': round(im.width / im.height, 4),
                                'accent': accent, 'source': f'Backwall Booth Design/{name}.png',
                                'confirmed': name not in BACKWALL_UNCONFIRMED}
    with open(os.path.join(ROOT, 'src', 'data', 'backwalls.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(dict(sorted(manifest.items(), key=lambda kv: int(kv[0]))), fh, indent=2)
        fh.write('\n')
    missing = sorted(set(range(1, 25)) - {int(k) for k in manifest})
    accents = sorted({m['accent'] for m in manifest.values()})
    print(f'  backwalls: {len(manifest)} booths, missing {missing}, accents {accents}')


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
    """Organizer stand art, in two sizes: the large one for desktop, `-sm` for tablets and kiosks.
    The manifest records each print's aspect ratio so src/modules/organizers.js can size the
    stand before the images have loaded."""
    files = {
        'vewu': {'backwall': 'VEWU/Backwall.png', 'table': 'VEWU/Booth Table.png', 'banner': 'VEWU/Standing Banner.png'},
        'tdh': {'backwall': 'TdH/backwall.png', 'table': 'TdH/booth table.png', 'banner': 'TdH/standing banner.png'},
        'knh': {'backwall': 'KNH/backwall.png', 'table': 'KNH/table booth.png', 'banner': 'KNH/standee.png'},
    }
    widths = {'backwall': (2048, 1024), 'table': (1024, 512), 'banner': (768, 512)}
    manifest = {}
    for org, parts in files.items():
        manifest[org] = {}
        for part, f in parts.items():
            im = Image.open(os.path.join(ORGANIZERS, f)).convert('RGB')
            lg = os.path.join(PUB, 'venue', 'organizers', f'{org}-{part}.webp')
            sm = os.path.join(PUB, 'venue', 'organizers', f'{org}-{part}-sm.webp')
            size = save_webp(im, lg, width=widths[part][0], quality=88)
            save_webp(im, sm, width=widths[part][1], quality=86)
            manifest[org][part] = {'lg': rel(lg), 'sm': rel(sm), 'aspect': round(im.width / im.height, 4)}
            print(f'  {org} {part}: {size}')
    with open(os.path.join(ROOT, 'src', 'data', 'organizerArt.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(manifest, fh, indent=2)
        fh.write('\n')


def sail_logo():
    """The logotype for the opening animation (/sail/), lifted off the photowall's navy: white
    YOUTH INNOVATIONS, yellow MARKETPLACE, white date. The bulb itself is 3D at runtime. Each
    pixel is solved as foreground-over-navy, so the anti-aliased edges keep clean alpha, and it
    is upscaled first so it holds on the LED wall."""
    import numpy as np
    im = Image.open(os.path.join(DESIGNS, 'Photowall - YIM.png')).convert('RGB')
    box = (2882, 766, 3444, 1078)
    k = 3
    crop = im.crop(box)
    crop = crop.resize((crop.width * k, crop.height * k), Image.LANCZOS)
    a = np.asarray(crop, np.float32)
    navy = np.array(im.getpixel((2600, 760)), np.float32)
    white = np.array((255, 255, 255), np.float32)
    yellow = np.array((242, 198, 103), np.float32)
    h = a.shape[0]
    fg = np.empty_like(a)
    fg[:] = white
    # MARKETPLACE's band, between the two white blocks.
    y0, y1 = int(h * 0.60), int(h * 0.835)
    fg[y0:y1] = yellow
    d = fg - navy
    alpha = np.clip(((a - navy) * d).sum(-1) / (d * d).sum(-1), 0, 1)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)
    out = np.dstack((fg, alpha * 255)).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    path = os.path.join(PUB, 'sail', 'logotype.webp')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=90, method=6, exact=False)
    print('  sail logotype:', img.size, os.path.getsize(path))


def sail_music():
    """The opening's background music: the gong ensemble from the client's video, as a seamless loop.

    The clip is 28 s, and a wait in the harbor can run for minutes. Its rhythm repeats exactly every
    4.286 s, so the loop is 5 of those cycles, starting where the audio best matches itself one loop
    later, with a short equal-power crossfade across the seam. The file carries half a second of the
    loop's own audio either side: MP3 encoders pad the ends, and this keeps that padding outside
    the loop points the player uses (LOOP_START and LOOP_SECONDS in src/sail/audio.js).
    """
    import subprocess
    import numpy as np
    source = r'D:\AI\1107.mp4'
    if not os.path.exists(source):
        print('  sail music: source video not found, keeping the existing file')
        return
    sr = 44100
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', source, '-vn', '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2)
    start, length = int(0.5 * sr), int(round(21.4291 * sr))
    pad, fade = int(0.5 * sr), int(0.25 * sr)
    loop = x[start:start + length].copy()
    t = np.linspace(0, np.pi / 2, fade)[:, None]
    loop[:fade] = x[start:start + fade] * np.sin(t) + x[start + length:start + length + fade] * np.cos(t)
    out = np.vstack((loop[-pad:], loop, loop[:pad]))
    path = os.path.join(PUB, 'sail', 'music.mp3')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '128k', path], input=out.astype(np.float32).tobytes(), check=True)
    print('  sail music:', round(len(out) / sr, 2), 's,', os.path.getsize(path), 'bytes')


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
    backwalls()
    signs()
    logo_strip()
    arch()
    stage()
    organizers()
    photowall()
    sail_logo()
