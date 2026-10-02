"""
Generates the stage-set artwork served at runtime from `public/stage/`.

Run:  python scripts/generate_stage_art.py

  boat_elephant.png  cut-out standee: wooden sailing boat with the elephant mascot aboard
  lighthouse.png     cut-out standee: red-and-white lighthouse on rocks and waves
  led_idle.png       16:9 idle slide for the LED wall (shown whenever the stream isn't)

The landing page's boat art carries a "Canva" watermark across the sail and its lighthouse
cut-out is almost entirely transparent, so both are drawn here as flat vector shapes in the
same style as the stage design instead. Everything is drawn at 2x and downsampled for clean
edges on the alpha cut.
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'landing', 'assets', 'web')
OUT = os.path.join(ROOT, 'public', 'stage')
os.makedirs(OUT, exist_ok=True)

FONTS = r'C:\Windows\Fonts'

NAVY = (27, 45, 92)
NAVY_DEEP = (18, 30, 66)
SUN = (246, 190, 50)
CREAM = (255, 248, 232)
RED = (214, 64, 52)
RED_DARK = (160, 40, 34)
SEA = (54, 160, 196)
SEA_LIGHT = (140, 214, 230)
PINK = (238, 178, 186)
WOOD = (214, 140, 92)
WOOD_DARK = (150, 88, 52)
HULL_BLUE = (24, 84, 160)


def font(name, size):
    for candidate in (name, 'seguibl.ttf', 'segoeuib.ttf', 'arialbd.ttf'):
        try:
            return ImageFont.truetype(os.path.join(FONTS, candidate), size)
        except OSError:
            continue
    return ImageFont.load_default()


def finish(img, size):
    """Downsample the 2x canvas and trim fully transparent margins."""
    img = img.resize(size, Image.LANCZOS)
    bbox = img.getchannel('A').getbbox()
    return img.crop(bbox) if bbox else img


def waves(d, x0, x1, y, amp, colour, period=120, thick=None, bottom=None):
    """A filled band of rounded waves from y down to `bottom`."""
    import math
    pts = []
    x = x0
    while x <= x1:
        pts.append((x, y + math.sin((x - x0) / period * 2 * math.pi) * amp))
        x += 4
    pts += [(x1, bottom), (x0, bottom)]
    d.polygon(pts, fill=colour)


# ---------------------------------------------------------------------------------------------
def boat_elephant():
    W, H = 1800, 1700
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Sails: a big pink main sail and a cream jib, mast in navy.
    mast_x = 860
    d.polygon([(mast_x + 18, 140), (mast_x + 18, 1060), (1500, 1060)], fill=PINK)
    d.polygon([(mast_x - 18, 260), (mast_x - 18, 1060), (420, 1060)], fill=CREAM)
    # Sail seams
    for i in range(1, 5):
        y = 140 + i * 184
        x_end = mast_x + 18 + (1500 - mast_x - 18) * (y - 140) / 920
        d.line([(mast_x + 18, y), (x_end, y)], fill=(222, 150, 160), width=6)
    d.rectangle([mast_x - 18, 100, mast_x + 18, 1120], fill=NAVY)
    d.polygon([(mast_x + 18, 100), (mast_x + 150, 140), (mast_x + 18, 180)], fill=SUN)  # pennant
    d.line([(mast_x, 1060), (1520, 1060)], fill=NAVY, width=22)  # boom

    # Hull: wooden planks with a blue gunwale, shaped like the stage-design dinghy.
    hull = [(160, 1140), (1640, 1140), (1500, 1470), (330, 1470)]
    d.polygon(hull, fill=WOOD)
    for i, y in enumerate(range(1200, 1470, 70)):
        t = (y - 1140) / 330
        xl = 160 + (330 - 160) * t
        xr = 1640 - (1640 - 1500) * t
        d.line([(xl + 6, y), (xr - 6, y)], fill=WOOD_DARK, width=10)
    d.polygon([(130, 1110), (1670, 1110), (1640, 1160), (160, 1160)], fill=HULL_BLUE)
    d.polygon([(330, 1470), (1500, 1470), (1470, 1510), (360, 1510)], fill=HULL_BLUE)

    # The elephant mascot rides in the boat; the trunk's projector beam is cropped away.
    try:
        el = Image.open(os.path.join(WEB, 'elephant-transparent.png')).convert('RGBA')
        el = el.crop((0, 0, int(el.width * 0.70), el.height))
        bbox = el.getchannel('A').getbbox()
        if bbox:
            el = el.crop(bbox)
        eh = 720
        el = el.resize((int(el.width * eh / el.height), eh), Image.LANCZOS)
        # Sink the legs behind the gunwale so it reads as sitting in the boat.
        legs_cut = int(eh * 0.30)
        el = el.crop((0, 0, el.width, eh - legs_cut))
        img.alpha_composite(el, (300, 1130 - el.height + 30))
        d = ImageDraw.Draw(img)
        d.polygon([(130, 1110), (1670, 1110), (1640, 1160), (160, 1160)], fill=HULL_BLUE)
    except OSError:
        pass

    # Sea at the waterline so the standee has a solid base.
    waves(d, 0, W, 1500, 26, SEA, period=260, bottom=H)
    waves(d, 0, W, 1560, 20, SEA_LIGHT, period=200, bottom=1600)
    waves(d, 0, W, 1600, 18, SEA, period=230, bottom=H)

    finish(img, (W // 2, H // 2)).save(os.path.join(OUT, 'boat_elephant.png'), optimize=True)


# ---------------------------------------------------------------------------------------------
def lighthouse():
    W, H = 1000, 2400
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = W // 2

    # Tower: tapered, white with two red bands and a soft shaded right side.
    top_y, base_y = 560, 1960
    top_hw, base_hw = 150, 250
    d.polygon([(cx - top_hw, top_y), (cx + top_hw, top_y), (cx + base_hw, base_y), (cx - base_hw, base_y)],
              fill=(250, 250, 252))
    d.polygon([(cx + 30, top_y), (cx + top_hw, top_y), (cx + base_hw, base_y), (cx + 50, base_y)],
              fill=(214, 220, 234))

    def band(y0, y1, colour):
        def hw(y):
            return top_hw + (base_hw - top_hw) * (y - top_y) / (base_y - top_y)
        d.polygon([(cx - hw(y0), y0), (cx + hw(y0), y0), (cx + hw(y1), y1), (cx - hw(y1), y1)], fill=colour)

    band(900, 1060, RED)
    band(1400, 1560, RED)

    # Gallery, lantern room and dome.
    d.rounded_rectangle([cx - 220, 500, cx + 220, 580], 18, fill=RED_DARK)
    d.rectangle([cx - 130, 300, cx + 130, 500], fill=RED)
    d.rectangle([cx - 95, 330, cx + 95, 480], fill=(255, 226, 120))
    for x in (cx - 32, cx + 32):
        d.rectangle([x - 6, 330, x + 6, 480], fill=RED_DARK)
    d.pieslice([cx - 160, 150, cx + 160, 450], 180, 360, fill=RED)
    d.rectangle([cx - 10, 100, cx + 10, 170], fill=RED_DARK)
    d.ellipse([cx - 22, 70, cx + 22, 114], fill=RED_DARK)

    # Door and porthole windows.
    d.rounded_rectangle([cx - 60, 1760, cx + 60, 1960], 40, fill=RED)
    for y in (760, 1230, 1660):
        d.ellipse([cx - 32, y - 32, cx + 32, y + 32], fill=NAVY)

    # Light glow so it reads as lit even in a dim corner.
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - 260, 140, cx + 260, 660], fill=(255, 220, 120, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img = Image.alpha_composite(glow, img)
    d = ImageDraw.Draw(img)

    # Rocks and sea at the foot.
    d.polygon([(120, 2000), (260, 1900), (420, 1940), (560, 1880), (760, 1930), (900, 2010), (900, 2100), (100, 2100)],
              fill=(92, 96, 110))
    d.polygon([(260, 1900), (420, 1940), (330, 2000)], fill=(120, 124, 140))
    waves(d, 0, W, 2040, 22, SEA, period=220, bottom=H)
    waves(d, 0, W, 2120, 16, SEA_LIGHT, period=180, bottom=2160)
    waves(d, 0, W, 2160, 14, SEA, period=200, bottom=H)

    finish(img, (W // 2, H // 2)).save(os.path.join(OUT, 'lighthouse.png'), optimize=True)


# ---------------------------------------------------------------------------------------------
def led_idle():
    """The stage design's backdrop as an LED slide: navy grid, logo, date and a band of sea."""
    W, H = 2048, 1152
    img = Image.new('RGB', (W, H), NAVY)
    d = ImageDraw.Draw(img, 'RGBA')

    # Soft vertical light falloff and the LED cabinet grid.
    for y in range(H):
        k = 1.0 - 0.25 * abs(y / H - 0.4)
        d.line([(0, y), (W, y)], fill=tuple(int(c * k) for c in NAVY))
    step = W // 16
    for x in range(0, W + 1, step):
        d.line([(x, 0), (x, H)], fill=(255, 255, 255, 18), width=2)
    for y in range(0, H + 1, step):
        d.line([(0, y), (W, y)], fill=(255, 255, 255, 18), width=2)

    # Confetti dots in the brand colours, for the youth feel.
    import random
    rnd = random.Random(16)
    for _ in range(70):
        x, y = rnd.randrange(W), rnd.randrange(int(H * 0.72))
        r = rnd.choice((5, 7, 9))
        col = rnd.choice([SUN, (236, 47, 123), (31, 169, 225), (76, 184, 72), (244, 123, 32)])
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (150,))

    # The YIM lock-up (logo + "November 16-17 2026") from the landing page.
    try:
        logo = Image.open(os.path.join(WEB, 'logo-main-trans.png')).convert('RGBA')
        bbox = logo.getchannel('A').getbbox()
        if bbox:
            logo = logo.crop(bbox)
        lw = int(W * 0.62)
        logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
        # The wordmark is navy on transparent; set it on a cream card so it reads on the LED.
        pad = 70
        card = Image.new('RGBA', (logo.width + pad * 2, logo.height + pad * 2), (0, 0, 0, 0))
        ImageDraw.Draw(card).rounded_rectangle([0, 0, card.width - 1, card.height - 1], 60,
                                               fill=CREAM + (245,))
        card.alpha_composite(logo, (pad, pad))
        img.paste(card, ((W - card.width) // 2, int(H * 0.38) - card.height // 2), card)
    except OSError:
        d.text((W // 2, H * 0.36), 'YOUTH INNOVATION MARKETPLACE', fill=(255, 255, 255),
               font=font('seguibl.ttf', 96), anchor='mm')

    d = ImageDraw.Draw(img, 'RGBA')
    d.text((W // 2, int(H * 0.73)), 'THE SHOW STARTS SOON  \u00b7  GRAB A SEAT!',
           fill=SUN, font=font('seguibl.ttf', 54), anchor='mm')

    # Sea band along the bottom, like the stage design.
    waves(d, 0, W, int(H * 0.86), 14, SEA, period=180, bottom=H)
    waves(d, 0, W, int(H * 0.91), 10, SEA_LIGHT, period=150, bottom=int(H * 0.93))
    waves(d, 0, W, int(H * 0.93), 10, SEA, period=170, bottom=H)

    img.save(os.path.join(OUT, 'led_idle.png'), optimize=True)


if __name__ == '__main__':
    boat_elephant()
    lighthouse()
    led_idle()
    for name in sorted(os.listdir(OUT)):
        with Image.open(os.path.join(OUT, name)) as im:
            print(f'  {name:<20} {im.size[0]}x{im.size[1]} {im.mode}')
