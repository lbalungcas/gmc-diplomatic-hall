"""
Procedural texture primitives for the Diplomatic Hall material set.

Everything here is *tileable*: noise lattices wrap, Worley feature points wrap toroidally, and
the height-to-normal Sobel uses np.roll. That matters because every surface in the venue is a
large plane with a repeat count in the single digits to the teens — a visible seam would be far
more damaging than slightly less interesting noise.

Maps are written as a PBR triple per material:
    <name>.png          base colour (sRGB)
    <name>_normal.png   tangent-space normal (non-colour)
    <name>_orm.png      R = ambient occlusion, G = roughness, B = metalness (non-colour)

The ORM packing is what glTF wants natively: the green/blue channels feed
`metallicRoughnessTexture` and the red channel feeds `occlusionTexture`, so one image serves
three material inputs instead of three separate downloads.
"""

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter


# --------------------------------------------------------------------------------------------
# Noise
# --------------------------------------------------------------------------------------------

def value_noise(size, res, seed=0):
    """Tileable value noise.

    `res` is the lattice resolution as (rows, cols) — anisotropic lattices give directional
    noise, which is how brushed metal and wood grain are built.
    """
    if isinstance(res, int):
        res = (res, res)
    ry, rx = max(1, int(res[0])), max(1, int(res[1]))
    rng = np.random.default_rng(seed)
    g = rng.random((ry, rx), dtype=np.float32)

    y = np.linspace(0, ry, size, endpoint=False, dtype=np.float32)
    x = np.linspace(0, rx, size, endpoint=False, dtype=np.float32)
    yi, xi = np.floor(y).astype(np.int32), np.floor(x).astype(np.int32)
    yf, xf = y - yi, x - xi
    # Quintic fade — smoother second derivative than smoothstep, so no visible lattice creases.
    v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)

    y0, y1 = yi % ry, (yi + 1) % ry
    x0, x1 = xi % rx, (xi + 1) % rx

    v00 = g[np.ix_(y0, x0)]
    v01 = g[np.ix_(y0, x1)]
    v10 = g[np.ix_(y1, x0)]
    v11 = g[np.ix_(y1, x1)]

    V = v[:, None]
    U = u[None, :]
    top = v00 * (1 - U) + v01 * U
    bot = v10 * (1 - U) + v11 * U
    return (top * (1 - V) + bot * V).astype(np.float32)


def fbm(size, res, octaves=5, gain=0.5, lacunarity=2, seed=0):
    """Fractal sum of value noise. Returns roughly 0..1."""
    if isinstance(res, int):
        res = (res, res)
    total = np.zeros((size, size), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    ry, rx = res
    for o in range(octaves):
        total += amp * value_noise(size, (ry, rx), seed + o * 977)
        norm += amp
        amp *= gain
        ry = int(round(ry * lacunarity))
        rx = int(round(rx * lacunarity))
    return total / norm


def ridged(size, res, octaves=5, seed=0):
    """Ridged multifractal — sharp creases. Used for marble veins and wood grain."""
    n = fbm(size, res, octaves=octaves, seed=seed)
    return 1.0 - np.abs(n * 2.0 - 1.0)


def worley(size, cells, seed=0, feature=0):
    """Tileable Worley/cellular noise, normalised 0..1.

    `feature` selects the nth-nearest distance (0 = F1, 1 = F2). F2-F1 gives cell borders.
    """
    rng = np.random.default_rng(seed)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1)
           + rng.random((cells, cells, 2))).astype(np.float32) / cells

    coords = np.linspace(0, 1, size, endpoint=False, dtype=np.float32)
    gy = coords[:, None]
    gx = coords[None, :]

    best = np.full((size, size), 4.0, dtype=np.float32)
    second = np.full((size, size), 4.0, dtype=np.float32)
    for py, px in pts.reshape(-1, 2):
        # Toroidal distance keeps the pattern seamless across the tile edge.
        dy = np.abs(gy - py)
        dy = np.minimum(dy, 1.0 - dy)
        dx = np.abs(gx - px)
        dx = np.minimum(dx, 1.0 - dx)
        d = dy * dy + dx * dx
        np.minimum(second, np.maximum(best, d), out=second)
        np.minimum(best, d, out=best)

    out = np.sqrt(second if feature else best)
    return np.clip(out * cells, 0.0, 1.0)


def warp(field, dy, dx, amount):
    """Domain-warp `field` by the (dy, dx) offset fields, wrapping at the edges."""
    size = field.shape[0]
    yy, xx = np.meshgrid(np.arange(size), np.arange(size), indexing='ij')
    sy = np.round(yy + (dy * 2 - 1) * amount).astype(np.int32) % size
    sx = np.round(xx + (dx * 2 - 1) * amount).astype(np.int32) % size
    return field[sy, sx]


def blur(a, sigma):
    """Wrapping Gaussian blur — `mode='wrap'` is what keeps blurred maps tileable."""
    return gaussian_filter(a, sigma=sigma, mode='wrap')


# --------------------------------------------------------------------------------------------
# Shaping helpers
# --------------------------------------------------------------------------------------------

def norm01(a):
    lo, hi = float(a.min()), float(a.max())
    return np.zeros_like(a) if hi - lo < 1e-6 else (a - lo) / (hi - lo)


def remap(a, lo, hi):
    """Map a 0..1 field into [lo, hi]."""
    return a * (hi - lo) + lo


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def stripes(size, count, axis=0, duty=0.5, softness=0.01):
    """Soft-edged periodic stripes in 0..1 — slats, planks, grout lines."""
    c = np.linspace(0, count, size, endpoint=False, dtype=np.float32) % 1.0
    band = smoothstep(0, softness, c) * (1.0 - smoothstep(duty - softness, duty, c))
    return np.repeat(band[:, None], size, axis=1) if axis == 0 else np.repeat(band[None, :], size, axis=0)


def cell_index(size, count, axis=0):
    """Integer index of the stripe/plank each texel belongs to — for per-plank colour jitter."""
    c = np.floor(np.linspace(0, count, size, endpoint=False)).astype(np.int32)
    return np.repeat(c[:, None], size, axis=1) if axis == 0 else np.repeat(c[None, :], size, axis=0)


def jitter_by(index, seed=0, lo=0.0, hi=1.0):
    """Deterministic per-cell random value, broadcast back over the index map."""
    rng = np.random.default_rng(seed)
    table = rng.random(int(index.max()) + 1).astype(np.float32)
    return remap(table[index], lo, hi)


# --------------------------------------------------------------------------------------------
# Map construction
# --------------------------------------------------------------------------------------------

def height_to_normal(height, strength=2.0):
    """Tangent-space normal from a height field. np.roll makes the derivative wrap."""
    h = height.astype(np.float32)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    dz = np.ones_like(dx)
    inv = 1.0 / np.sqrt(dx * dx + dy * dy + dz * dz)
    # Green channel is inverted for OpenGL/glTF tangent space (+Y up).
    return np.stack([dx * inv * 0.5 + 0.5, -dy * inv * 0.5 + 0.5, dz * inv * 0.5 + 0.5], axis=2)


def cavity_ao(height, sigma=14.0, strength=1.0):
    """Cheap AO: a texel sitting below its neighbourhood average is occluded.

    Not a ray-traced bake, but it is what makes grout lines, slat gaps and carpet pile read as
    recessed rather than merely painted on — and it costs nothing at runtime.
    """
    lowpass = blur(height, sigma)
    cavity = np.clip((height - lowpass) * 4.0 * strength + 1.0, 0.0, 1.0)
    return np.clip(0.35 + 0.65 * cavity, 0.0, 1.0)


def tint(mono, color_lo, color_hi):
    """Colourise a 0..1 field by interpolating between two RGB tuples (0-255)."""
    lo = np.array(color_lo, dtype=np.float32) / 255.0
    hi = np.array(color_hi, dtype=np.float32) / 255.0
    return lo[None, None, :] + mono[:, :, None] * (hi - lo)[None, None, :]


def to_srgb(linear):
    """Our colour fields are authored perceptually, so this only guards the range."""
    return np.clip(linear, 0.0, 1.0)


# --------------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------------

def save_rgb(path, rgb, out_size=None):
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGB')
    if out_size and out_size != im.width:
        # Detail is authored at full resolution and resampled down on the way out: deriving the
        # normal map from a 2048 height field and then shrinking keeps far more of the fine
        # structure than generating the noise at 1024 in the first place.
        im = im.resize((out_size, out_size), Image.LANCZOS)
    im.save(path, optimize=True)


def save_gray(path, a):
    Image.fromarray((np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'L').save(path, optimize=True)


def save_orm(path, ao, rough, metal, out_size=None):
    """Pack AO/roughness/metalness into one RGB image, glTF-style."""
    size = ao.shape[0]
    def chan(v):
        return np.full((size, size), float(v), dtype=np.float32) if np.isscalar(v) else v
    save_rgb(path, np.stack([chan(ao), chan(rough), chan(metal)], axis=2), out_size)


def report(name, base, normal, ao, rough, metal):
    """One line per material so a constant-valued map can never ship unnoticed again."""
    def rng(a):
        return f"{float(np.min(a)):.3f}-{float(np.max(a)):.3f}"
    r = rough if not np.isscalar(rough) else np.array([rough, rough])
    m = metal if not np.isscalar(metal) else np.array([metal, metal])
    lum = base[..., 0] * 0.299 + base[..., 1] * 0.587 + base[..., 2] * 0.114
    print(f"  {name:<16} luma {rng(lum):<13} rough {rng(r):<13} ao {rng(ao):<13} metal {rng(m)}")
