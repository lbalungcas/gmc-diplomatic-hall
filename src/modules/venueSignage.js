/**
 * Printed faces for the venue signage, from the client's venue designs.
 *
 * scripts/venue_set.py bakes the hardware — standee boards and stands, the partners wall board,
 * the event arch's navy returns, the curved photo wall shell, the stage banner frames and the
 * photo booth header — from src/data/hallLayout.json. This module lays the artwork on them from
 * the same numbers, a few millimetres in front of each baked face:
 *
 *  - area standees: the YIM Venue Signages (public/venue/signs), both faces
 *  - the event arch: the arch design, alpha-cut so you walk through its opening, both faces
 *  - the stage banners either side of the LED wall
 *  - the partners wall (partner lockup)
 *  - the curved wall: a step-and-repeat photo wall on its convex (deal corner) side and the
 *    Youth Media Hub backdrop on its concave side, in the media hub standee's pink grid
 *  - the photo booth header in the hall
 */
import * as THREE from 'three';

const NAVY = '#1C3462';
const PINK = '#D35BA5';
const YELLOW = '#F0C66B';
const FONT = 'system-ui, "Segoe UI", sans-serif';
const YIM_LOGO = '/landing/assets/web/logo-navbar.png';
const PARTNER_LOGOS = '/venue/logos.webp';

function texture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function imageTexture(url, anisotropy) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

const images = new Map();
function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return images.get(url);
}

function canvasFor(wM, hM, pxPerM, max = 4096) {
  const c = document.createElement('canvas');
  const k = Math.min(1, max / Math.max(wM * pxPerM, hM * pxPerM));
  c.width = Math.max(64, Math.round(wM * pxPerM * k));
  c.height = Math.max(64, Math.round(hM * pxPerM * k));
  return c;
}

function fitFont(ctx, text, maxW, size, weight = 900) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 10);
  return s;
}

/** Draws `img` contained in the box (x, y, w, h), centred. */
function drawContained(ctx, img, x, y, w, h) {
  const k = Math.min(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * k) / 2, y + (h - img.height * k) / 2, img.width * k, img.height * k);
}

/** A double-sided print on a baked board: front plane and its mirror on the back. */
function addFaces(group, geo, mat, x, y, z, yaw, depth) {
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + Math.sin(yaw) * depth * side, y, z + Math.cos(yaw) * depth * side);
    m.rotation.y = yaw + (side < 0 ? Math.PI : 0);
    group.add(m);
  }
}

/**
 * Curved strip along an arc (three.js x/z). `outward` faces away from the centre with the angle
 * run backwards; otherwise it faces the centre with the angle run forwards. Either way u runs
 * left-to-right for someone looking at that face.
 */
function arcGeometry(cx, cz, r, a0, a1, y0, y1, outward, seg = 64) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const deg = outward ? a1 - (a1 - a0) * t : a0 + (a1 - a0) * t;
    const a = deg * Math.PI / 180;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    pos.push(x, y0, z, x, y1, z);
    uv.push(t, 0, t, 1);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Step-and-repeat tile for the photo wall: the YIM logo and the partner strip, staggered. */
function drawStepRepeat(canvas, yim, partners) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  const rows = 3;
  const rh = H / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const cells = [[0, r % 2 ? partners : yim], [W / 2, r % 2 ? yim : partners]];
    for (const [x, img] of cells) {
      if (!img) continue;
      drawContained(ctx, img, x + W * 0.04, y + rh * 0.14, W / 2 - W * 0.08, rh * 0.72);
    }
  }
}

/**
 * The Youth Media Hub backdrop, after the media hub standee: pink grid, a white panel with the
 * title behind the interview chairs, the YIM logo and the partner strip either side, and YIM
 * logos repeated out toward the ends of the wall. `centreU` is where the hub sits along it.
 */
function drawMediaHub(canvas, lengthM, centreU, yim, partners) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const ppm = W / lengthM;
  ctx.fillStyle = PINK;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(2, ppm * 0.02);
  const cell = ppm * 0.32;
  for (let x = cell / 2; x < W; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = cell / 2; y < H; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const cx = centreU * W;
  // Title panel, high enough to clear the armchairs' backs.
  const pw = ppm * 3.6, ph = H * 0.42, py = H * 0.12;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(cx - pw / 2, py, pw, ph, ppm * 0.06);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const s = fitFont(ctx, 'YOUTH MEDIA HUB', pw * 0.88, Math.round(ph * 0.5));
  ctx.font = `900 ${s}px ${FONT}`;
  ctx.fillText('YOUTH MEDIA HUB', cx, py + ph * 0.42);
  ctx.fillStyle = NAVY;
  const s2 = fitFont(ctx, 'Interviews · Stories · Share your innovation', pw * 0.8, Math.round(ph * 0.14), 700);
  ctx.font = `700 ${s2}px ${FONT}`;
  ctx.fillText('Interviews · Stories · Share your innovation', cx, py + ph * 0.8);

  // Logos either side of the panel, then YIM logos every ~3.2 m outward.
  if (partners) {
    const bw = ppm * 2.6, bh = H * 0.36;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(cx + pw / 2 + ppm * 0.4, py + ph * 0.1, bw, bh, ppm * 0.05);
    ctx.fill();
    drawContained(ctx, partners, cx + pw / 2 + ppm * 0.5, py + ph * 0.1 + bh * 0.06, bw - ppm * 0.2, bh * 0.88);
  }
  if (yim) {
    drawContained(ctx, yim, cx - pw / 2 - ppm * 3.0, py, ppm * 2.6, ph);
    // Further out: left of the first logo, and right of the partner board.
    for (let k = 1; k < 8; k++) {
      const xl = cx - pw / 2 - ppm * (3.0 + 3.2 * k);
      const xr = cx + pw / 2 + ppm * (3.6 + 3.2 * (k - 1));
      for (const x of [xl, xr]) {
        if (x < -ppm * 2.6 || x > W) continue;
        drawContained(ctx, yim, x, py, ppm * 2.6, ph);
      }
    }
  }
  // White foot strip, as on the standee.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, H * 0.93, W, H * 0.07);
}

/** Header for the photo booth kiosk. */
function drawHeader(canvas, title, sub) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = YELLOW;
  ctx.fillRect(0, H * 0.9, W, H * 0.1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  fitFont(ctx, title, W * 0.8, Math.round(H * 0.46));
  ctx.fillText(title, W / 2, H * 0.38);
  ctx.fillStyle = YELLOW;
  fitFont(ctx, sub, W * 0.8, Math.round(H * 0.2), 700);
  ctx.fillText(sub, W / 2, H * 0.72);
}

export function createVenueSignage(scene, layout, { anisotropy = 4, lowPower = false } = {}) {
  const group = new THREE.Group();
  group.name = 'VenueSignage_Live';
  scene.add(group);
  const disposables = [];
  const keep = (t) => { disposables.push(t); return t; };
  const printMat = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0, ...extra });
  const yimP = loadImage(YIM_LOGO);
  const partnersP = loadImage(PARTNER_LOGOS);

  // Area standees: the venue signage designs, on both faces of the foam board.
  for (const s of layout.signs) {
    if (!s.image) continue;
    const mat = printMat(keep(imageTexture(s.image, anisotropy)), { roughness: 0.5 });
    addFaces(group, new THREE.PlaneGeometry(s.w, s.h), mat, s.x, s.bottom + s.h / 2, s.z, s.yaw, 0.0135);
  }

  const F = layout.foyer;

  // Event arch: front (facing the lobby, +x) and back, alpha-cut through the opening.
  const ea = F.eventArch;
  if (ea.image) {
    const archMat = printMat(keep(imageTexture(ea.image, anisotropy)), { alphaTest: 0.5, roughness: 0.55 });
    const geo = new THREE.PlaneGeometry(ea.z1 - ea.z0, ea.height);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(geo, archMat);
      // The back shows the same art read from the hall, so its pillars swap sides; the two
      // pillars differ in width, so shift it to keep its cut-out over the real opening.
      const shift = side > 0 ? 0 : (ea.pillarNorth || 0) - (ea.pillarSouth || 0);
      m.position.set(ea.x + side * (ea.depth / 2 + 0.002), ea.height / 2, ea.zc + shift);
      m.rotation.y = side * Math.PI / 2;
      m.name = side > 0 ? 'EventArch_Front' : 'EventArch_Back';
      group.add(m);
    }
  }

  // Stage banners either side of the LED wall.
  const led = layout.led;
  const sb = layout.stageBanners;
  if (sb && sb.image) {
    const mat = printMat(keep(imageTexture(sb.image, anisotropy)), { emissive: 0xffffff, emissiveIntensity: 0.08 });
    mat.emissiveMap = mat.map;
    const geo = new THREE.PlaneGeometry(sb.width, sb.height);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(led.cx + s * (led.width / 2 + sb.gap + sb.width / 2), sb.bottom + sb.height / 2, led.z - 0.006);
      m.name = `StageBanner_${s < 0 ? 'W' : 'E'}`;
      group.add(m);
    }
  }

  // Partners wall.
  const pw = F.partnersWall;
  const pc = canvasFor(pw.width, pw.height, lowPower ? 140 : 256);
  const pctx = pc.getContext('2d');
  const paintPartners = (img) => {
    pctx.fillStyle = '#FFFFFF';
    pctx.fillRect(0, 0, pc.width, pc.height);
    pctx.fillStyle = NAVY;
    pctx.fillRect(0, 0, pc.width, pc.height * 0.16);
    pctx.fillStyle = '#FFFFFF';
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    fitFont(pctx, 'OUR PARTNERS', pc.width * 0.8, Math.round(pc.height * 0.09));
    pctx.fillText('OUR PARTNERS', pc.width / 2, pc.height * 0.08);
    if (img) drawContained(pctx, img, pc.width * 0.05, pc.height * 0.2, pc.width * 0.9, pc.height * 0.7);
    pctx.fillStyle = YELLOW;
    pctx.fillRect(0, pc.height * 0.95, pc.width, pc.height * 0.05);
  };
  paintPartners(null);
  const partnersMat = printMat(keep(texture(pc, anisotropy)));
  const partners = new THREE.Mesh(new THREE.PlaneGeometry(pw.width, pw.height), partnersMat);
  partners.position.set(pw.x + Math.sin(pw.yaw) * 0.034, pw.bottom + pw.height / 2, pw.z + Math.cos(pw.yaw) * 0.034);
  partners.rotation.y = pw.yaw;
  group.add(partners);
  if (pw.image) loadImage(pw.image).then((img) => { if (img) { paintPartners(img); partnersMat.map.needsUpdate = true; } });

  // Curved wall: photo-wall step-and-repeat outside, Youth Media Hub backdrop inside.
  const ph = F.photoWall;
  const arcLen = ph.r * (ph.a1 - ph.a0) * Math.PI / 180;
  const y0 = 0.06, y1 = ph.height;
  const tileH = y1 - y0;
  const tile = canvasFor(tileH * 1.6, tileH, lowPower ? 160 : 320);
  drawStepRepeat(tile, null, null);
  const tileTex = keep(texture(tile, anisotropy));
  tileTex.wrapS = THREE.RepeatWrapping;
  tileTex.repeat.set(arcLen / (tileH * 1.6), 1);
  Promise.all([yimP, partnersP]).then(([yim, prt]) => { drawStepRepeat(tile, yim, prt); tileTex.needsUpdate = true; });
  const outer = new THREE.Mesh(arcGeometry(ph.cx, ph.cz, ph.r + 0.004, ph.a0, ph.a1, y0, y1, true), printMat(tileTex));
  outer.name = 'PhotoWall_Print';
  group.add(outer);

  const innerR = ph.r - 0.064;
  const innerLen = innerR * (ph.a1 - ph.a0) * Math.PI / 180;
  const mh = F.mediaHub;
  const hubDeg = Math.atan2(mh.z - ph.cz, mh.x - ph.cx) * 180 / Math.PI;
  const hubA = ((hubDeg % 360) + 360) % 360;
  const centreU = Math.min(0.9, Math.max(0.1, (hubA - ph.a0) / (ph.a1 - ph.a0)));
  const hc = canvasFor(innerLen, tileH, lowPower ? 90 : 180);
  drawMediaHub(hc, innerLen, centreU, null, null);
  const hubTex = keep(texture(hc, anisotropy));
  Promise.all([yimP, partnersP]).then(([yim, prt]) => { drawMediaHub(hc, innerLen, centreU, yim, prt); hubTex.needsUpdate = true; });
  const inner = new THREE.Mesh(arcGeometry(ph.cx, ph.cz, innerR, ph.a0, ph.a1, y0, y1, false), printMat(hubTex));
  inner.name = 'MediaHub_Print';
  group.add(inner);

  // Photo booth header, on the front of the kiosk (it faces north into the hall).
  const pb = layout.hallFeatures.photoBooth;
  const hw = pb.width - 0.9;
  const hcv = canvasFor(hw, 0.42, lowPower ? 200 : 360);
  drawHeader(hcv, 'PHOTO BOOTH', 'Strike a pose · share your story');
  const header = new THREE.Mesh(new THREE.PlaneGeometry(hw, 0.42), printMat(keep(texture(hcv, anisotropy))));
  header.position.set(pb.x, pb.height - 0.21, pb.z - pb.depth / 2 - 0.004);
  header.rotation.y = Math.PI;
  group.add(header);

  return { group, dispose: () => disposables.forEach((t) => t.dispose()) };
}
