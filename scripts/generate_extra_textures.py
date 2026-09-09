import os
import math
from PIL import Image, ImageDraw, ImageFilter

TEXTURES_DIR = r"c:\Users\Lawrence-S\Downloads\Game\textures"
os.makedirs(TEXTURES_DIR, exist_ok=True)

def make_ceiling_textures():
    size = 1024
    # Base diffuse
    diffuse = Image.new('RGB', (size, size), (228, 226, 222))
    draw_diff = ImageDraw.Draw(diffuse)
    
    # Emission map
    emission = Image.new('RGB', (size, size), (0, 0, 0))
    draw_em = ImageDraw.Draw(emission)
    
    # Roughness map
    roughness = Image.new('RGB', (size, size), (210, 210, 210)) # high roughness for acoustic tile
    draw_rough = ImageDraw.Draw(roughness)
    
    # Grid lines (2x2 grid of acoustic panels per texture repeat)
    grid_count = 4
    step = size // grid_count
    
    for i in range(grid_count + 1):
        pos = i * step
        # Dark metallic T-bar grid lines
        draw_diff.line([(pos, 0), (pos, size)], fill=(120, 122, 125), width=4)
        draw_diff.line([(0, pos), (size, pos)], fill=(120, 122, 125), width=4)
        draw_rough.line([(pos, 0), (pos, size)], fill=(70, 70, 70), width=4)
        draw_rough.line([(0, pos), (size, pos)], fill=(70, 70, 70), width=4)

    # In center of each tile, add recessed architectural LED downlight
    for row in range(grid_count):
        for col in range(grid_count):
            cx = col * step + step // 2
            cy = row * step + step // 2
            r_outer = step // 7
            r_inner = step // 11
            
            # Outer metallic bezel
            draw_diff.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=(180, 182, 185), outline=(130, 130, 130), width=2)
            draw_rough.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=(50, 50, 50))
            
            # Inner warm light lens
            draw_diff.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=(255, 248, 220))
            draw_rough.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=(30, 30, 30))
            
            # Glowing emission
            draw_em.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=(255, 235, 190))
            draw_em.ellipse([cx - r_inner // 2, cy - r_inner // 2, cx + r_inner // 2, cy + r_inner // 2], fill=(255, 255, 240))

    # Add subtle micro noise to acoustic tile
    diffuse.save(os.path.join(TEXTURES_DIR, "ceiling_tiles.png"))
    emission.save(os.path.join(TEXTURES_DIR, "ceiling_emission.png"))
    roughness.save(os.path.join(TEXTURES_DIR, "ceiling_roughness.png"))
    
    # Normal map
    normal = Image.new('RGB', (size, size), (128, 128, 255))
    draw_norm = ImageDraw.Draw(normal)
    for i in range(grid_count + 1):
        pos = i * step
        draw_norm.line([(pos - 1, 0), (pos - 1, size)], fill=(145, 128, 255), width=1)
        draw_norm.line([(pos + 1, 0), (pos + 1, size)], fill=(110, 128, 255), width=1)
        draw_norm.line([(0, pos - 1), (size, pos - 1)], fill=(128, 145, 255), width=1)
        draw_norm.line([(0, pos + 1), (size, pos + 1)], fill=(128, 110, 255), width=1)
        
    for row in range(grid_count):
        for col in range(grid_count):
            cx = col * step + step // 2
            cy = row * step + step // 2
            r_outer = step // 7
            draw_norm.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=(100, 100, 240), width=3)
            
    normal = normal.filter(ImageFilter.GaussianBlur(1.0))
    normal.save(os.path.join(TEXTURES_DIR, "ceiling_normal.png"))
    print("Ceiling textures created successfully.")

def make_media_hub_texture():
    w, h = 1024, 512
    img = Image.new('RGB', (w, h), (16, 24, 40))
    draw = ImageDraw.Draw(img)
    # Background gradient
    for y in range(h):
        r = int(16 + (28 - 16) * (y / h))
        g = int(24 + (40 - 24) * (y / h))
        b = int(40 + (70 - 40) * (y / h))
        draw.line([(0, y), (w, y)], fill=(r, g, b))
        
    # Header
    draw.rectangle([0, 0, w, 80], fill=(12, 74, 110))
    draw.text((60, 25), "GLOBAL MINISTERIAL CONFERENCE 2026", fill=(255, 255, 255))
    draw.text((60, 110), "MEDIA HUB & PRESS INTERVIEW LOUNGE", fill=(56, 189, 248))
    draw.text((60, 150), "Live Broadcasting • Diplomatic Statements • Press Briefings", fill=(203, 213, 225))
    
    # Grid of sponsor logos / partner badges
    for i in range(6):
        bx = 60 + i * 150
        draw.rectangle([bx, 240, bx + 130, 310], fill=(30, 41, 59), outline=(56, 189, 248), width=2)
        draw.text((bx + 20, 265), f"PARTNER {i+1}", fill=(241, 245, 249))
        
    draw.rectangle([0, h - 50, w, h], fill=(15, 23, 42))
    draw.text((60, h - 35), "MARRIOTT HOTEL MANILA • GRAND BALLROOM CONCOURSE", fill=(148, 163, 184))
    
    img.save(os.path.join(TEXTURES_DIR, "media_hub.png"))
    print("Media hub texture created.")

def make_table_linen_texture():
    size = 512
    img = Image.new('RGB', (size, size), (245, 243, 238))
    draw = ImageDraw.Draw(img)
    # Subtle woven linen crosshatch
    for i in range(0, size, 4):
        draw.line([(i, 0), (i, size)], fill=(238, 235, 228), width=1)
        draw.line([(0, i), (size, i)], fill=(238, 235, 228), width=1)
    img.save(os.path.join(TEXTURES_DIR, "table_linen.png"))
    print("Table linen texture created.")

if __name__ == "__main__":
    make_ceiling_textures()
    make_media_hub_texture()
    make_table_linen_texture()
