"""
Generates the printed signage and the shared prop materials for the Diplomatic Hall.

Run:  python scripts/generate_graphics.py

Printed artwork (booth backwalls, stage backdrop, media hub) is a layout problem rather than a
noise problem, so it lives here rather than in `generate_textures.py`.

Two things drive the booth layout:

* The panel is **1.86 m x 1.85 m** - square. The old artwork was authored 2:1 and stretched
  across it, squashing every glyph to half width.
* At runtime `createBoothTVs()` in `src/main.js` mounts a 1.30 x 0.73 m video panel centred at
  y = 1.55 m, which covers u 0.15-0.85 / v 0.46-0.86 of the backwall. Artwork placed there is
  simply never seen, so the design leaves that rectangle as a dark recess and puts everything
  legible in the band below it, at standing eye height.
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (  # noqa: E402
    fbm, stripes, value_noise, norm01,
    height_to_normal, cavity_ao, tint, save_rgb, save_orm,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'textures')
os.makedirs(TEX, exist_ok=True)

FONTS = r'C:\Windows\Fonts'


def font(name, size):
    for candidate in (name, 'segoeuib.ttf', 'arialbd.ttf'):
        try:
            return ImageFont.truetype(os.path.join(FONTS, candidate), size)
        except OSError:
            continue
    return ImageFont.load_default()


BOLD = 'segoeuib.ttf'
SEMI = 'seguisb.ttf'
REG = 'segoeui.ttf'
BLACK = 'seguibl.ttf'


# --------------------------------------------------------------------------------------------
# Zone palettes.
#
# The categories come from BOOTH_POSITIONS in src/main.js, not from booths.json - the JSON is
# still placeholder data with every booth marked "Innovation", and colouring all twenty stands
# identically would erase the floor's zoning. main.js is what the marker labels and the minimap
# already use, so matching it keeps the 3D and the HUD telling the same story.
# --------------------------------------------------------------------------------------------
ZONES = {
    'Innovation': dict(primary=(0, 168, 214), deep=(6, 30, 56), accent=(125, 226, 255), ink=(4, 20, 36)),
    'GreenTech':  dict(primary=(16, 173, 122), deep=(6, 44, 36), accent=(122, 236, 191), ink=(3, 28, 22)),
    'EdTech':     dict(primary=(124, 92, 246), deep=(30, 22, 66), accent=(196, 181, 253), ink=(18, 12, 44)),
    'Health':     dict(primary=(232, 74, 104), deep=(56, 16, 34), accent=(253, 172, 188), ink=(36, 8, 20)),
    'Creative':   dict(primary=(235, 152, 26), deep=(58, 34, 8), accent=(252, 208, 128), ink=(38, 22, 4)),
}

BOOTH_CATEGORY = {}
for _i in range(1, 21):
    BOOTH_CATEGORY[_i] = ('Innovation' if _i <= 5 else 'GreenTech' if _i <= 10 else
                          'EdTech' if _i <= 14 else 'Health' if _i <= 17 else 'Creative')

# The runtime TV footprint on the backwall, in UV space (see module docstring).
TV_U0, TV_U1 = 0.1505, 0.8495
TV_V0, TV_V1 = 0.4617, 0.8573

BOOTH_PX = 1024


def load_booths():
    path = os.path.join(ROOT, 'src', 'data', 'booths.json')
    try:
        with open(path, encoding='utf-8') as fh:
            return {b['id']: b for b in json.load(fh)}
    except (OSError, ValueError):
        return {}


def vgrad(draw, box, top, bottom):
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        draw.line([(x0, y), (x1, y)],
                  fill=tuple(int(top[k] + (bottom[k] - top[k]) * t) for k in range(3)))


def ghost_text(img, xy, text, fnt, alpha, anchor='lm'):
    """Draw faint text.

    `ImageDraw.Draw(rgb_image, 'RGBA').text(fill=(...,alpha))` silently ignores the alpha and
    stamps the glyph opaque, so a watermark has to be composited through its own layer.
    """
    layer = Image.new('RGBA', img.size, (255, 255, 255, 0))
    ImageDraw.Draw(layer).text(xy, text, fill=(255, 255, 255, alpha), font=fnt, anchor=anchor)
    img.paste(Image.alpha_composite(img.convert('RGBA'), layer).convert('RGB'), (0, 0))


def fit_text(draw, text, fontfile, max_w, start, min_size=18):
    """Largest size at or below `start` that fits `max_w`."""
    size = start
    while size > min_size:
        f = font(fontfile, size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return font(fontfile, min_size)


# =============================================================================================
# Booth backwall graphics
# =============================================================================================
def booth_graphic(idx, info, pal):
    S = BOOTH_PX
    img = Image.new('RGB', (S, S), pal['deep'])
    d = ImageDraw.Draw(img, 'RGBA')

    # v = 0 at the bottom of the panel, so image y = (1 - v) * S.
    tv = (int(TV_U0 * S), int((1 - TV_V1) * S), int(TV_U1 * S), int((1 - TV_V0) * S))

    vgrad(d, (0, 0, S, S), tuple(min(255, c + 26) for c in pal['deep']), (6, 9, 16))

    # Faint diagonal weave so the backwall reads as printed fabric rather than flat vector art.
    for i in range(-S, S * 2, 26):
        d.line([(i, 0), (i - S, S)], fill=(255, 255, 255, 8), width=9)

    header_h = int((1 - TV_V1) * S) - 16
    d.rectangle([0, 0, S, header_h], fill=pal['primary'])
    d.text((34, header_h // 2), 'YOUTH INNOVATIONS MARKETPLACE  \u00b7  GMC 2026',
           fill=(255, 255, 255), font=font(SEMI, 25), anchor='lm')
    d.text((S - 34, header_h // 2), BOOTH_CATEGORY[idx].upper(),
           fill=pal['ink'], font=font(BOLD, 25), anchor='rm')

    # --- TV recess. The physical bezel sits ~3 cm proud of this, so a soft inner shadow and a
    # thin accent lip are all that is needed for the screen to look built in.
    d.rounded_rectangle([tv[0] - 18, tv[1] - 18, tv[2] + 18, tv[3] + 18], radius=16,
                        fill=(4, 6, 11), outline=pal['accent'] + (70,), width=3)
    for k in range(16):
        a = int(90 * (1 - k / 16))
        d.rounded_rectangle([tv[0] - 18 - k, tv[1] - 18 - k, tv[2] + 18 + k, tv[3] + 18 + k],
                            radius=16 + k, outline=(0, 0, 0, a), width=1)

    # --- Lower band: everything the visitor actually reads, at standing eye height.
    top = tv[3] + 46
    badge = 148
    d.rounded_rectangle([44, top, 44 + badge, top + badge], radius=26, fill=pal['primary'])
    d.text((44 + badge // 2, top + badge // 2), f'{idx:02d}',
           fill=(255, 255, 255), font=font(BLACK, 92), anchor='mm')

    tx = 44 + badge + 34
    name = (info or {}).get('name') or f'Booth {idx:02d}'
    d.text((tx, top + 12), name.upper(), fill=(255, 255, 255),
           font=fit_text(d, name.upper(), BLACK, S - tx - 44, 62), anchor='la')

    chip = BOOTH_CATEGORY[idx]
    cf = font(SEMI, 27)
    cw = d.textlength(chip, font=cf) + 44
    d.rounded_rectangle([tx, top + 88, tx + cw, top + 134], radius=23,
                        fill=(255, 255, 255, 24), outline=pal['accent'], width=2)
    d.text((tx + 22, top + 111), chip, fill=pal['accent'], font=cf, anchor='lm')

    d.line([(44, top + badge + 40), (S - 44, top + badge + 40)], fill=pal['primary'] + (140,), width=3)

    d.text((44, top + badge + 74), 'PRESS  E  TO INSPECT THE EXHIBIT  \u00b7  TAP THE SCREEN FOR SOUND',
           fill=pal['accent'], font=font(SEMI, 24), anchor='la')
    d.text((44, top + badge + 112), 'Demo  \u00b7  Project brief  \u00b7  Challenge quiz  \u00b7  Passport stamp',
           fill=(176, 190, 210), font=font(REG, 23), anchor='la')

    foot = S - 54
    d.rectangle([0, foot, S, S], fill=pal['accent'])
    d.text((S // 2, foot + 27), 'MARRIOTT HOTEL MANILA  \u00b7  DIPLOMATIC MAIN HALL  \u00b7  17-18 NOV',
           fill=pal['ink'], font=font(BOLD, 22), anchor='mm')

    # Ghosted number in the strip of backwall left visible beside the screen recess, purely for
    # depth. Sized to that margin so it is not simply hidden behind the TV.
    margin = tv[0] - 40
    d.line([(26, tv[1] + 8), (26, tv[3] - 8)], fill=pal['primary'] + (170,), width=5)
    ghost_text(img, (44, tv[1] + (tv[3] - tv[1]) // 2), f'{idx:02d}',
               fit_text(d, f'{idx:02d}', BLACK, margin, 132), 30)

    img.save(os.path.join(TEX, f'booth_{idx:02d}_graphic.png'), optimize=True)


def booth_screen(idx, info, pal):
    """Poster frame for the booth pop-up video.

    Not part of the GLB - the screen meshes are hidden by SCREEN_MAT_RE in `src/main.js` and
    replaced by a video panel. This image is fetched over HTTP as the `poster` for that pop-up
    (`openBoothModal` / `loadPopupVideo`), so it still has to exist and still has to match.
    """
    W, H = 1024, 576
    img = Image.new('RGB', (W, H), (8, 12, 22))
    d = ImageDraw.Draw(img, 'RGBA')
    vgrad(d, (0, 0, W, H), tuple(min(255, c + 16) for c in pal['deep']), (4, 7, 14))

    d.rectangle([0, 0, W, 62], fill=pal['primary'])
    d.text((26, 31), f'BOOTH {idx:02d}  \u00b7  {BOOTH_CATEGORY[idx].upper()}',
           fill=(255, 255, 255), font=font(BOLD, 26), anchor='lm')
    d.text((W - 26, 31), 'INTERACTIVE EXHIBIT', fill=pal['ink'], font=font(SEMI, 22), anchor='rm')

    name = (info or {}).get('name') or f'Booth {idx:02d}'
    d.text((W // 2, 236), name.upper(), fill=(255, 255, 255),
           font=fit_text(d, name.upper(), BLACK, W - 120, 82), anchor='mm')
    d.line([(W // 2 - 190, 296), (W // 2 + 190, 296)], fill=pal['accent'], width=4)

    # Play affordance, since this frame stands in for a video that has not started yet.
    cx, cy, r = W // 2, 392, 52
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 26), outline=pal['accent'], width=3)
    d.polygon([(cx - 15, cy - 25), (cx - 15, cy + 25), (cx + 26, cy)], fill=pal['accent'])

    d.text((W // 2, 492), 'Tap to play with sound', fill=(176, 190, 210), font=font(REG, 25), anchor='mm')
    d.rectangle([0, H - 44, W, H], fill=pal['accent'])
    d.text((W // 2, H - 22), 'YOUTH INNOVATIONS MARKETPLACE  \u00b7  GMC 2026',
           fill=pal['ink'], font=font(BOLD, 21), anchor='mm')

    img.save(os.path.join(TEX, f'booth_{idx:02d}_screen.png'), optimize=True)


# =============================================================================================
# Shared prop materials
# =============================================================================================
def booth_fabric():
    """Tiling weave for the printed backwall fabric - one map shared by all twenty stands."""
    s = 512
    weft = stripes(s, 128, axis=0, duty=0.5, softness=0.3)
    warpt = stripes(s, 128, axis=1, duty=0.5, softness=0.3)
    weave = 0.5 * weft + 0.5 * warpt
    slub = fbm(s, 150, octaves=3, seed=2121)
    height = norm01(0.75 * weave + 0.25 * slub)
    ao = cavity_ao(height, sigma=6.0, strength=0.8)
    # Matte printed textile; the weave troughs catch marginally less light than the crowns.
    rough = np.clip(0.62 + 0.16 * (1 - weave) + 0.06 * slub, 0, 1)
    save_rgb(os.path.join(TEX, 'booth_fabric_normal.png'), height_to_normal(height, 1.5))
    save_orm(os.path.join(TEX, 'booth_fabric_orm.png'), ao, rough, np.zeros((s, s), np.float32))


def brushed_metal():
    """Anisotropic brushed aluminium for the booth frames and trim."""
    s = 512
    # A very wide, very short lattice is what gives the directional scratch pattern.
    brush = value_noise(s, (12, 2400), seed=3131)
    fine = value_noise(s, (40, 4800), seed=3141)
    flaw = fbm(s, 90, octaves=3, seed=3151)
    height = norm01(0.6 * brush + 0.3 * fine + 0.1 * flaw)
    ao = cavity_ao(height, sigma=5.0, strength=0.6)
    rough = np.clip(0.22 + 0.16 * brush + 0.08 * fine, 0, 1)
    metal = np.full((s, s), 0.95, np.float32)
    save_rgb(os.path.join(TEX, 'metal_brushed.png'),
             tint(np.clip(0.70 + 0.22 * brush, 0, 1), (150, 154, 160), (226, 230, 236)))
    save_rgb(os.path.join(TEX, 'metal_brushed_normal.png'), height_to_normal(height, 0.9))
    save_orm(os.path.join(TEX, 'metal_brushed_orm.png'), ao, rough, metal)


# =============================================================================================
# Stage backdrop and media hub
# =============================================================================================
def stage_backdrop():
    """Seamless step-and-repeat press wall.

    This material lands on the hall's entire back wall, not on a 7 m stage panel. A single
    centred headline stretched across that span put metre-high letters behind the stage screen,
    most of them hidden by it. A tiling lock-up is what a real conference backdrop uses: it
    reads at a sensible size regardless of how wide the wall is, and it survives the stage
    screen sitting in the middle of it.

    scripts/build_venue.py projects this at 3 m per repeat, so one tile is a 3 m square.
    """
    S = 1024
    img = Image.new('RGB', (S, S), (10, 18, 38))
    d = ImageDraw.Draw(img, 'RGBA')
    vgrad(d, (0, 0, S, S), (16, 28, 58), (7, 12, 27))

    # Fabric sheen, so it reads as a woven backdrop rather than flat vinyl.
    for i in range(-S, S * 2, 18):
        d.line([(i, 0), (i - S, S)], fill=(255, 255, 255, 6), width=7)

    # Staggered rows of the lock-up. Drawing each one at x, x - S and x + S makes the row wrap,
    # which is what keeps the tile seamless where it repeats across the wall.
    rows = 4
    step = S // rows
    for r in range(rows):
        cy = r * step + step // 2
        offset = (step // 2) if r % 2 else 0
        for c in range(2):
            for dx in (-S, 0, S):
                x = c * (S // 2) + offset + dx
                d.ellipse([x - 34, cy - 34, x + 34, cy + 34], outline=(0, 190, 240, 150), width=3)
                d.text((x, cy), 'YIM', fill=(226, 240, 255), font=font(BLACK, 28), anchor='mm')
                d.text((x, cy + 56), 'YOUTH INNOVATIONS MARKETPLACE',
                       fill=(150, 178, 210), font=font(SEMI, 16), anchor='mm')
                d.text((x, cy + 78), 'GMC 2026  \u00b7  MANILA',
                       fill=(0, 176, 226), font=font(BOLD, 15), anchor='mm')

    img.save(os.path.join(TEX, 'stage_backdrop.png'), optimize=True)


def media_hub():
    W, H = 1024, 512
    img = Image.new('RGB', (W, H), (12, 20, 36))
    d = ImageDraw.Draw(img, 'RGBA')
    vgrad(d, (0, 0, W, H), (18, 32, 58), (5, 9, 18))

    d.rectangle([0, 0, W, 78], fill=(12, 74, 110))
    d.text((40, 39), 'MEDIA HUB  \u00b7  PRESS LOUNGE', fill=(255, 255, 255), font=font(BOLD, 34), anchor='lm')
    d.text((W - 40, 39), 'GMC 2026', fill=(125, 226, 255), font=font(SEMI, 28), anchor='rm')

    d.text((40, 128), 'Live broadcasting  \u00b7  Diplomatic statements  \u00b7  Briefings',
           fill=(178, 196, 218), font=font(REG, 27), anchor='lm')

    for i in range(4):
        bx = 40 + i * 240
        d.rounded_rectangle([bx, 190, bx + 200, 300], radius=14,
                            fill=(26, 38, 60), outline=(56, 160, 210), width=2)
        d.text((bx + 100, 245), f'PARTNER {i + 1}', fill=(226, 236, 248), font=font(SEMI, 24), anchor='mm')

    d.rectangle([0, H - 66, W, H], fill=(0, 168, 214))
    d.text((W // 2, H - 33), 'MARRIOTT HOTEL MANILA  \u00b7  GRAND BALLROOM CONCOURSE',
           fill=(4, 20, 36), font=font(BOLD, 24), anchor='mm')

    img.save(os.path.join(TEX, 'media_hub.png'), optimize=True)


if __name__ == '__main__':
    booths = load_booths()
    print('Booth backwalls (1024x1024 square - the panel is 1.86 x 1.85 m):')
    for i in range(1, 21):
        booth_graphic(i, booths.get(i), ZONES[BOOTH_CATEGORY[i]])
        booth_screen(i, booths.get(i), ZONES[BOOTH_CATEGORY[i]])
    print('  wrote 20 graphics + 20 posters across zones: '
          + ', '.join(dict.fromkeys(BOOTH_CATEGORY.values())))

    print('Shared prop materials:')
    booth_fabric()
    print('  booth_fabric_normal / _orm')
    brushed_metal()
    print('  metal_brushed / _normal / _orm')

    print('Signage:')
    stage_backdrop()
    print('  stage_backdrop (seamless step-and-repeat)')
    media_hub()
    print('  media_hub')

    # HIDE_NODE_RE in src/main.js hides these meshes and rebuilds them procedurally, and
    # nothing else references their images - so they are dropped rather than regenerated.
    print('\nDeliberately not generated (hidden meshes, no runtime reference):')
    print('  welcome_desk, commitment_wall, stage_screen')
