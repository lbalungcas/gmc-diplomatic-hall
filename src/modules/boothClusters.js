/**
 * Booth clusters — 24 booths in eight themed clusters of three (src/data/hallLayout.json).
 *
 * The cluster hardware (partition panels, counters, stools, clip spots, plants) is baked into
 * the venue GLB by scripts/venue_set.py from the same layout file. This module owns everything
 * that depends on booths.json and therefore has to stay live:
 *
 *  - the printed graphics on both panel faces of each booth's bay
 *  - the counter front fascia
 *  - the floating "C1".."C9" cluster signs and the coloured dashed floor rings
 *
 * Geometry conventions (three.js): an angle `t` in the layout is measured in the x/z plane from
 * +x toward +z, so its direction is (cos t, sin t). Booth k of cluster c occupies the bay
 * between the panels at bayAngle ± 60°. Booth numbers are the official ones from each cluster's
 * `booths` list, so a cluster can hold e.g. booths 11, 13 and 24.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;

export const BOOTH_TV_W = 0.72;
export const BOOTH_TV_H = BOOTH_TV_W * 9 / 16;
export const BOOTH_TV_Y = 1.55;

// Brand accents layered over each cluster's own colour in the blob artwork.
const BRAND = ['#F6B91A', '#1FA9E1', '#4CB848', '#EC2F7B', '#F47B20', '#9B4DCA', '#14B8A6'];
const NAVY = '#1B2D5C';

const pad2 = (n) => String(n).padStart(2, '0');
const dir = (deg) => ({ x: Math.cos(deg * DEG), z: Math.sin(deg * DEG) });

/**
 * Expands the cluster table into one record per booth, keyed by official booth number.
 * The record keeps the fields the rest of the game already used (x/z, ax/az, title, category)
 * plus the bay orientation that replaced the old ±X `facing`.
 */
export function computeBoothPositions(layout) {
  const c = layout.clusters;
  const out = {};
  c.list.forEach((cl, ci) => {
    c.bayAngles.forEach((bay, k) => {
      const id = cl.booths[k];
      const d = dir(bay);
      out[id] = {
        id,
        cluster: cl.id,
        clusterIndex: ci,
        bayIndex: k,
        color: cl.color,
        category: cl.theme,
        title: `Booth ${pad2(id)}`,
        cx: cl.x,
        cz: cl.z,
        bay,
        dirX: d.x,
        dirZ: d.z,
        // The counter sits at the bay mouth; markers, labels and the minimap dot use it.
        x: cl.x + d.x * c.counterRadius,
        z: cl.z + d.z * c.counterRadius,
        // Where a visitor stands to talk to the booth.
        ax: cl.x + d.x * c.anchorRadius,
        az: cl.z + d.z * c.anchorRadius,
      };
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------------------------
function makeTexture(canvas, anisotropy = 4) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Deterministic pseudo-random from a seed, so each booth's blobs are stable between visits. */
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

function fitText(ctx, text, maxWidth, size, weight = 900, family = 'system-ui, "Segoe UI", sans-serif') {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 2;
  } while (s > 10);
  return s;
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
    ctx.font = `${weight} ${s}px system-ui, "Segoe UI", sans-serif`;
    lines = wrapText(ctx, text, maxWidth, 99);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if ((lines.length <= maxLines && widest <= maxWidth) || s <= min) break;
    s -= 2;
  }
  return { size: s, lines: wrapText(ctx, text, maxWidth, maxLines) };
}

/** Big soft organic blobs along the bottom of the panel, like the booth design reference. */
function paintBlobs(ctx, W, H, colour, seed, { top = 0.5 } = {}) {
  const r = rng(seed);
  const accents = BRAND.filter((c) => c.toLowerCase() !== colour.toLowerCase());
  const picks = [colour, accents[Math.floor(r() * accents.length)], accents[Math.floor(r() * accents.length)], colour];
  const blobs = [
    { x: 0.05 + r() * 0.2, y: top + 0.42, rad: 0.62 + r() * 0.12, c: picks[1] },
    { x: 0.75 + r() * 0.2, y: top + 0.30, rad: 0.55 + r() * 0.15, c: picks[0] },
    { x: 0.30 + r() * 0.3, y: top + 0.55, rad: 0.42 + r() * 0.1, c: picks[2] },
    { x: 0.9, y: top + 0.62, rad: 0.3, c: picks[3] },
  ];
  ctx.save();
  for (const b of blobs) {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.ellipse(b.x * W, b.y * H, b.rad * W, b.rad * W * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaf-ish arc highlights for a hand-made feel.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = W * 0.018;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc((0.2 + r() * 0.6) * W, (top + 0.4 + r() * 0.2) * H, (0.15 + r() * 0.15) * W, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

function paintConfetti(ctx, W, H, seed, yMax) {
  const r = rng(seed + 99);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = BRAND[Math.floor(r() * BRAND.length)];
    ctx.globalAlpha = 0.85;
    const x = r() * W;
    const y = r() * yMax * H;
    const s = (0.008 + r() * 0.012) * W;
    if (i % 3 === 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI);
      ctx.fillRect(-s, -s * 0.45, s * 2, s * 0.9);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function clusterPill(ctx, x, y, h, label, colour) {
  ctx.font = `900 ${Math.round(h * 0.62)}px system-ui, "Segoe UI", sans-serif`;
  const w = ctx.measureText(label).width + h * 0.9;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  return w;
}

/**
 * Face A — the "poster" face: number, team name, category, playful blobs.
 * Face B — the "screen" face: a dark well where the TV hangs, name above, hint below.
 * Both are placeholders until a team's own art arrives (booths.json `panelArt`).
 */
function drawPanel(booth, info, face, W, H, panelH) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const name = (info && info.name) || booth.title;
  const yPx = (m) => H - (m / panelH) * H;     // metres above the panel bottom -> canvas y

  // Warm white fabric ground with a whisper of the cluster colour at the top.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFFDF8');
  g.addColorStop(1, '#F6F1E7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = booth.color;
  ctx.fillRect(0, 0, W, H * 0.018);

  if (face === 'A') {
    paintBlobs(ctx, W, H, booth.color, booth.id * 7 + 1, { top: 0.52 });
    paintConfetti(ctx, W, H, booth.id, 0.45);

    // Number badge
    const top = H * 0.07;
    clusterPill(ctx, W * 0.08, top, W * 0.13, booth.cluster, booth.color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = NAVY;
    ctx.font = `900 ${Math.round(W * 0.36)}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText(pad2(booth.id), W * 0.07, top + W * 0.5);
    ctx.font = `800 ${Math.round(W * 0.07)}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText('BOOTH', W * 0.09, top + W * 0.6);

    // Innovation name (wrapped), organisation and theme in the eye-level band.
    let y = top + W * 0.78;
    const fit = fitWrapped(ctx, name.toUpperCase(), W * 0.84, 3, Math.round(W * 0.095), Math.round(W * 0.06));
    ctx.fillStyle = NAVY;
    for (const line of fit.lines) { ctx.fillText(line, W * 0.08, y); y += fit.size * 1.08; }
    const org = info && info.organization && info.organization !== name ? info.organization : '';
    if (org) {
      ctx.font = `700 ${Math.round(W * 0.05)}px system-ui, "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(27, 45, 92, 0.8)';
      for (const line of wrapText(ctx, org, W * 0.84, 2)) { y += W * 0.01; ctx.fillText(line, W * 0.08, y + W * 0.03); y += W * 0.06; }
    }
    ctx.font = `800 ${Math.round(W * 0.048)}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = booth.color;
    for (const line of wrapText(ctx, (booth.category || '').toUpperCase(), W * 0.84, 2)) { ctx.fillText(line, W * 0.08, y + W * 0.07); y += W * 0.058; }
  } else {
    paintBlobs(ctx, W, H, booth.color, booth.id * 7 + 2, { top: 0.66 });

    // Header
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = NAVY;
    const head = fitWrapped(ctx, name.toUpperCase(), W * 0.86, 2, Math.round(W * 0.085), Math.round(W * 0.055));
    head.lines.slice().reverse().forEach((line, i) => {
      ctx.fillText(line, W / 2, yPx(BOOTH_TV_Y + BOOTH_TV_H / 2) - W * 0.12 - i * head.size * 1.08);
    });
    ctx.font = `800 ${Math.round(W * 0.06)}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = booth.color;
    ctx.fillText(`BOOTH ${pad2(booth.id)} · ${booth.cluster}`, W / 2, yPx(BOOTH_TV_Y + BOOTH_TV_H / 2) - W * 0.04);

    // Recess behind the TV so the bezel reads as mounted, not floating.
    const tvW = (BOOTH_TV_W + 0.06) / 0.915 * W;
    const tvTop = yPx(BOOTH_TV_Y + BOOTH_TV_H / 2 + 0.03);
    const tvBot = yPx(BOOTH_TV_Y - BOOTH_TV_H / 2 - 0.03);
    ctx.fillStyle = '#1B2D5C';
    ctx.beginPath();
    ctx.roundRect((W - tvW) / 2, tvTop, tvW, tvBot - tvTop, W * 0.02);
    ctx.fill();

    ctx.fillStyle = 'rgba(27, 45, 92, 0.75)';
    ctx.font = `700 ${Math.round(W * 0.05)}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText('▶ Tap the screen for sound', W / 2, tvBot + W * 0.09);
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
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * 0.78 + Math.sin(x / W * Math.PI * 3) * H * 0.04);
  ctx.lineTo(W, H);
  ctx.fill();

  const name = (info && info.name) || booth.title;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = NAVY;
  ctx.font = `900 ${Math.round(H * 0.24)}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(pad2(booth.id), W / 2, H * 0.3);
  const fit = fitWrapped(ctx, name.toUpperCase(), W * 0.86, 2, Math.round(H * 0.1), Math.round(H * 0.06), 800);
  fit.lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.5 + i * fit.size * 1.1));
  return canvas;
}

function drawClusterSign(cl) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cl.color;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 56);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 72px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cl.id, 128, 68);
  return canvas;
}

/** Dashed ring as real geometry: one draw call per cluster, no texture. */
function dashedRingGeometry(radius, width, dashes) {
  const positions = [];
  const seg = 4;
  for (let d = 0; d < dashes; d++) {
    const a0 = (d / dashes) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2 / dashes) * 0.55;
    for (let s = 0; s < seg; s++) {
      const t0 = a0 + (a1 - a0) * (s / seg);
      const t1 = a0 + (a1 - a0) * ((s + 1) / seg);
      const ri = radius - width / 2, ro = radius + width / 2;
      const p = (r, t) => [Math.cos(t) * r, 0, Math.sin(t) * r];
      positions.push(...p(ri, t0), ...p(ro, t1), ...p(ro, t0));
      positions.push(...p(ri, t0), ...p(ri, t1), ...p(ro, t1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function loadArt(url, anisotropy) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Builds the live booth dressing. `attachTV(parent, localPos, booth, size)` is provided by
 * main.js so the TVs share its video pool and raycast list.
 */
export function createBoothClusters(scene, layout, booths, boothsData, { attachTV, lowPower = false } = {}) {
  const c = layout.clusters;
  const g = c.graphic;
  const ctr = c.counter;
  const group = new THREE.Group();
  group.name = 'BoothClusters_Live';
  scene.add(group);

  const panelW = g.r1 - g.r0;
  const panelH = g.y1 - g.y0;
  // ~350 px per metre on desktop keeps the 10 cm lettering crisp at arm's length without
  // putting 54 full-size canvases on the GPU; phones get about half that.
  const W = lowPower ? 192 : 320;
  const H = Math.round(W * panelH / panelW);
  const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
  const counterGeo = new THREE.PlaneGeometry(ctr.halfWidth * 2 - 0.04, ctr.height - 0.18);
  const aniso = lowPower ? 2 : 4;
  const disposables = [];

  for (const booth of Object.values(booths)) {
    const info = boothsData.find((b) => b.id === booth.id) || {};
    const art = Array.isArray(info.panelArt) ? info.panelArt : [];

    // The two panels bounding this bay, and on each the face that looks into the bay.
    const faces = [
      { ang: booth.bay + 60, which: 'A' },
      { ang: booth.bay - 60, which: 'B' },
    ];
    for (const f of faces) {
      const pd = dir(f.ang);
      // Normal of this face: perpendicular to the panel, pointing into the bay.
      let nx = -pd.z, nz = pd.x;
      if (nx * booth.dirX + nz * booth.dirZ < 0) { nx = -nx; nz = -nz; }
      const rMid = (g.r0 + g.r1) / 2;

      const map = art[f.which === 'A' ? 0 : 1]
        ? loadArt(art[f.which === 'A' ? 0 : 1], aniso)
        : makeTexture(drawPanel(booth, info, f.which, W, H, panelH), aniso);
      disposables.push(map);
      const mesh = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 }));
      mesh.position.set(
        booth.cx + pd.x * rMid + nx * g.offset,
        g.y0 + panelH / 2,
        booth.cz + pd.z * rMid + nz * g.offset,
      );
      mesh.rotation.y = Math.atan2(nx, nz);
      mesh.receiveShadow = true;
      mesh.name = `Booth_${pad2(booth.id)}_Panel${f.which}`;
      group.add(mesh);

      if (f.which === 'B' && attachTV) {
        const mount = new THREE.Group();
        mount.position.copy(mesh.position);
        mount.position.y = BOOTH_TV_Y;
        mount.rotation.y = mesh.rotation.y;
        group.add(mount);
        attachTV(mount, new THREE.Vector3(0, 0, 0.012), booth, { w: BOOTH_TV_W, h: BOOTH_TV_H });
      }
    }

    // Counter fascia on the outward face of the counter.
    const ctex = makeTexture(drawCounterFront(booth, info, lowPower ? 256 : 384, lowPower ? 256 : 384), aniso);
    disposables.push(ctex);
    const front = new THREE.Mesh(counterGeo, new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.4 }));
    front.position.set(
      booth.cx + booth.dirX * (ctr.r1 + 0.008),
      0.07 + (ctr.height - 0.1) / 2,
      booth.cz + booth.dirZ * (ctr.r1 + 0.008),
    );
    front.rotation.y = Math.atan2(booth.dirX, booth.dirZ);
    front.name = `Booth_${pad2(booth.id)}_Counter`;
    group.add(front);
  }

  // Cluster signs and floor rings.
  const ringGeo = dashedRingGeometry(c.ringRadius, 0.06, 28);
  for (const cl of c.list) {
    const tex = makeTexture(drawClusterSign(cl), aniso);
    disposables.push(tex);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sign.scale.set(0.9, 0.45, 1);
    sign.position.set(cl.x, c.panelHeight + 0.75, cl.z);
    sign.name = `ClusterSign_${cl.id}`;
    sign.userData.baseY = sign.position.y;
    group.add(sign);

    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: cl.color, transparent: true, opacity: 0.7, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    ring.position.set(cl.x, 0.012, cl.z);
    ring.renderOrder = -1;
    ring.name = `ClusterRing_${cl.id}`;
    group.add(ring);
  }

  return { group, dispose: () => disposables.forEach((t) => t.dispose()) };
}

/** World-space colliders for the clusters: one circle each, sized to the counters and stools. */
export function clusterObstacles(layout) {
  return layout.clusters.list.map((cl) => ({ x: cl.x, z: cl.z, r: layout.clusters.collisionRadius }));
}
