"""
Generates the PBR surface material set for the Diplomatic Hall.

Run:  python scripts/generate_textures.py

Each material writes three maps into `textures/`:

    <name>.png          base colour
    <name>_normal.png   tangent-space normal
    <name>_orm.png      R = AO, G = roughness, B = metalness

The ORM pack replaces the old separate `*_roughness.png` files. Those were *constant-valued*
(carpet 215, wall 160, stage wood 100 — a single number across the whole image), which is
precisely why every surface in the hall read as the same sheet of plastic: with uniform
roughness there is no micro-variation for the specular lobe to break up on. Every map here is
checked for real variance at the end of the run.

Printed signage (booth graphics, stage backdrop, desk fascia) lives in
`scripts/generate_graphics.py` — different problem, different tools.
"""

import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import (  # noqa: E402
    fbm, ridged, worley, value_noise, warp, blur,
    norm01, remap, smoothstep, stripes, cell_index, jitter_by,
    height_to_normal, cavity_ao, tint,
    save_rgb, save_gray, save_orm, report,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'textures')
os.makedirs(TEX, exist_ok=True)

SIZE = 2048
_checks = []


# Output resolution per material, chosen from how close the player ever gets and how much of
# the screen the surface fills. The floors earn 2048; the ceiling is four metres overhead.
OUT_SIZE = {
    'carpet_hall': 2048,
    'corridor_tile': 2048,
    'wall_panel': 1024,
    'wood_stage': 1024,
    'ceiling_tiles': 1024,
    'table_linen': 512,
}


# Normal and ORM ship at half the base-colour resolution. Their fine noise is nearly
# incompressible — at full size the carpet's normal and ORM alone cost more than every other
# map in the venue combined — while the eye takes its detail cue from the base colour. Halving
# them costs almost nothing visually and roughly quarters their bytes.
MAP_DIVISOR = 2


def emit(name, base, height, ao, rough, metal, normal_strength=2.0, emission=None):
    """Write the three-map set plus an optional emission map, and record a variance check."""
    out = OUT_SIZE.get(name, SIZE)
    aux = max(256, out // MAP_DIVISOR)
    normal = height_to_normal(height, normal_strength)
    save_rgb(os.path.join(TEX, f'{name}.png'), base, out)
    save_rgb(os.path.join(TEX, f'{name}_normal.png'), normal, aux)
    save_orm(os.path.join(TEX, f'{name}_orm.png'), ao, rough, metal, aux)
    if emission is not None:
        save_rgb(os.path.join(TEX, f'{name}_emission.png'), emission, aux)
    report(name, base, normal, ao, rough, metal)
    _checks.append((name, rough))


# =============================================================================================
# 1. Hall carpet — deep navy diplomatic broadloom with a gold diamond lattice
# =============================================================================================
def carpet():
    s = SIZE
    y = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[None, :]

    # --- Diamond lattice. |frac - .5| on both axes sums to a rotated-square distance field, so
    # the motif tiles exactly and the border can be taken as an iso-line of that field.
    n = 8.0
    dfield = np.abs((y * n) % 1.0 - 0.5) + np.abs((x * n) % 1.0 - 0.5)
    border = smoothstep(0.45, 0.50, dfield) * (1.0 - smoothstep(0.50, 0.55, dfield))
    centre = 1.0 - smoothstep(0.0, 0.07, dfield)

    # --- Wool pile: two scales of fibre plus a fine directional comb.
    fibre = fbm(s, 256, octaves=4, seed=11)
    tuft = worley(s, 220, seed=23)
    comb = value_noise(s, (1400, 90), seed=31)
    pile = 0.45 * fibre + 0.35 * (1.0 - tuft) + 0.20 * comb

    # --- Broad tonal drift so an 8x10 repeat across the hall doesn't read as wallpaper.
    drift = blur(fbm(s, 5, octaves=3, seed=47), 24)

    height = 0.62 * pile + 0.30 * border + 0.08 * drift
    height = norm01(blur(height, 0.6))

    navy_dark = (18, 26, 44)
    navy_lite = (40, 54, 84)
    # Antique brass rather than bright gold: at full saturation the lattice read as the
    # dominant colour of the hall instead of an accent woven into a navy ground.
    gold = (142, 116, 62)

    base = tint(np.clip(0.30 + 0.55 * pile + 0.25 * (drift - 0.5), 0, 1), navy_dark, navy_lite)
    goldmask = np.clip(border * 0.72 + centre * 0.85, 0, 1)[..., None]
    base = base * (1 - goldmask) + (np.array(gold, np.float32) / 255.0)[None, None, :] * goldmask
    # Let the fibre break up the gold too, otherwise the lattice looks printed on.
    base *= (0.82 + 0.28 * pile)[..., None]

    ao = cavity_ao(height, sigma=10.0, strength=1.1)
    # Wool is matte and uneven; the silk lattice thread is a touch glossier.
    rough = remap(1.0 - pile, 0.80, 0.97) - 0.16 * goldmask[..., 0]
    metal = 0.10 * goldmask[..., 0]

    emit('carpet_hall', base, height, ao, np.clip(rough, 0, 1), metal, normal_strength=2.4)


# =============================================================================================
# 2. Foyer floor — large-format polished marble
# =============================================================================================
def marble():
    s = SIZE
    tiles = 2  # 2x2 large-format slabs per texture repeat

    ty = cell_index(s, tiles, axis=0)
    tx = cell_index(s, tiles, axis=1)
    tile_id = ty * tiles + tx

    y = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[None, :]

    # --- Veining. Real marble veins follow bedding planes, so start from a directional sine
    # band rather than isotropic noise, then push the phase around with turbulence. Integer
    # frequencies keep the whole thing tileable. Thresholding |sin| near its zero crossing is
    # what yields thin filaments instead of the fat clouds isotropic ridged noise gives.
    def strata(fx, fy, freq, amp, seed, thin):
        turb = fbm(s, freq, octaves=6, seed=seed)
        band = np.sin(2.0 * np.pi * (x * fx + y * fy) + (turb - 0.5) * amp)
        return np.clip((1.0 - np.abs(band) - thin) / max(1e-6, 1.0 - thin), 0, 1)

    veins = strata(3, 2, 5, 14.0, 303, thin=0.88)
    veins = np.maximum(veins, strata(2, -3, 4, 12.0, 313, thin=0.90) * 0.8)
    branch = strata(7, 5, 9, 9.0, 323, thin=0.94) * 0.55
    hairline = strata(11, -8, 14, 7.0, 333, thin=0.965) * 0.35

    grain = fbm(s, 360, octaves=3, seed=505)
    mottle = blur(fbm(s, 14, octaves=4, seed=515), 3)

    # Per-slab tonal shift, so adjacent slabs read as cut from different blocks.
    slab = jitter_by(tile_id, seed=606, lo=-0.045, hi=0.045)

    stone = np.clip(0.84 + 0.07 * grain + 0.10 * (mottle - 0.5) + slab, 0, 1)
    base = tint(stone, (198, 194, 186), (250, 249, 245))

    def overlay(dst, mask, rgb, strength):
        c = np.array(rgb, np.float32) / 255.0
        m = (mask * strength)[..., None]
        return dst * (1 - m) + c[None, None, :] * m

    base = overlay(base, veins, (118, 114, 110), 0.80)
    base = overlay(base, branch, (150, 144, 136), 0.70)
    base = overlay(base, hairline, (178, 160, 134), 0.60)

    # --- Grout: recessed channel at the slab boundaries, plus a chamfer either side.
    gap = 0.0055
    gy = (np.linspace(0, tiles, s, endpoint=False, dtype=np.float32) % 1.0)[:, None]
    gx = (np.linspace(0, tiles, s, endpoint=False, dtype=np.float32) % 1.0)[None, :]
    edge = np.maximum(
        1.0 - smoothstep(0, gap, np.minimum(gy, 1 - gy)),
        1.0 - smoothstep(0, gap, np.minimum(gx, 1 - gx)),
    )
    bevel = np.clip(np.maximum(
        1.0 - smoothstep(0, gap * 4.0, np.minimum(gy, 1 - gy)),
        1.0 - smoothstep(0, gap * 4.0, np.minimum(gx, 1 - gx)),
    ) - edge, 0, 1)

    base = overlay(base, edge, (128, 124, 118), 0.75)

    height = 0.80 + 0.05 * grain - 0.03 * veins - 0.70 * edge - 0.20 * bevel
    height = norm01(blur(height, 0.5))

    ao = cavity_ao(height, sigma=16.0, strength=1.3)
    # Polished stone, but not mirror-uniform: veins are marginally softer than the matrix
    # because they are a different mineral, and the grout is unpolished cement.
    rough = np.clip(0.11 + 0.05 * grain + 0.14 * veins + 0.08 * branch + 0.74 * edge, 0, 1)
    metal = np.zeros((s, s), np.float32)

    emit('corridor_tile', base, height, ao, rough, metal, normal_strength=3.2)


# =============================================================================================
# 3. Acoustic wall — vertical walnut slats over dark felt
# =============================================================================================
def wall_panel():
    s = SIZE
    slats = 24
    duty = 0.76  # slat width vs. pitch; the remainder is the felt reveal

    slat_mask = stripes(s, slats, axis=1, duty=duty, softness=0.020)
    idx = cell_index(s, slats, axis=1)

    # Grain runs vertically along each slat — an anisotropic lattice, tall and narrow.
    grain = ridged(s, (700, 40), octaves=5, seed=707)
    pores = fbm(s, (900, 120), octaves=3, seed=808)
    tone = jitter_by(idx, seed=909, lo=-0.09, hi=0.09)

    wood = np.clip(0.46 + 0.34 * grain + 0.14 * pores + tone, 0, 1)
    # Real walnut, not the near-black (luma 20-56) the old map shipped.
    wood_rgb = tint(wood, (46, 31, 21), (134, 96, 62))

    felt = fbm(s, 420, octaves=3, seed=1010)
    felt_rgb = tint(felt, (14, 15, 18), (32, 34, 40))

    m = slat_mask[..., None]
    base = wood_rgb * m + felt_rgb * (1 - m)

    # Slats stand proud of the felt with a small rounded arris.
    arris = stripes(s, slats, axis=1, duty=duty, softness=0.055)
    height = 0.30 + 0.55 * arris + 0.10 * grain * slat_mask + 0.05 * felt * (1 - slat_mask)
    height = norm01(blur(height, 0.8))

    ao = cavity_ao(height, sigma=12.0, strength=1.5)
    # Satin-lacquered timber against acoustic felt: a wide, very visible roughness split.
    rough = np.clip(remap(1 - grain, 0.34, 0.56) * slat_mask + 0.95 * (1 - slat_mask), 0, 1)
    metal = np.zeros((s, s), np.float32)

    emit('wall_panel', base, height, ao, rough, metal, normal_strength=3.4)


# =============================================================================================
# 4. Stage floor — engineered oak plank
# =============================================================================================
def stage_wood():
    s = SIZE
    planks = 7

    idx_row = cell_index(s, planks, axis=0)
    # Stagger the end joints so the planks don't line up in a grid.
    stagger = jitter_by(idx_row, seed=1111, lo=0.0, hi=1.0)
    xoff = (np.linspace(0, 3, s, endpoint=False, dtype=np.float32)[None, :] + stagger) % 1.0
    end_joint = 1.0 - smoothstep(0, 0.006, np.minimum(xoff, 1 - xoff))

    plank_mask = stripes(s, planks, axis=0, duty=0.972, softness=0.006)
    seam = np.clip((1.0 - plank_mask) + end_joint, 0, 1)

    grain = ridged(s, (26, 620), octaves=6, seed=1212)
    figure = fbm(s, (10, 240), octaves=4, seed=1313)
    board = jitter_by(idx_row, seed=1414, lo=-0.10, hi=0.10)

    wood = np.clip(0.42 + 0.30 * grain + 0.20 * figure + board, 0, 1)
    # Warm mid-tone oak. The old map sat at luma 11-43, i.e. a black slab under stage lights.
    base = tint(wood, (74, 50, 30), (186, 143, 96))
    base = base * (1 - seam[..., None] * 0.62)

    height = 0.72 + 0.14 * grain + 0.06 * figure - 0.55 * seam
    height = norm01(blur(height, 0.7))

    ao = cavity_ao(height, sigma=14.0, strength=1.4)
    # Satin stage lacquer: glossy enough to catch the spots, varied enough not to look like vinyl.
    rough = np.clip(0.26 + 0.20 * (1 - grain) + 0.10 * figure + 0.55 * seam, 0, 1)
    metal = np.zeros((s, s), np.float32)

    emit('wood_stage', base, height, ao, rough, metal, normal_strength=2.2)


# =============================================================================================
# 5. Ceiling — perforated acoustic tile in a T-bar grid, with recessed downlights
# =============================================================================================
def ceiling():
    s = SIZE
    grid = 4
    cell = s // grid

    gy = (np.linspace(0, grid, s, endpoint=False, dtype=np.float32) % 1.0)[:, None]
    gx = (np.linspace(0, grid, s, endpoint=False, dtype=np.float32) % 1.0)[None, :]
    tbar = np.maximum(
        1.0 - smoothstep(0, 0.018, np.minimum(gy, 1 - gy)),
        1.0 - smoothstep(0, 0.018, np.minimum(gx, 1 - gx)),
    )

    # Radial distance to each cell centre, used for both the perforation fade and the downlight.
    ry = np.abs(gy - 0.5) * 2
    rx = np.abs(gx - 0.5) * 2
    r = np.sqrt(ry ** 2 + rx ** 2)

    # Perforations: a fine regular dot grid, faded out near the T-bar and the light fitting.
    pitch = 26.0
    py = (np.linspace(0, grid * pitch, s, endpoint=False, dtype=np.float32) % 1.0)[:, None] - 0.5
    px = (np.linspace(0, grid * pitch, s, endpoint=False, dtype=np.float32) % 1.0)[None, :] - 0.5
    perf = 1.0 - smoothstep(0.16, 0.30, np.sqrt(py ** 2 + px ** 2))
    perf *= (1 - tbar) * smoothstep(0.30, 0.42, r)

    mineral = fbm(s, 300, octaves=4, seed=1515)
    # A very slight sag towards the middle of each tile reads as a real suspended ceiling.
    sag = (1.0 - smoothstep(0.0, 1.0, r)) * 0.05

    bezel_o = 1.0 - smoothstep(0.26, 0.29, r)
    bezel_i = 1.0 - smoothstep(0.17, 0.20, r)
    lens = 1.0 - smoothstep(0.15, 0.175, r)

    tile_rgb = tint(np.clip(0.72 + 0.22 * mineral, 0, 1), (196, 193, 186), (240, 238, 233))
    base = tile_rgb * (1 - perf[..., None] * 0.55)
    base = base * (1 - tbar[..., None]) + (np.array((104, 106, 110), np.float32) / 255.0)[None, None, :] * tbar[..., None]

    ring = np.clip(bezel_o - bezel_i, 0, 1)[..., None]
    base = base * (1 - ring) + (np.array((176, 178, 182), np.float32) / 255.0)[None, None, :] * ring
    base = base * (1 - lens[..., None]) + (np.array((255, 250, 232), np.float32) / 255.0)[None, None, :] * lens[..., None]

    height = (0.70 + 0.10 * mineral - sag - 0.42 * tbar - 0.40 * perf
              - 0.18 * np.clip(bezel_o - bezel_i, 0, 1) - 0.10 * bezel_i)
    height = norm01(blur(height, 0.6))

    ao = cavity_ao(height, sigma=18.0, strength=1.2)
    rough = np.clip(0.88 - 0.10 * mineral - 0.55 * ring[..., 0] - 0.62 * lens + 0.05 * tbar, 0, 1)
    metal = np.clip(0.75 * ring[..., 0] + 0.35 * tbar, 0, 1)

    # Emission only where the lens actually is — the old map lit the whole ceiling plane.
    glow = np.clip(lens * 1.0 + (1.0 - smoothstep(0.15, 0.24, r)) * 0.35, 0, 1)
    emission = tint(glow, (0, 0, 0), (255, 238, 198)) * glow[..., None]

    emit('ceiling_tiles', base, height, ao, rough, metal, normal_strength=2.6, emission=emission)


# =============================================================================================
# 6. Banquet table linen
# =============================================================================================
def linen():
    s = 1024
    weft = stripes(s, 190, axis=0, duty=0.5, softness=0.22)
    warp_t = stripes(s, 190, axis=1, duty=0.5, softness=0.22)
    weave = 0.5 * weft + 0.5 * warp_t
    slub = fbm(s, 180, octaves=3, seed=1616)
    drape = blur(fbm(s, 6, octaves=3, seed=1717), 10)

    height = norm01(0.6 * weave + 0.25 * slub + 0.15 * drape)
    base = tint(np.clip(0.80 + 0.14 * weave + 0.08 * (slub - 0.5) + 0.10 * (drape - 0.5), 0, 1),
                (214, 210, 200), (252, 251, 247))
    ao = cavity_ao(height, sigma=8.0, strength=0.9)
    rough = np.clip(0.80 + 0.14 * (1 - weave) + 0.06 * slub, 0, 1)
    metal = np.zeros((s, s), np.float32)

    emit('table_linen', base, height, ao, rough, metal, normal_strength=1.6)


MATERIALS = {
    'carpet': carpet,
    'marble': marble,
    'wall': wall_panel,
    'stage': stage_wood,
    'ceiling': ceiling,
    'linen': linen,
}

if __name__ == '__main__':
    # Each material costs 1-3 minutes, so allow regenerating a subset while art-directing one.
    wanted = [a for a in sys.argv[1:] if not a.startswith('-')] or list(MATERIALS)
    unknown = [w for w in wanted if w not in MATERIALS]
    if unknown:
        raise SystemExit(f'Unknown material(s) {unknown}. Choose from: {", ".join(MATERIALS)}')

    print(f'Generating PBR surface materials at {SIZE}x{SIZE} into {TEX}')
    for key in wanted:
        MATERIALS[key]()

    print('\nVariance check (a constant roughness map is the bug this run exists to prevent):')
    failed = False
    for name, rough in _checks:
        spread = float(np.max(rough) - np.min(rough))
        ok = spread > 0.05
        failed |= not ok
        print(f'  {"OK  " if ok else "FAIL"} {name:<16} roughness spread {spread:.3f}')
    if failed:
        raise SystemExit('A material shipped a near-constant roughness map.')
    print('\nDone.')
