/**
 * Open-style booth grid — 24 booths in two back-to-back islands (src/data/hallLayout.json `grid`),
 * as in the October 19 floor plan.
 *
 * The booth hardware (spine walls, floor tiles, counters, stools, clip spots, plants, end totems)
 * is baked into the venue GLB by scripts/venue_set.py from the same layout file. This module owns
 * everything that depends on booths.json and therefore has to stay live:
 *
 *  - the printed back wall of each booth (on its face of the spine)
 *  - the counter front fascia
 *  - the row signs on the island end totems
 *
 * Geometry: a booth is a square tile between its spine (at the island's `spineZ`) and the aisle.
 * `facing` is the z direction the row opens toward, so a booth's frame is u along +x from its west
 * edge and d = distance from the spine toward the aisle.
 */
import * as THREE from 'three';

const NAVY = '#1B2D5C';
const BRAND = ['#F6B91A', '#1FA9E1', '#4CB848', '#EC2F7B', '#F47B20', '#9B4DCA', '#14B8A6'];

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * One record per booth, keyed by official booth number. Keeps the fields the rest of the game
 * already reads: `x/z` (counter), `ax/az` (where a visitor stands), `cx/cz` + `dirX/dirZ` (used to
 * decide which side of the spine you are on), `color`, `category`, `title`.
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
          z: island.spineZ + f * (G.counter.d0 + G.counter.d1) / 2,
          ax: xc,
          az: island.spineZ + f * G.anchorDepth,
        };
      });
    }
  }
  return out;
}

/** Axis-aligned collision boxes: each island's spine (with its end totems) and every counter. */
export function gridObstacles(layout, pad = 0.04) {
  const G = layout.grid;
  const x1 = G.x0 + G.cols * G.booth;
  const boxes = [];
  for (const island of G.islands) {
    boxes.push({
      minX: G.x0 - 0.1, maxX: x1 + 0.1,
      minZ: island.spineZ - 0.44, maxZ: island.spineZ + 0.44, label: 'booth-spine',
    });
    for (const row of island.rows) {
      const f = row.facing;
      const za = island.spineZ + f * G.counter.d0;
      const zb = island.spineZ + f * G.counter.d1;
      for (let col = 0; col < G.cols; col++) {
        const xc = G.x0 + col * G.booth + G.booth / 2;
        boxes.push({
          minX: xc - G.counter.width / 2 - pad, maxX: xc + G.counter.width / 2 + pad,
          minZ: Math.min(za, zb) - pad, maxZ: Math.max(za, zb) + pad, label: 'booth-counter',
        });
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

const FONT = 'system-ui, "Segoe UI", sans-serif';

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

/** Soft organic blobs and confetti — the marketplace's hand-made look, in the zone colour. */
function paintBlobs(ctx, W, H, colour, seed, top) {
  const r = rng(seed);
  const accents = BRAND.filter((c) => c.toLowerCase() !== colour.toLowerCase());
  const pick = () => accents[Math.floor(r() * accents.length)];
  const blobs = [
    { x: 0.05 + r() * 0.2, y: top + 0.32, rad: 0.42 + r() * 0.1, c: pick() },
    { x: 0.78 + r() * 0.18, y: top + 0.22, rad: 0.38 + r() * 0.12, c: colour },
    { x: 0.35 + r() * 0.3, y: top + 0.42, rad: 0.3 + r() * 0.08, c: pick() },
  ];
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (const b of blobs) {
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.ellipse(b.x * W, b.y * H, b.rad * W, b.rad * W * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = BRAND[Math.floor(r() * BRAND.length)];
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(r() * W, (top - 0.12 + r() * 0.1) * H, (0.006 + r() * 0.01) * W, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * A booth's back wall, laid out by height above the floor so it lines up with the real things in
 * front of it: the header band is visible over the counter from across the hall, the organisation
 * sits just above the TV, the theme and the sound hint just under it, and everything below the
 * counter top is decoration.
 */
function drawBackWall(booth, info, G, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = G.graphic;
  const panelW = g.u1 - g.u0;
  const panelH = g.y1 - g.y0;
  const px = W / panelW;                                  // canvas px per metre
  const yPx = (m) => H - ((m - g.y0) / panelH) * H;       // height above floor -> canvas y
  const name = (info && info.name) || booth.title;
  const org = info && info.organization && info.organization !== name ? info.organization : '';
  const theme = (info && (info.theme || info.category)) || '';

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#FFFDF8');
  bg.addColorStop(1, '#F4EFE5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  paintBlobs(ctx, W, H, booth.color, booth.id * 11 + 3, 0.86);

  // Header band in the row colour: number badge + innovation name.
  const hTop = yPx(g.y1);
  const hBot = yPx(2.06);
  ctx.fillStyle = booth.color;
  ctx.fillRect(0, hTop, W, hBot - hTop);
  const badge = (hBot - hTop) * 0.74;
  const bx = W * 0.04;
  const by = hTop + (hBot - hTop - badge) / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(bx, by, badge * 1.25, badge, badge * 0.18);
  ctx.fill();
  ctx.fillStyle = NAVY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(badge * 0.62)}px ${FONT}`;
  ctx.fillText(pad2(booth.id), bx + badge * 0.625, by + badge * 0.54);

  const tx = bx + badge * 1.25 + W * 0.035;
  const fit = fitWrapped(ctx, name.toUpperCase(), W - tx - W * 0.04, 2, Math.round(badge * 0.36), Math.round(badge * 0.2));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  const blockH = fit.lines.length * fit.size * 1.05;
  let ty = hTop + (hBot - hTop - blockH) / 2 + fit.size * 0.86;
  for (const line of fit.lines) { ctx.fillText(line, tx, ty); ty += fit.size * 1.05; }

  // Row tag under the header, right-aligned.
  ctx.font = `800 ${Math.round(px * 0.065)}px ${FONT}`;
  ctx.fillStyle = booth.color;
  ctx.textAlign = 'right';
  ctx.fillText(`${booth.zone.toUpperCase()} · BOOTH ${pad2(booth.id)}`, W - W * 0.04, hBot + px * 0.09);

  // Organisation, just above the TV.
  if (org) {
    ctx.textAlign = 'center';
    const o = fitWrapped(ctx, org, W * 0.86, 1, Math.round(px * 0.075), Math.round(px * 0.045), 700);
    ctx.fillStyle = 'rgba(27, 45, 92, 0.85)';
    ctx.fillText(o.lines[0] || '', W / 2, yPx(1.86));
  }

  // Recess behind the TV so the bezel reads as mounted, not floating.
  const tv = G.tv;
  const tvH = tv.width * 9 / 16;
  const cxPx = ((G.booth / 2 - g.u0) / panelW) * W;      // the TV is centred across the booth
  const tw = (tv.width + 0.08) * px;
  const top = yPx(tv.y + tvH / 2 + 0.04);
  const bot = yPx(tv.y - tvH / 2 - 0.04);
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.roundRect(cxPx - tw / 2, top, tw, bot - top, px * 0.03);
  ctx.fill();

  // Theme in the strip between the TV and the counter top. (The "tap for sound" hint lives in the
  // on-screen proximity prompt; printed here it collided with the theme on long theme names.)
  ctx.textAlign = 'center';
  if (theme) {
    const t = fitWrapped(ctx, theme.toUpperCase(), W * 0.9, 2, Math.round(px * 0.06), Math.round(px * 0.04), 800);
    ctx.fillStyle = booth.color;
    t.lines.forEach((line, i) => ctx.fillText(line, W / 2, yPx(1.12) + i * t.size * 1.1));
  }

  return canvas;
}

function drawCounterFront(booth, info, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FBFAF7';
  ctx.fillRect(0, 0, W, H);
  // Colour band along the bottom with a wave edge.
  ctx.fillStyle = booth.color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * 0.8 + Math.sin(x / W * Math.PI * 3) * H * 0.035);
  ctx.lineTo(W, H);
  ctx.fill();

  const name = (info && info.name) || booth.title;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = NAVY;
  ctx.font = `900 ${Math.round(H * 0.26)}px ${FONT}`;
  ctx.fillText(pad2(booth.id), W / 2, H * 0.27);
  const fit = fitWrapped(ctx, name.toUpperCase(), W * 0.86, 2, Math.round(H * 0.1), Math.round(H * 0.06), 800);
  fit.lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.5 + i * fit.size * 1.1));
  return canvas;
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

  const blocks = [left, right];
  blocks.forEach((b, i) => {
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

function loadArt(url, anisotropy) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Builds the live booth dressing. `attachTV(parent, localPos, booth, size)` is provided by main.js
 * so the TVs share its video pool and raycast list.
 */
export function createBoothGrid(scene, layout, booths, boothsData, { attachTV, lowPower = false, anisotropy = 4 } = {}) {
  const G = layout.grid;
  const g = G.graphic;
  const c = G.counter;
  const group = new THREE.Group();
  group.name = 'BoothGrid_Live';
  scene.add(group);

  const panelW = g.u1 - g.u0;
  const panelH = g.y1 - g.y0;
  // ~250 px per metre on desktop keeps the 10 cm header lettering crisp from the aisle without
  // putting 24 huge canvases on the GPU; phones get about half that.
  const W = lowPower ? 320 : 576;
  const H = Math.round(W * panelH / panelW);
  const aniso = lowPower ? 2 : anisotropy;
  const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
  const counterGeo = new THREE.PlaneGeometry(c.width - 0.04, c.height - 0.18);
  const tvW = G.tv.width;
  const tvH = tvW * 9 / 16;
  const disposables = [];

  for (const booth of Object.values(booths)) {
    const info = boothsData.find((b) => b.id === booth.id) || {};
    const art = Array.isArray(info.panelArt) ? info.panelArt : [];
    const f = booth.facing;
    const yaw = f > 0 ? 0 : Math.PI;            // plane normal +z, turned to face the aisle
    const west = booth.cx - G.booth / 2;

    const map = art[0] ? loadArt(art[0], aniso) : makeTexture(drawBackWall(booth, info, G, W, H), aniso);
    disposables.push(map);
    const wall = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 }));
    wall.position.set(west + (g.u0 + g.u1) / 2, g.y0 + panelH / 2, booth.spineZ + f * g.offset);
    wall.rotation.y = yaw;
    wall.receiveShadow = true;
    wall.name = `Booth_${pad2(booth.id)}_BackWall`;
    group.add(wall);

    if (attachTV) {
      const mount = new THREE.Group();
      mount.position.set(booth.cx, G.tv.y, booth.spineZ + f * (g.offset + 0.004));
      mount.rotation.y = yaw;
      group.add(mount);
      attachTV(mount, new THREE.Vector3(0, 0, 0.012), booth, { w: tvW, h: tvH });
    }

    const ctex = makeTexture(drawCounterFront(booth, info, lowPower ? 256 : 384, lowPower ? 224 : 320), aniso);
    disposables.push(ctex);
    const front = new THREE.Mesh(counterGeo, new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.4 }));
    front.position.set(booth.cx, 0.1 + (c.height - 0.18) / 2, booth.spineZ + f * (c.d1 + 0.008));
    front.rotation.y = yaw;
    front.name = `Booth_${pad2(booth.id)}_Counter`;
    group.add(front);
  }

  // End totems: one printed face on the outer end of each island spine.
  const x1 = G.x0 + G.cols * G.booth;
  const totemH = G.wallHeight + 0.4 - 0.12;
  const totemGeo = new THREE.PlaneGeometry(0.8, totemH);
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
      const northOnRight = sgn > 0;
      const north = rows.find((r) => r.north);
      const south = rows.find((r) => !r.north);
      const mk = (r, side) => ({ ...r, arrow: side === 'left' ? '◀' : '▶' });
      const [left, right] = northOnRight ? [mk(south, 'left'), mk(north, 'right')] : [mk(north, 'left'), mk(south, 'right')];
      const tex = makeTexture(drawTotem(left, right, 256, Math.round(256 * totemH / 0.8)), aniso);
      disposables.push(tex);
      const face = new THREE.Mesh(totemGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      face.position.set(xe + sgn * 0.086, 0.06 + totemH / 2, island.spineZ);
      face.rotation.y = sgn * Math.PI / 2;
      face.name = `BoothTotem_${island.rows.map((r) => r.row).join('')}_${sgn > 0 ? 'E' : 'W'}`;
      group.add(face);
    }
  }

  return { group, dispose: () => disposables.forEach((t) => t.dispose()) };
}
