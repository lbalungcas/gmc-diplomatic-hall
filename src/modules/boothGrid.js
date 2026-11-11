/**
 * Booth grid — 24 booths in two back-to-back islands (src/data/hallLayout.json `grid`), dressed
 * after the client's booth art: a framed 2.0 x 2.44 m printed backwall lit by two arm spotlights,
 * a booth-number fascia above it, a black draped table with a runner in the team's accent colour
 * and two chairs, and an easel carrying the team's poster on the visitor's left.
 *
 * scripts/venue_set.py bakes the hardware (spine partition, backwall frames, lamps, fascia
 * plates, tables, runners, chairs, easels, floor tiles, end totems) into the venue GLB from the
 * same layout file. This module owns everything that depends on team data or on the visitor and
 * therefore has to stay live:
 *
 *  - the print on each backwall (src/data/backwalls.json, made by scripts/prepare_assets.py; a
 *    booth's `panelArt` in booths.json overrides it, and a booth with neither gets a placeholder)
 *    and the team poster on each easel (src/data/posters.json). Both load small and swap to a
 *    sharp version for the few a visitor is close enough to read.
 *  - the booth-number signs (fascia + table runner), which gain a tick once the visitor holds
 *    that booth's passport stamp
 *  - the booth lights: the backwall of the booth a visitor is standing at brightens
 *  - the row signs on the island end totems
 *
 * Geometry: a booth is a square tile between its spine (the island's `spineZ`) and the aisle.
 * `facing` is the z direction the row opens toward, so a booth's frame is u along +x from its
 * west edge and d = distance from the spine toward the aisle.
 */
import * as THREE from 'three';

const NAVY = '#1B3461';
const ORANGE = '#DD9366';
const FONT = 'system-ui, "Segoe UI", sans-serif';
const POSTER_NEAR = 3.4;          // metres from an easel at which the sharp poster is loaded
const POSTER_SHARP_MAX = 4;       // sharp posters kept on the GPU at once
const WALL_SHARP_MAX = 6;         // sharp backwalls kept on the GPU at once (desktop)
const FOCUS_RADIUS = 2.6;         // metres from a booth's standing spot at which its lights come up
const LIGHT_IDLE = 1.0;           // backwall spot-pool strength, and at the booth being visited
const LIGHT_FOCUS = 2.1;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * One record per booth, keyed by official booth number. Keeps the fields the rest of the game
 * already reads: `x/z` (table), `ax/az` (where a visitor stands), `cx/cz` + `dirX/dirZ` (which
 * side of the spine you are on), `color`, `category`, `title`.
 */
export function computeBoothPositions(layout) {
  const G = layout.grid;
  const out = {};
  for (const island of G.islands) {
    for (const row of island.rows) {
      const f = row.facing;
      const zone = G.zones[row.row];
      row.booths.forEach((id, col) => {
        const xc = G.x0 + col * G.booth + G.booth / 2;
        out[id] = {
          id,
          row: row.row,
          col,
          zone: zone.name,
          color: zone.color,
          category: zone.name,
          title: `Booth ${pad2(id)}`,
          spineZ: island.spineZ,
          facing: f,
          cx: xc,
          cz: island.spineZ,
          dirX: 0,
          dirZ: f,
          x: xc,
          z: island.spineZ + f * G.table.d,
          ax: xc,
          az: island.spineZ + f * G.anchorDepth,
          easelX: xc - f * G.easel.side,
          easelZ: island.spineZ + f * G.easel.d,
        };
      });
    }
  }
  return out;
}

/** Collision boxes: each island's back-to-back walls (with end totems), every table and easel. */
export function gridObstacles(layout, pad = 0.04) {
  const G = layout.grid;
  const x1 = G.x0 + G.cols * G.booth;
  const boxes = [];
  for (const island of G.islands) {
    boxes.push({
      minX: G.x0 - 0.1, maxX: x1 + 0.1,
      minZ: island.spineZ - G.spineHalf - pad, maxZ: island.spineZ + G.spineHalf + pad, label: 'booth-walls',
    });
    for (const row of island.rows) {
      const f = row.facing;
      const t = G.table;
      const za = island.spineZ + f * (t.d - t.depth / 2);
      const zb = island.spineZ + f * (t.d + t.depth / 2);
      for (let col = 0; col < G.cols; col++) {
        const xc = G.x0 + col * G.booth + G.booth / 2;
        boxes.push({
          minX: xc - t.width / 2 - pad, maxX: xc + t.width / 2 + pad,
          minZ: Math.min(za, zb) - pad, maxZ: Math.max(za, zb) + pad, label: 'booth-table',
        });
        const ex = xc - f * G.easel.side;
        const ez = island.spineZ + f * G.easel.d;
        boxes.push({ minX: ex - 0.3, maxX: ex + 0.3, minZ: ez - 0.25, maxZ: ez + 0.25, label: 'booth-easel' });
      }
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------------------------
// Artwork helpers
// ---------------------------------------------------------------------------------------------
function makeTexture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Deterministic pseudo-random from a seed, so each booth's artwork is stable between visits. */
function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    return kept;
  }
  return lines;
}

/** Largest font (down to `min`) at which `text` wraps into at most `maxLines` lines. */
function fitWrapped(ctx, text, maxWidth, maxLines, size, min, weight = 900) {
  let s = size;
  let lines;
  for (;;) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    lines = wrapText(ctx, text, maxWidth, 99);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if ((lines.length <= maxLines && widest <= maxWidth) || s <= min) break;
    s -= 2;
  }
  ctx.font = `${weight} ${s}px ${FONT}`;
  return { size: s, lines: wrapText(ctx, text, maxWidth, maxLines) };
}

/** Shared image loads (the logo strip drawn on a placeholder backwall). */
const imageCache = new Map();
function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

/**
 * Placeholder backwall for a booth whose art has not been supplied, in the art's style. Top to
 * bottom: the booth number tab and the YIM logo, the innovation name in navy over the theme on an
 * orange pill, a clothesline of pinned photo frames, then "organized by" with the team's
 * organisation and the organizer / supporter logo strip. The bottom ~30 % sits behind the table.
 * `imgs` holds the logo images once loaded ({ logos, yim }), or nothing on the first paint.
 */
function drawBackWall(ctx, W, H, booth, info, imgs = {}) {
  const name = (info && info.name) || booth.title;
  const org = (info && info.organization) || '';
  const theme = (info && (info.theme || info.category)) || '';
  const r = rng(booth.id * 13 + 5);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  // Soft grey brush strokes, as on the reference print.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = NAVY;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(r() * W, H * (0.35 + r() * 0.5), W * (0.25 + r() * 0.2), H * 0.06, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Booth number tab (row colour), top-left; the YIM logo top-right.
  ctx.fillStyle = booth.color;
  ctx.beginPath();
  ctx.roundRect(W * 0.05, H * 0.035, W * 0.22, H * 0.065, H * 0.015);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(H * 0.04)}px ${FONT}`;
  ctx.fillText(`BOOTH ${pad2(booth.id)}`, W * 0.16, H * 0.069);
  if (imgs.yim) {
    const lh = H * 0.1;
    const lw = lh * imgs.yim.width / imgs.yim.height;
    ctx.drawImage(imgs.yim, W * 0.95 - lw, H * 0.02, lw, lh);
  }

  // Innovation name and theme pill.
  ctx.fillStyle = NAVY;
  const t = fitWrapped(ctx, name.toUpperCase(), W * 0.88, 2, Math.round(H * 0.072), Math.round(H * 0.04));
  const lineH = t.size * 1.05;
  let y = H * 0.215 - (t.lines.length - 1) * lineH / 2;
  t.lines.forEach((line, i) => ctx.fillText(line, W / 2, y + i * lineH));
  y = H * 0.215 + (t.lines.length - 1) * lineH / 2 + t.size * 0.95;
  if (theme) {
    ctx.font = `800 ${Math.round(H * 0.03)}px ${FONT}`;
    const label = wrapText(ctx, theme, W * 0.74, 1)[0] || '';
    const pw = Math.min(W * 0.84, ctx.measureText(label).width + H * 0.07);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.roundRect(W / 2 - pw / 2, y - H * 0.027, pw, H * 0.054, H * 0.027);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, W / 2, y + 1);
  }

  // Clothesline of pinned photo frames, slightly askew.
  const lineY = H * 0.41;
  ctx.strokeStyle = 'rgba(27,52,97,0.35)';
  ctx.lineWidth = Math.max(2, W * 0.003);
  ctx.beginPath();
  ctx.moveTo(W * 0.03, lineY - H * 0.012);
  ctx.quadraticCurveTo(W / 2, lineY + H * 0.025, W * 0.97, lineY - H * 0.012);
  ctx.stroke();
  const tints = [['#F3D9C6', '#E7B998'], ['#D7E9F3', '#A9CDE3'], ['#F6E3B4', '#EBC877'], ['#EBD3E4', '#D9A9CB']];
  for (let i = 0; i < 4; i++) {
    const cx = W * (0.15 + i * 0.233);
    const cy = lineY + H * 0.1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((r() - 0.5) * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-W * 0.1 + 4, -H * 0.088 + 6, W * 0.2, H * 0.176);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-W * 0.1, -H * 0.088, W * 0.2, H * 0.176);
    const [a, b] = tints[(i + booth.id) % tints.length];
    const grad = ctx.createLinearGradient(0, -H * 0.078, 0, H * 0.05);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    ctx.fillStyle = grad;
    ctx.fillRect(-W * 0.086, -H * 0.076, W * 0.172, H * 0.126);
    ctx.restore();
    // Wooden peg.
    ctx.fillStyle = '#C79A5B';
    ctx.fillRect(cx - W * 0.008, lineY - H * 0.012, W * 0.016, H * 0.032);
  }

  // "organized by" + organisation on the left, the organizer / supporter logos on the right,
  // just above the table line as on the reference.
  const rowY = H * 0.635;
  if (org) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(27,52,97,0.75)';
    ctx.font = `700 ${Math.round(H * 0.024)}px ${FONT}`;
    ctx.fillText('organized by:', W * 0.06, rowY);
    ctx.fillStyle = NAVY;
    const o = fitWrapped(ctx, org, W * 0.4, 2, Math.round(H * 0.034), Math.round(H * 0.022), 800);
    o.lines.forEach((l, i) => ctx.fillText(l, W * 0.06, rowY + H * 0.042 + i * o.size * 1.1));
    ctx.textAlign = 'center';
  }
  if (imgs.logos) {
    const lw = W * 0.46;
    const lh = lw * imgs.logos.height / imgs.logos.width;
    ctx.drawImage(imgs.logos, W * 0.95 - lw, rowY - H * 0.02, lw, lh);
  }

  // Row-colour foot band (mostly hidden by the table).
  ctx.fillStyle = booth.color;
  ctx.fillRect(0, H * 0.965, W, H * 0.035);
}

/** Stand-in poster for a booth whose poster has not been supplied yet. */
function drawPosterPlaceholder(booth, info, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H * 0.12);
  ctx.fillRect(0, H * 0.86, W, H * 0.14);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const t = fitWrapped(ctx, ((info && info.name) || booth.title).toUpperCase(), W * 0.84, 3, Math.round(W * 0.11), Math.round(W * 0.06));
  t.lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.3 + i * t.size * 1.1));
  ctx.font = `700 ${Math.round(W * 0.05)}px ${FONT}`;
  ctx.fillText('Poster coming soon', W / 2, H * 0.62);
  return c;
}

/**
 * End totem: the two rows of an island, each on the side of the spine it actually occupies as
 * seen from this end, with the booth range — wayfinding from the aisles.
 */
function drawTotem(left, right, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(W * 0.1)}px ${FONT}`;
  ctx.fillText('BOOTHS', W / 2, H * 0.07);

  [left, right].forEach((b, i) => {
    const y0 = H * (0.14 + i * 0.42);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(W * 0.08, y0, W * 0.84, H * 0.38, W * 0.06);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.round(W * 0.42)}px ${FONT}`;
    ctx.fillText(b.row, W / 2, y0 + H * 0.15);
    ctx.font = `800 ${Math.round(W * 0.12)}px ${FONT}`;
    ctx.fillText(b.range, W / 2, y0 + H * 0.27);
    ctx.font = `900 ${Math.round(W * 0.14)}px ${FONT}`;
    ctx.fillText(b.arrow, W / 2, y0 + H * 0.34);
  });
  return canvas;
}

function loadTexture(url, anisotropy, onLoad) {
  const tex = new THREE.TextureLoader().load(url, onLoad);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * What the two arm spotlights do to a backwall: two warm pools high on the print that fall away
 * toward the floor and the corners. One small gradient shared by all 24 prints as their light
 * map, so the lit look costs a texture sample and no lights.
 */
function createSpotPoolTexture(layout) {
  const G = layout.grid;
  const g = G.graphic;
  const W = 64, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(46, 42, 38)';            // what reaches the print without its own lights
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const span = g.u1 - g.u0;
  for (const ox of G.lamps.offsets) {
    const cx = (0.5 + ox * 0.55 / span) * W;    // the lamps are aimed inward of where they stand
    const cy = H * 0.26;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 1.75);                         // a pool on a wall is taller than it is wide
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.62);
    grad.addColorStop(0, 'rgba(255, 238, 208, 0.6)');
    grad.addColorStop(0.45, 'rgba(255, 234, 200, 0.3)');
    grad.addColorStop(1, 'rgba(255, 230, 196, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Booth-number signs: the fascia above each backwall and the disc on each table runner. All 48
// share one canvas atlas and one merged mesh, so the whole set is a single draw call, and a
// booth's cells are simply redrawn when the visitor collects its stamp.
// ---------------------------------------------------------------------------------------------
const VISITED = '#10B981';

function drawFascia(ctx, x, y, w, h, id, accent, visited) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  ctx.textBaseline = 'alphabetic';
  const num = pad2(id);
  ctx.font = `900 ${Math.round(h * 0.68)}px ${FONT}`;
  const numW = ctx.measureText(num).width;
  ctx.font = `800 ${Math.round(h * 0.22)}px ${FONT}`;
  const word = 'BOOTH';
  const wordW = ctx.measureText(word).width;
  const gap = h * 0.12;
  const x0 = (w - wordW - gap - numW) / 2;
  const base = h * 0.72;
  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.fillText(word, x0, base);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(h * 0.68)}px ${FONT}`;
  ctx.fillText(num, x0 + wordW + gap, base);
  if (visited) {
    const r = h * 0.17;
    const cx = w - r - h * 0.09, cy = r + h * 0.09;
    ctx.fillStyle = VISITED;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = r * 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.36);
    ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBadge(ctx, x, y, s, id, visited) {
  ctx.clearRect(x, y, s, s);
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  const r = s * 0.46;
  ctx.fillStyle = visited ? VISITED : NAVY;       // the rim; also hides the cut-out's edge
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, 0, r * (visited ? 0.84 : 0.9), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NAVY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(s * 0.5)}px ${FONT}`;
  ctx.fillText(pad2(id), 0, s * 0.03);
  ctx.restore();
}

function createBoothSigns(layout, booths, accentOf, isVisited, { lowPower, anisotropy }) {
  const G = layout.grid;
  const fa = G.fascia;
  const fr = G.backwall.frame;
  const tb = G.table;
  const ru = tb.runner;
  const list = Object.values(booths).sort((a, b) => a.id - b.id);

  // Atlas: fascia cells in a grid, the square runner discs in rows beneath them.
  const k = lowPower ? 0.75 : 1;
  const FW = Math.round(248 * k), FH = Math.round(FW * fa.height / fa.width);
  const BS = Math.round(FW / 2);
  const cols = 6;
  const rowsF = Math.ceil(list.length / cols);
  const rowsB = Math.ceil(list.length / (cols * 2));
  const canvas = document.createElement('canvas');
  canvas.width = cols * FW;
  canvas.height = rowsF * FH + rowsB * BS;
  const ctx = canvas.getContext('2d');
  const cells = new Map();     // booth id -> { fascia: [x, y], badge: [x, y] }
  list.forEach((b, i) => {
    cells.set(b.id, {
      fascia: [(i % cols) * FW, Math.floor(i / cols) * FH],
      badge: [(i % (cols * 2)) * BS, rowsF * FH + Math.floor(i / (cols * 2)) * BS],
    });
  });
  const paint = (id) => {
    const c = cells.get(id);
    drawFascia(ctx, c.fascia[0], c.fascia[1], FW, FH, id, accentOf(id), isVisited(id));
    drawBadge(ctx, c.badge[0], c.badge[1], BS, id, isVisited(id));
  };
  list.forEach((b) => paint(b.id));
  const tex = makeTexture(canvas, anisotropy);

  // One merged mesh: two quads per booth, each facing the booth's aisle.
  const pos = [], nor = [], uv = [], idx = [];
  const inset = 1.5;           // texels kept clear of the neighbouring cell, for the mip chain
  const quad = (cx, cy, cz, f, w, h, px, py, pw, ph) => {
    const n = pos.length / 3;
    const rx = f;              // the visitor's right is +x for a row facing +z, -x otherwise
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cx + sx * rx * w / 2, cy + sy * h / 2, cz);
      nor.push(0, 0, f);
      uv.push((sx < 0 ? px + inset : px + pw - inset) / canvas.width,
        1 - (sy < 0 ? py + ph - inset : py + inset) / canvas.height);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  for (const b of list) {
    const c = cells.get(b.id);
    const f = b.facing;
    quad(b.cx, fr.height + 0.012 + fa.height / 2, b.spineZ + f * (fa.d + 0.002), f,
      fa.width, fa.height, c.fascia[0], c.fascia[1], FW, FH);
    quad(b.cx, ru.badge.y, b.spineZ + f * (tb.d + tb.depth / 2 + ru.proud + ru.thickness + 0.002), f,
      ru.badge.size, ru.badge.size, c.badge[0], c.badge[1], BS, BS);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0, alphaTest: 0.5 }));
  mesh.name = 'BoothSigns';

  return {
    mesh,
    refresh(id) {
      if (!cells.has(id)) return;
      paint(id);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); geo.dispose(); },
  };
}

/**
 * Keeps a small version of every print on the GPU and swaps in the sharp one for the few a
 * visitor is close enough to read. `items` carry { mat, small, url, x, z }; the `max` nearest
 * within `near` metres are held sharp, and one is released only once it is both out of range
 * and over the budget, so walking along a row does not thrash.
 */
function createSharpener(items, { near, max, anisotropy }) {
  return function update(px, pz) {
    for (const e of items) e.dist = e.url ? Math.hypot(px - e.x, pz - e.z) : Infinity;
    const wanted = items.filter((e) => e.dist < near).sort((a, b) => a.dist - b.dist).slice(0, max);
    for (const e of wanted) {
      if (e.sharp) continue;
      const tex = loadTexture(e.url, anisotropy, () => { if (e.sharp === tex) e.mat.map = tex; });
      e.sharp = tex;
    }
    const held = items.filter((e) => e.sharp).sort((a, b) => a.dist - b.dist);
    held.forEach((e, i) => {
      if (i >= max && e.dist > near) {
        e.mat.map = e.small;
        e.sharp.dispose();
        e.sharp = null;
      }
    });
  };
}

/**
 * Builds the live booth dressing.
 *
 *  - `art.backwalls` is src/data/backwalls.json and `art.posters` src/data/posters.json (both
 *    written by scripts/prepare_assets.py). A booth's `panelArt[0]` in booths.json overrides its
 *    backwall; a booth with neither gets the drawn placeholder.
 *  - `isVisited(id)` says whether the visitor already holds that booth's stamp; call
 *    `setVisited(id)` when that changes.
 *  - `attachTV` is only used if the layout turns booth TVs back on (`grid.tv.enabled`).
 *
 * Returns `update(px, pz)` for the slow per-position work (which prints to hold sharp, which
 * booth the visitor is standing at) and `animate(dt)` for the per-frame fade of the booth lights.
 */
export function createBoothGrid(scene, layout, booths, boothsData, art = {}, {
  attachTV, lowPower = false, anisotropy = 4, isVisited = () => false,
} = {}) {
  const G = layout.grid;
  const g = G.graphic;
  const ea = G.easel;
  const posters = art.posters || {};
  const backwalls = art.backwalls || {};
  const group = new THREE.Group();
  group.name = 'BoothGrid_Live';
  scene.add(group);

  const panelW = g.u1 - g.u0;
  const panelH = g.y1 - g.y0;
  const W = lowPower ? 320 : 640;
  const H = Math.round(W * panelH / panelW);
  const aniso = lowPower ? 2 : anisotropy;
  const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
  const posterGeo = new THREE.PlaneGeometry(ea.boardW - 0.012, ea.boardH - 0.012);
  const disposables = [panelGeo, posterGeo];
  const walls = [];
  const easels = [];
  const lit = new Map();        // booth id -> { mat, level } for the booth-light fade
  const spotPool = createSpotPoolTexture(layout);
  disposables.push(spotPool);
  // Logos for a placeholder backwall, fetched only if one is ever drawn.
  let logoImages = null;
  const loadLogos = () => logoImages || (logoImages = Promise.all([
    loadImage('/venue/logos.webp'), loadImage('/landing/assets/web/logo-navbar.png'),
  ]).then(([logos, yim]) => ({ logos, yim })));

  for (const booth of Object.values(booths)) {
    const info = boothsData.find((b) => b.id === booth.id) || {};
    const own = Array.isArray(info.panelArt) ? info.panelArt[0] : null;
    const print = backwalls[String(booth.id)];
    const f = booth.facing;
    const yaw = f > 0 ? 0 : Math.PI;            // plane normal +z, turned to face the aisle
    const west = booth.cx - G.booth / 2;

    // --- Backwall print: the client's art (small until the visitor is close), lit by the
    // shared spot-pool light map.
    let map;
    let sharpUrl = null;
    if (own) {
      map = loadTexture(own, aniso);
    } else if (print) {
      map = loadTexture(print.sm, aniso);
      sharpUrl = print.lg;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      drawBackWall(ctx, W, H, booth, info);
      map = makeTexture(canvas, aniso);
      const placeholder = map;
      loadLogos().then((imgs) => {
        if (!imgs.logos && !imgs.yim) return;
        drawBackWall(ctx, W, H, booth, info, imgs);
        placeholder.needsUpdate = true;
      });
    }
    disposables.push(map);
    const wallMat = new THREE.MeshStandardMaterial({
      map, roughness: 0.82, metalness: 0, lightMap: spotPool, lightMapIntensity: LIGHT_IDLE,
    });
    const wall = new THREE.Mesh(panelGeo, wallMat);
    wall.position.set(west + (g.u0 + g.u1) / 2, g.y0 + panelH / 2, booth.spineZ + f * g.offset);
    wall.rotation.y = yaw;
    wall.receiveShadow = true;
    wall.name = `Booth_${pad2(booth.id)}_BackWall`;
    group.add(wall);
    // Ranked by where a visitor stands to look at this wall, not by the wall itself: the booth
    // backing onto it across the spine is just as near, and faces the other way.
    walls.push({ mat: wallMat, small: map, url: sharpUrl, sharp: null, x: booth.ax, z: booth.az });
    lit.set(booth.id, { mat: wallMat, level: LIGHT_IDLE });

    // --- Poster on the easel: same placement as the baked board in scripts/venue_set.py easel().
    const stand = new THREE.Group();
    stand.position.set(booth.easelX, 0.03, booth.easelZ);
    stand.rotation.y = yaw + THREE.MathUtils.degToRad(ea.turn);
    const ledge = new THREE.Group();
    ledge.position.set(0, ea.bottom, -0.02);
    ledge.rotation.x = -THREE.MathUtils.degToRad(ea.tilt);
    stand.add(ledge);
    group.add(stand);

    const entry = posters[String(booth.id)];
    const posterMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    posterMat.map = entry
      ? loadTexture(entry.sm, aniso)
      : makeTexture(drawPosterPlaceholder(booth, info, 300, 425), aniso);
    disposables.push(posterMat.map);
    const poster = new THREE.Mesh(posterGeo, posterMat);
    poster.position.set(0, ea.boardH / 2, 0.004);
    poster.name = `Booth_${pad2(booth.id)}_Poster`;
    ledge.add(poster);
    easels.push({ mat: posterMat, small: posterMat.map, url: entry ? entry.lg : null, sharp: null, x: booth.easelX, z: booth.easelZ });

    // --- Optional wall TV (off: booth videos open in the booth pop-up).
    if (G.tv && G.tv.enabled && attachTV) {
      const tvW = G.tv.width;
      const mount = new THREE.Group();
      mount.position.set(booth.cx, G.tv.y, booth.spineZ + f * (g.offset + 0.004));
      mount.rotation.y = yaw;
      group.add(mount);
      attachTV(mount, new THREE.Vector3(0, 0, 0.012), booth, { w: tvW, h: tvW * 9 / 16 });
    }
  }

  // Booth-number fascias and runner discs, in the team's accent colour.
  const accentOf = (id) => (backwalls[String(id)] && backwalls[String(id)].accent) || booths[id].color;
  const signs = createBoothSigns(layout, booths, accentOf, isVisited, { lowPower, anisotropy: aniso });
  group.add(signs.mesh);

  // End totems: one printed face on the outer end of each island.
  const x1 = G.x0 + G.cols * G.booth;
  const totemH = G.wallHeight + 0.4 - 0.12;
  const totemGeo = new THREE.PlaneGeometry(0.8, totemH);
  disposables.push(totemGeo);
  for (const island of G.islands) {
    const rows = island.rows.map((r) => ({
      row: r.row,
      color: G.zones[r.row].color,
      range: `${pad2(Math.min(...r.booths))}–${pad2(Math.max(...r.booths))}`,
      north: r.facing < 0,
    }));
    for (const [xe, sgn] of [[G.x0, -1], [x1, 1]]) {
      // Looking at the east end (face +x) the north row is on the viewer's right; at the west
      // end it is on their left.
      const north = rows.find((r) => r.north);
      const south = rows.find((r) => !r.north);
      const mk = (r, side) => ({ ...r, arrow: side === 'left' ? '◀' : '▶' });
      const [left, right] = sgn > 0 ? [mk(south, 'left'), mk(north, 'right')] : [mk(north, 'left'), mk(south, 'right')];
      const tex = makeTexture(drawTotem(left, right, 256, Math.round(256 * totemH / 0.8)), aniso);
      disposables.push(tex);
      const face = new THREE.Mesh(totemGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      face.position.set(xe + sgn * 0.086, 0.06 + totemH / 2, island.spineZ);
      face.rotation.y = sgn * Math.PI / 2;
      face.name = `BoothTotem_${island.rows.map((r) => r.row).join('')}_${sgn > 0 ? 'E' : 'W'}`;
      group.add(face);
    }
  }

  // Backwalls read from across the aisle, so they sharpen from further out than the posters do.
  // A tablet holds two sharp backwalls and no sharp posters (the booth pop-up shows the poster).
  const sharpenWalls = createSharpener(walls, { near: lowPower ? 4.5 : 6.5, max: lowPower ? 2 : WALL_SHARP_MAX, anisotropy: aniso });
  const sharpenPosters = lowPower ? null : createSharpener(easels, { near: POSTER_NEAR, max: POSTER_SHARP_MAX, anisotropy: aniso });

  let focus = null;             // the booth the visitor is standing at: its lights come up

  function update(px, pz) {
    sharpenWalls(px, pz);
    if (sharpenPosters) sharpenPosters(px, pz);
    let best = null;
    let bestD = FOCUS_RADIUS;
    for (const booth of Object.values(booths)) {
      const d = Math.hypot(px - booth.ax, pz - booth.az);
      if (d < bestD) { bestD = d; best = booth.id; }
    }
    focus = best;
  }

  function animate(dt) {
    const step = Math.min(1, dt * 3.5);
    for (const [id, l] of lit) {
      const target = id === focus ? LIGHT_FOCUS : LIGHT_IDLE;
      if (l.level === target) continue;
      l.level += (target - l.level) * step;
      if (Math.abs(target - l.level) < 0.01) l.level = target;
      l.mat.lightMapIntensity = l.level;
    }
  }

  return {
    group,
    update,
    animate,
    /** Redraws a booth's number signs after its stamp is collected (or the passport is reset). */
    setVisited: (id) => signs.refresh(id),
    get focus() { return focus; },
    dispose: () => {
      disposables.forEach((t) => t.dispose());
      signs.dispose();
      [...walls, ...easels].forEach((e) => e.sharp && e.sharp.dispose());
    },
  };
}
