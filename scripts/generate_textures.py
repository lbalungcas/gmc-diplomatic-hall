import os
import math
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEXTURES_DIR = r"c:\Users\Lawrence-S\Downloads\Game\textures"
os.makedirs(TEXTURES_DIR, exist_ok=True)

# Helper to generate normal map from grayscale height map
def height_to_normal_map(height_img, strength=2.5):
    h_arr = np.array(height_img, dtype=np.float32) / 255.0
    # Sobel filters for dx, dy
    dx = (np.roll(h_arr, -1, axis=1) - np.roll(h_arr, 1, axis=1)) * strength
    dy = (np.roll(h_arr, -1, axis=0) - np.roll(h_arr, 1, axis=0)) * strength
    dz = np.ones_like(dx)
    
    # Normalize vectors
    norm = np.sqrt(dx*dx + dy*dy + dz*dz)
    nx = (dx / norm) * 0.5 + 0.5
    ny = (-dy / norm) * 0.5 + 0.5 # Invert Y for standard tangent-space normal
    nz = (dz / norm) * 0.5 + 0.5
    
    rgb = np.stack([nx, ny, nz], axis=2) * 255.0
    return Image.fromarray(rgb.astype(np.uint8))

def draw_gradient_rect(draw, bbox, color1, color2):
    x0, y0, x1, y1 = bbox
    height = y1 - y0
    for y in range(y0, y1):
        t = (y - y0) / max(1, height)
        r = int(color1[0] * (1 - t) + color2[0] * t)
        g = int(color1[1] * (1 - t) + color2[1] * t)
        b = int(color1[2] * (1 - t) + color2[2] * t)
        draw.line([(x0, y), (x1, y)], fill=(r, g, b))

print("1. Generating PBR Carpet Textures (Diffuse, Normal, Roughness)...")
# Carpet Diffuse (1024x1024)
carpet = Image.new("RGB", (1024, 1024), (22, 30, 48))
carpet_h = Image.new("L", (1024, 1024), 128)
draw_c = ImageDraw.Draw(carpet)
draw_h = ImageDraw.Draw(carpet_h)

step = 64
for y in range(0, 1024, step):
    for x in range(0, 1024, step):
        offset = (step // 2) if (y // step) % 2 == 1 else 0
        cx = (x + offset) % 1024
        cy = y
        draw_c.polygon([
            (cx, cy - step // 2), (cx + step // 2, cy),
            (cx, cy + step // 2), (cx - step // 2, cy)
        ], outline=(40, 52, 78), fill=(26, 36, 56))
        draw_h.polygon([
            (cx, cy - step // 2), (cx + step // 2, cy),
            (cx, cy + step // 2), (cx - step // 2, cy)
        ], outline=160, fill=110)
        # Gold cross accent
        draw_c.line([(cx - 6, cy), (cx + 6, cy)], fill=(212, 175, 55), width=2)
        draw_c.line([(cx, cy - 6), (cx, cy + 6)], fill=(212, 175, 55), width=2)
        draw_h.line([(cx - 6, cy), (cx + 6, cy)], fill=230, width=2)
        draw_h.line([(cx, cy - 6), (cx, cy + 6)], fill=230, width=2)

carpet.save(os.path.join(TEXTURES_DIR, "carpet_hall.png"))
carpet_norm = height_to_normal_map(carpet_h, strength=3.0)
carpet_norm.save(os.path.join(TEXTURES_DIR, "carpet_normal.png"))

# Carpet Roughness (matte fabric ~0.85 with slight variance)
carpet_rough = Image.new("L", (1024, 1024), 215)
carpet_rough.save(os.path.join(TEXTURES_DIR, "carpet_roughness.png"))

print("2. Generating PBR Corridor Marble Tile Textures (Diffuse, Normal, Roughness)...")
tile = Image.new("RGB", (1024, 1024), (242, 240, 235))
tile_h = Image.new("L", (1024, 1024), 240)
draw_t = ImageDraw.Draw(tile)
draw_th = ImageDraw.Draw(tile_h)
tile_size = 256
for y in range(0, 1024, tile_size):
    for x in range(0, 1024, tile_size):
        draw_t.rectangle([x, y, x + tile_size, y + tile_size], outline=(175, 170, 160), width=4)
        draw_th.rectangle([x, y, x + tile_size, y + tile_size], outline=30, width=4) # Deep grout groove
        # Veining
        draw_t.line([(x + 20, y + 40), (x + 110, y + 160), (x + 220, y + 230)], fill=(210, 204, 194), width=3)
        draw_t.line([(x + 140, y + 20), (x + 210, y + 110), (x + 250, y + 200)], fill=(218, 212, 202), width=2)

tile.save(os.path.join(TEXTURES_DIR, "corridor_tile.png"))
tile_norm = height_to_normal_map(tile_h, strength=4.0)
tile_norm.save(os.path.join(TEXTURES_DIR, "tile_normal.png"))
# Polished glossy roughness (~0.18 with grout ~0.8)
tile_rough = Image.new("L", (1024, 1024), 45)
draw_tr = ImageDraw.Draw(tile_rough)
for y in range(0, 1024, tile_size):
    for x in range(0, 1024, tile_size):
        draw_tr.rectangle([x, y, x + tile_size, y + tile_size], outline=210, width=4)
tile_rough.save(os.path.join(TEXTURES_DIR, "tile_roughness.png"))

print("3. Generating Acoustic Wall Panel Textures...")
wall = Image.new("RGB", (1024, 1024), (45, 48, 55)) # Warm executive charcoal/wood slat
wall_h = Image.new("L", (1024, 1024), 128)
draw_w = ImageDraw.Draw(wall)
draw_wh = ImageDraw.Draw(wall_h)

slat_w = 32
for x in range(0, 1024, slat_w):
    # Alternating wood slat and acoustic gap
    draw_w.rectangle([x, 0, x + slat_w - 6, 1024], fill=(70, 52, 38)) # Walnut wood slat
    draw_w.rectangle([x + slat_w - 6, 0, x + slat_w, 1024], fill=(18, 20, 24)) # Dark acoustic felt gap
    draw_wh.rectangle([x, 0, x + slat_w - 6, 1024], fill=200)
    draw_wh.rectangle([x + slat_w - 6, 0, x + slat_w, 1024], fill=40)

wall.save(os.path.join(TEXTURES_DIR, "wall_panel.png"))
wall_norm = height_to_normal_map(wall_h, strength=3.5)
wall_norm.save(os.path.join(TEXTURES_DIR, "wall_normal.png"))
wall_rough = Image.new("L", (1024, 1024), 160)
wall_rough.save(os.path.join(TEXTURES_DIR, "wall_roughness.png"))

print("4. Generating Hardwood Stage Floor Textures...")
wood = Image.new("RGB", (1024, 1024), (32, 22, 16))
wood_h = Image.new("L", (1024, 1024), 128)
draw_wd = ImageDraw.Draw(wood)
draw_wdh = ImageDraw.Draw(wood_h)

plank_h = 64
for y in range(0, 1024, plank_h):
    shade = 28 + (y % 15)
    draw_wd.rectangle([0, y, 1024, y + plank_h], fill=(shade + 8, shade, shade - 8), outline=(14, 10, 8), width=2)
    draw_wdh.rectangle([0, y, 1024, y + plank_h], fill=150, outline=30, width=2)

wood.save(os.path.join(TEXTURES_DIR, "wood_stage.png"))
wood_norm = height_to_normal_map(wood_h, strength=3.0)
wood_norm.save(os.path.join(TEXTURES_DIR, "wood_stage_normal.png"))
wood_rough = Image.new("L", (1024, 1024), 100)
wood_rough.save(os.path.join(TEXTURES_DIR, "wood_stage_roughness.png"))

print("5. Generating Welcome Desk & Reception Signage...")
desk_img = Image.new("RGB", (1024, 512), (15, 23, 42))
draw_dk = ImageDraw.Draw(desk_img)
draw_gradient_rect(draw_dk, (0, 0, 1024, 512), (10, 18, 34), (2, 6, 14))
draw_dk.rectangle([0, 0, 1024, 80], fill=(0, 180, 216))
draw_dk.text((40, 22), "MARRIOTT HOTEL MANILA • DIPLOMATIC HALL", fill=(255, 255, 255), font_size=28)
draw_dk.text((120, 200), "WELCOME & INFORMATION DESK", fill=(255, 255, 255), font_size=48)
draw_dk.text((120, 280), "YOUTH INNOVATIONS MARKETPLACE • GMC 2026", fill=(0, 212, 255), font_size=32)
draw_dk.text((120, 360), "Please register your delegate badge and claim your Expo Passport", fill=(148, 163, 184), font_size=22)
desk_img.save(os.path.join(TEXTURES_DIR, "welcome_desk.png"))

print("6. Regenerating 20 Booth Graphics & Screens with Bevel & Glow...")
CATEGORY_PALETTES = [
    {"primary": (0, 180, 216), "secondary": (3, 4, 94), "accent": (144, 224, 239), "tag": "Innovation"},
    {"primary": (16, 185, 129), "secondary": (6, 78, 59), "accent": (110, 231, 183), "tag": "GreenTech"},
    {"primary": (139, 92, 246), "secondary": (76, 29, 149), "accent": (196, 181, 253), "tag": "EdTech"},
    {"primary": (244, 63, 94), "secondary": (136, 19, 55), "accent": (253, 164, 175), "tag": "Health"},
    {"primary": (245, 158, 11), "secondary": (120, 53, 15), "accent": (252, 211, 77), "tag": "Creative"}
]

gmc_booths_file = r"c:\Users\Lawrence-S\Downloads\Game\src\data\booths.json"
booths_data = []
if os.path.exists(gmc_booths_file):
    try:
        with open(gmc_booths_file, "r", encoding="utf-8") as f:
            booths_data = json.load(f)
    except:
        pass

for i in range(1, 21):
    palette = CATEGORY_PALETTES[(i - 1) % len(CATEGORY_PALETTES)]
    booth_info = next((b for b in booths_data if b.get("id") == i), None)
    name = booth_info.get("name", f"Booth {i:02d}") if booth_info else f"Booth {i:02d}"
    cat = booth_info.get("category", palette["tag"]) if booth_info else palette["tag"]
    
    # Graphic Banner
    img = Image.new("RGB", (1024, 512), palette["secondary"])
    d = ImageDraw.Draw(img)
    draw_gradient_rect(d, (0, 0, 1024, 512), palette["secondary"], (10, 15, 26))
    
    # Grid lines
    for lx in range(0, 1024, 48):
        d.line([(lx, 0), (lx + 200, 512)], fill=(palette["primary"][0]//4, palette["primary"][1]//4, palette["primary"][2]//4), width=2)
        
    d.rectangle([0, 0, 1024, 75], fill=palette["primary"])
    d.text((40, 20), "YOUTH INNOVATIONS MARKETPLACE • MANILA 2026", fill=(255, 255, 255))
    
    cx, cy, r = 180, 280, 110
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=palette["primary"], outline=(255, 255, 255), width=5)
    d.text((cx - 65, cy - 55), f"{i:02d}", fill=(255, 255, 255), font_size=100)
    
    d.text((340, 180), name.upper(), fill=(255, 255, 255), font_size=52)
    d.rounded_rectangle([340, 260, 560, 310], radius=12, fill=(20, 30, 48), outline=palette["accent"], width=2)
    d.text((365, 272), f"• {cat}", fill=palette["accent"], font_size=24)
    d.text((340, 340), "Marriott Hotel Manila • Diplomatic Main Hall", fill=(148, 163, 184), font_size=24)
    d.text((340, 385), "Press [E] to inspect exhibit, demo & challenge quiz", fill=(0, 212, 255), font_size=22)
    d.rectangle([0, 0, 1023, 511], outline=palette["primary"], width=6)
    img.save(os.path.join(TEXTURES_DIR, f"booth_{i:02d}_graphic.png"))
    
    # Screen Display (16:9)
    s_img = Image.new("RGB", (1024, 576), (8, 12, 22))
    sd = ImageDraw.Draw(s_img)
    draw_gradient_rect(sd, (0, 0, 1024, 576), (12, 20, 36), (4, 8, 16))
    
    # Title bar
    sd.rectangle([0, 0, 1024, 56], fill=(16, 26, 46))
    sd.text((28, 14), f"INTERACTIVE EXHIBIT TERMINAL • BOOTH {i:02d}", fill=palette["accent"], font_size=22)
    
    # Left widget: Chart
    sd.rounded_rectangle([36, 80, 520, 530], radius=12, fill=(14, 22, 38), outline=(40, 60, 90), width=2)
    sd.text((60, 105), "PROJECT IMPACT OVERVIEW", fill=(255, 255, 255), font_size=24)
    bars = [110, 210, 170, 280, 350, 290]
    for bi, bh in enumerate(bars):
        bx = 75 + bi * 70
        sd.rectangle([bx, 480 - bh, bx + 45, 480], fill=palette["primary"])
        
    # Right widget
    sd.rounded_rectangle([550, 80, 980, 290], radius=12, fill=(14, 22, 38), outline=(40, 60, 90), width=2)
    sd.text((580, 105), "CORE INNOVATION PILLARS", fill=palette["accent"], font_size=24)
    sd.text((580, 155), "1. Sustainable Community Impact", fill=(226, 232, 240), font_size=20)
    sd.text((580, 195), "2. Youth Technology Inclusion", fill=(226, 232, 240), font_size=20)
    sd.text((580, 235), "3. Scalable Global Deployment", fill=(226, 232, 240), font_size=20)
    
    # Right lower QR
    sd.rounded_rectangle([550, 310, 980, 530], radius=12, fill=palette["secondary"], outline=palette["primary"], width=2)
    sd.text((580, 335), "PARTICIPANT ENGAGEMENT", fill=(255, 255, 255), font_size=24)
    sd.rectangle([760, 380, 890, 500], fill=(255, 255, 255))
    sd.rectangle([775, 395, 810, 430], fill=(0, 0, 0))
    sd.rectangle([840, 395, 875, 430], fill=(0, 0, 0))
    sd.rectangle([775, 450, 810, 485], fill=(0, 0, 0))
    sd.text((580, 410), "Press [E] to launch\nbooth quiz & earn\npassport stamp!", fill=(203, 213, 225), font_size=20)
    
    s_img.save(os.path.join(TEXTURES_DIR, f"booth_{i:02d}_screen.png"))

print("ALL ADVANCED PBR TEXTURES GENERATED SUCCESSFULLY!")
