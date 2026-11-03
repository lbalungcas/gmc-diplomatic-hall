/**
 * Printed faces for the hall and foyer signage of the October 19 layout.
 *
 * scripts/venue_set.py bakes the hardware — sign stands, the partners wall board, the event arch
 * header box, the curved photo wall shell and the photo booth header — from src/data/hallLayout.json.
 * This module prints on them, from the same numbers, so wording can change without a Blender
 * rebuild. Every face is a plane offset a few millimetres in front of the baked board.
 */
import * as THREE from 'three';

const NAVY = '#1B2D5C';
const CYAN = '#1FA9E1';
const AMBER = '#F6B91A';
const FONT = 'system-ui, "Segoe UI", sans-serif';

function texture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function canvasFor(wM, hM, pxPerM) {
  const c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(wM * pxPerM));
  c.height = Math.max(64, Math.round(hM * pxPerM));
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

/** Title + subtitle sign, landscape or portrait. */
function drawSign(canvas, { title, sub, accent = CYAN, kicker = 'YOUTH INNOVATIONS MARKETPLACE' }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const portrait = H > W * 1.2;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, Math.round(H * (portrait ? 0.035 : 0.08)));
  ctx.fillRect(0, H - Math.round(H * (portrait ? 0.035 : 0.08)), W, Math.round(H * (portrait ? 0.035 : 0.08)));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  fitFont(ctx, kicker, W * 0.86, Math.round(Math.min(W, H) * 0.075), 800);
  ctx.fillText(kicker, W / 2, H * (portrait ? 0.1 : 0.2));

  // Title may wrap onto two lines in a portrait banner.
  ctx.fillStyle = '#FFFFFF';
  const words = title.split(' ');
  const lines = portrait && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [title];
  const size = Math.min(...lines.map((l) => fitFont(ctx, l, W * 0.88, Math.round((portrait ? W * 0.2 : H * 0.3)))));
  ctx.font = `900 ${size}px ${FONT}`;
  const y0 = portrait ? H * 0.3 : H * 0.48;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * size * 1.05));

  if (sub) {
    ctx.fillStyle = accent;
    const subLines = portrait ? sub.split(' · ') : [sub];
    const ss = Math.min(...subLines.map((l) => fitFont(ctx, l, W * 0.86, Math.round(portrait ? W * 0.085 : H * 0.11), 700)));
    ctx.font = `700 ${ss}px ${FONT}`;
    const sy = portrait ? H * 0.58 : H * 0.76;
    subLines.forEach((l, i) => ctx.fillText(l, W / 2, sy + i * ss * 1.5));
  }
}

/** Wording for each sign id in hallLayout.json `signs`. */
const SIGN_COPY = {
  dealCorner: { title: 'DEAL CORNER', sub: 'Meet innovators · match with partners', accent: AMBER },
  boothEntrance: { title: 'INNOVATION BOOTHS', sub: '24 youth-led booths · Rows A–D', accent: CYAN },
  registration: { title: 'REGISTRATION', sub: 'Collect your badge · Expo Passport · Info', accent: AMBER },
  mediaHub: { title: 'YOUTH MEDIA HUB', sub: 'Interviews · Photo wall · Share your story', accent: '#EC2F7B' },
  safeguarding: { title: 'SAFEGUARDING AREA', sub: 'A safe space to talk · Ask a focal person or Tutu', accent: '#4CB848' },
};

/** A double-sided printed face on a baked stand: front plane and its mirror on the back. */
function addFaces(group, geo, mat, x, y, z, yaw, depth) {
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + Math.sin(yaw) * depth * side, y, z + Math.cos(yaw) * depth * side);
    m.rotation.y = yaw + (side < 0 ? Math.PI : 0);
    group.add(m);
  }
}

/** Curved strip along an arc (three.js x/z), outward-facing, UVs running along the arc. */
function arcGeometry(cx, cz, r, a0, a1, y0, y1, seg = 48) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    // Run the angle backwards so the print reads left-to-right from the convex side.
    const a = (a1 - (a1 - a0) * t) * Math.PI / 180;
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

/** One tile of the photo wall's step-and-repeat, repeated along the curve. */
function drawPhotoWallTile(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  const cols = 2, rows = 4;
  const accents = [CYAN, '#EC2F7B', AMBER, '#4CB848'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + (r % 2 ? 0.5 : 0) + 0.25) * (W / cols);
      const y = (r + 0.5) * (H / rows);
      for (const dx of [-W, 0, W]) {
        ctx.fillStyle = accents[(r + c) % accents.length];
        ctx.beginPath();
        ctx.arc(x + dx, y - H * 0.03, H * 0.045, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = NAVY;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(H * 0.04)}px ${FONT}`;
        ctx.fillText('YOUTH MEDIA HUB', x + dx, y + H * 0.045);
        ctx.font = `700 ${Math.round(H * 0.026)}px ${FONT}`;
        ctx.fillStyle = 'rgba(27,45,92,0.7)';
        ctx.fillText('#YouthInnovations · GMC 2026', x + dx, y + H * 0.08);
      }
    }
  }
}

export function createVenueSignage(scene, layout, { anisotropy = 4, lowPower = false } = {}) {
  const group = new THREE.Group();
  group.name = 'VenueSignage_Live';
  scene.add(group);
  const ppm = lowPower ? 200 : 360;
  const disposables = [];
  const mat = (canvas, extra = {}) => {
    const tex = texture(canvas, anisotropy);
    disposables.push(tex);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, ...extra });
  };

  // Free-standing signs.
  for (const s of layout.signs) {
    const copy = SIGN_COPY[s.id];
    if (!copy) continue;
    const c = canvasFor(s.w, s.h, ppm);
    drawSign(c, copy);
    addFaces(group, new THREE.PlaneGeometry(s.w, s.h), mat(c), s.x, s.bottom + s.h / 2, s.z, s.yaw, 0.024);
  }

  const F = layout.foyer;

  // Event arch header, both faces.
  const ea = F.eventArch;
  const archW = Math.abs(ea.z1 - ea.z0) + 0.36;
  const ac = canvasFor(archW, 0.96, lowPower ? 120 : 200);
  drawSign(ac, { title: 'YOUTH INNOVATIONS MARKETPLACE', sub: 'Booths this way · Rows A–D', accent: AMBER, kicker: 'GMC 2026 · MANILA' });
  addFaces(group, new THREE.PlaneGeometry(archW, 0.96), mat(ac), ea.x, ea.height - 0.5, (ea.z0 + ea.z1) / 2, Math.PI / 2, 0.154);

  // Partners photo wall.
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
    if (img) {
      const maxW = pc.width * 0.9, maxH = pc.height * 0.7;
      const k = Math.min(maxW / img.width, maxH / img.height);
      pctx.drawImage(img, (pc.width - img.width * k) / 2, pc.height * 0.2 + (maxH - img.height * k) / 2, img.width * k, img.height * k);
    }
    pctx.fillStyle = CYAN;
    pctx.fillRect(0, pc.height * 0.95, pc.width, pc.height * 0.05);
  };
  paintPartners(null);
  const partnersMat = mat(pc);
  const partners = new THREE.Mesh(new THREE.PlaneGeometry(pw.width, pw.height), partnersMat);
  partners.position.set(pw.x + Math.sin(pw.yaw) * 0.034, pw.bottom + pw.height / 2, pw.z + Math.cos(pw.yaw) * 0.034);
  partners.rotation.y = pw.yaw;
  group.add(partners);
  if (pw.image) {
    const img = new Image();
    img.onload = () => { paintPartners(img); partnersMat.map.needsUpdate = true; };
    img.src = pw.image;
  }

  // Curved photo wall: a repeating print along the convex side.
  const ph = F.photoWall;
  const arcLen = ph.r * (ph.a1 - ph.a0) * Math.PI / 180;
  const tileH = ph.height - 0.06;
  const tile = canvasFor(tileH, tileH, lowPower ? 160 : 300);
  drawPhotoWallTile(tile);
  const tileTex = texture(tile, anisotropy);
  tileTex.wrapS = THREE.RepeatWrapping;
  tileTex.repeat.set(arcLen / tileH, 1);
  disposables.push(tileTex);
  group.add(new THREE.Mesh(
    arcGeometry(ph.cx, ph.cz, ph.r + 0.004, ph.a0, ph.a1, 0.06, ph.height),
    new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.6 }),
  ));

  // Photo booth header, on the front of the kiosk (it faces north into the hall).
  const pb = layout.hallFeatures.photoBooth;
  const hw = pb.width - 0.9;
  const hc = canvasFor(hw, 0.42, ppm);
  drawSign(hc, { title: 'PHOTO BOOTH', sub: 'by EDUCO · strike a pose', accent: '#EC2F7B', kicker: 'YOUTH INNOVATIONS MARKETPLACE' });
  const header = new THREE.Mesh(new THREE.PlaneGeometry(hw, 0.42), mat(hc));
  header.position.set(pb.x, pb.height - 0.21, pb.z - pb.depth / 2 - 0.004);
  header.rotation.y = Math.PI;
  group.add(header);

  return { group, dispose: () => disposables.forEach((t) => t.dispose()) };
}
