/**
 * Organizer booths (TdH · KNH · VEWU) for the Pre-Function Foyer.
 *
 * The venue GLB ships three organizer stands *outside* the foyer's east wall (BackdropPanel_3,
 * black-cloth tables, Panel_4 banner stands) where nobody can see them, plus eight snack tables
 * inside. main.js hides the snack tables and we rebuild the three stands here, procedurally, so
 * they can be branded per organizer from `src/data/organizers.json` without touching Blender.
 *
 * Local booth space: the panel is centred on the origin, spans X, and its graphic faces +Z.
 * main.js rotates the group so +Z points into the foyer aisle.
 */
import * as THREE from 'three';

export const PANEL_W = 2.4;
export const PANEL_H = 2.3;
export const PANEL_BOTTOM = 0.05;
export const TV_CENTER_Y = 1.45;
export const TV_W = 1.3;
export const TV_H = TV_W * 9 / 16;

const PX_PER_M = 1024 / PANEL_W;

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex, factor) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * factor))));
  return `rgb(${r}, ${g}, ${b})`;
}

function wrapLines(ctx, text, maxWidth, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Brand palette for an organizer (from organizers.json):
 *  - color:  primary brand colour (logo colour) — table cloth, emblem, minimap, modal badge
 *  - bg:     backdrop base (Tdh prints black with an orange logo, so bg ≠ color there)
 *  - accent: highlight used on top of bg (kicker, bullets, rail, footer strip)
 *  - ink:    dark text colour used on top of the accent
 */
export function palette(org) {
  return {
    color: org.color || '#4FA69C',
    bg: org.bg || org.color || '#16223D',
    accent: org.accent || '#F4B400',
    ink: org.ink || '#16223D',
  };
}

/** Big backdrop graphic. Leaves a dark well where the TV is mounted. */
export function createBackdropTexture(org) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round(PANEL_H * PX_PER_M);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const yOf = (worldY) => (PANEL_BOTTOM + PANEL_H - worldY) * PX_PER_M;
  const { color, bg, accent, ink } = palette(org);

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, shade(bg, 1.12));
  grad.addColorStop(0.55, bg);
  grad.addColorStop(1, shade(bg, 0.6));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Soft diagonal texture
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 18;
  for (let i = -H; i < W + H; i += 70) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - H, H);
    ctx.stroke();
  }

  // Brand colour block behind the header (visible when bg ≠ color, e.g. Tdh)
  if (bg.toLowerCase() !== color.toLowerCase()) {
    ctx.fillStyle = color;
    ctx.fillRect(0, yOf(1.85) - 8, W, 8);
  }

  // Header band
  ctx.fillStyle = 'rgba(8, 12, 24, 0.45)';
  ctx.fillRect(0, 0, W, yOf(1.85) - 8);
  ctx.fillStyle = accent;
  ctx.font = 'bold 30px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((org.kicker || 'ORGANIZER BOOTH').toUpperCase(), 48, 56);

  // Logo-style lock-up: short name in the brand colour on a rounded tile, full name beside it
  const shortText = org.short || org.name;
  ctx.font = '800 108px "Outfit", "Plus Jakarta Sans", sans-serif';
  const shortW = ctx.measureText(shortText).width;
  ctx.fillStyle = bg.toLowerCase() === color.toLowerCase() ? '#ffffff' : color;
  ctx.beginPath();
  ctx.roundRect(40, 74, shortW + 48, 118, 22);
  ctx.fill();
  ctx.fillStyle = bg.toLowerCase() === color.toLowerCase() ? color : '#ffffff';
  ctx.fillText(shortText, 64, 172);

  ctx.fillStyle = '#ffffff';
  ctx.font = '600 38px "Plus Jakarta Sans", "Outfit", sans-serif';
  const nameLines = wrapLines(ctx, org.name, W - shortW - 150, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, shortW + 116, 128 + i * 46));

  // TV well (the physical TV mesh covers it; this is what shows through the bezel gap)
  const tvX = (PANEL_W / 2 - TV_W / 2) * PX_PER_M;
  const tvW = TV_W * PX_PER_M;
  const tvTop = yOf(TV_CENTER_Y + TV_H / 2);
  const tvH = TV_H * PX_PER_M;
  ctx.fillStyle = '#05070d';
  ctx.beginPath();
  ctx.roundRect(tvX - 14, tvTop - 14, tvW + 28, tvH + 28, 18);
  ctx.fill();

  // Tagline
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'italic 600 40px "Plus Jakarta Sans", "Outfit", sans-serif';
  const tagLines = wrapLines(ctx, org.tagline || '', W - 120, 2);
  tagLines.forEach((line, i) => ctx.fillText(line, W / 2, yOf(0.98) + i * 46));
  ctx.textAlign = 'left';

  // Bullets
  ctx.font = '600 32px "Plus Jakarta Sans", "Outfit", sans-serif';
  (org.bullets || []).slice(0, 3).forEach((b, i) => {
    const y = yOf(0.72 - i * 0.18);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(76, y - 11, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(b, 104, y);
  });

  // Watermark
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 220px "Outfit", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(shortText, W - 24, yOf(0.3));
  ctx.restore();

  // Footer strip
  ctx.fillStyle = accent;
  ctx.fillRect(0, yOf(0.2), W, H - yOf(0.2));
  ctx.fillStyle = ink;
  ctx.font = 'bold 26px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('YOUTH INNOVATIONS MARKETPLACE  •  GMC 2026  •  MARRIOTT MANILA', W / 2, yOf(0.2) + 44);

  return makeTexture(canvas);
}

/** Roll-up banner beside the stand. */
export function createBannerTexture(org) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1296;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const { color, bg, accent, ink } = palette(org);

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(bg, 0.7));
  grad.addColorStop(0.4, bg);
  grad.addColorStop(1, shade(bg, 1.15));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Emblem: brand colour disc with the short name, accent ring
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(W / 2, 200, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${org.short && org.short.length > 3 ? 84 : 104}px "Outfit", sans-serif`;
  ctx.fillText(org.short || '', W / 2, 204);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = 'bold 30px "Outfit", sans-serif';
  ctx.fillText('ORGANIZER', W / 2, 400);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px "Plus Jakarta Sans", "Outfit", sans-serif';
  wrapLines(ctx, org.name, W - 80, 3).forEach((line, i) => ctx.fillText(line, W / 2, 470 + i * 56));

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'italic 32px "Plus Jakarta Sans", sans-serif';
  wrapLines(ctx, org.tagline || '', W - 90, 3).forEach((line, i) => ctx.fillText(line, W / 2, 680 + i * 40));

  ctx.textAlign = 'left';
  ctx.font = '600 30px "Plus Jakarta Sans", sans-serif';
  (org.bullets || []).slice(0, 3).forEach((b, i) => {
    const y = 860 + i * 74;
    ctx.fillStyle = accent;
    ctx.fillRect(60, y - 26, 14, 30);
    ctx.fillStyle = '#ffffff';
    wrapLines(ctx, b, W - 150, 1).forEach((line) => ctx.fillText(line, 96, y));
  });

  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 90, W, 90);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px "Outfit", sans-serif';
  ctx.fillText('GMC 2026  •  NOV 17–18', W / 2, H - 36);

  return makeTexture(canvas);
}

function createCounterSignTexture(org) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const { color, accent, ink } = palette(org);
  ctx.fillStyle = '#F1F0EC';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 320, 28);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 70);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(org.short || org.name, 256, 48);
  ctx.fillStyle = ink;
  ctx.font = '800 64px "Outfit", sans-serif';
  ctx.fillText('ASK US', 256, 170);
  ctx.font = '600 30px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#2E4570';
  ctx.fillText('Passport · Programme · Partners', 256, 230);
  ctx.fillStyle = accent;
  ctx.fillRect(120, 262, 272, 10);
  return makeTexture(canvas);
}

/**
 * Builds one organizer stand. `attachTV(parent, localPos)` is supplied by main.js so all TVs in
 * the hall share the same video element and click handling.
 */
export function buildOrganizerBooth(org, { attachTV, castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = `Organizer_${org.id}`;

  const pal = palette(org);
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b28, roughness: 0.55, metalness: 0.35 });
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(pal.color, 0.8)), roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.accent),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });

  // Floor mat marks the stand footprint (also reads well on the minimap-less mobile view)
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2.9),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(pal.color, 0.6)), roughness: 1, transparent: true, opacity: 0.55 })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.012, 0.7);
  mat.receiveShadow = true;
  group.add(mat);

  // Frame + backdrop panel
  const frame = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W + 0.12, PANEL_H + 0.12, 0.06), dark);
  frame.position.set(0, PANEL_BOTTOM + PANEL_H / 2, -0.05);
  frame.castShadow = castShadow;
  frame.receiveShadow = true;
  frame.name = 'panel';
  group.add(frame);

  const backdropTex = createBackdropTexture(org);
  const graphic = new THREE.MeshStandardMaterial({
    map: backdropTex,
    emissive: 0xffffff,
    emissiveMap: backdropTex,
    emissiveIntensity: 0.32,
    roughness: 0.65,
  });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.08), [dark, dark, dark, dark, graphic, dark]);
  panel.position.set(0, PANEL_BOTTOM + PANEL_H / 2, 0);
  panel.castShadow = castShadow;
  panel.receiveShadow = true;
  group.add(panel);

  // Lit top rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W + 0.16, 0.1, 0.16), accent);
  rail.position.set(0, PANEL_BOTTOM + PANEL_H + 0.06, 0.02);
  group.add(rail);

  // Feet
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.6), dark);
    foot.position.set(sx * (PANEL_W / 2 - 0.1), 0.025, 0.05);
    group.add(foot);
  }

  // TV (shared video, click-to-pop-up) mounted on the panel
  if (attachTV) attachTV(group, new THREE.Vector3(0, TV_CENTER_Y, 0.04 + 0.035));

  // Draped counter table
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.74, 0.62), cloth);
  table.position.set(0, 0.37, 1.0);
  table.castShadow = castShadow;
  table.receiveShadow = true;
  table.name = 'table';
  group.add(table);

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.04, 0.68), dark);
  top.position.set(0, 0.76, 1.0);
  top.receiveShadow = true;
  group.add(top);

  const skirtBand = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 0.64), accent);
  skirtBand.position.set(0, 0.7, 1.0);
  group.add(skirtBand);

  // Counter sign
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.275),
    new THREE.MeshStandardMaterial({ map: createCounterSignTexture(org), roughness: 0.7, side: THREE.DoubleSide })
  );
  sign.position.set(0.45, 0.905, 1.12);
  sign.rotation.x = -0.32;
  group.add(sign);

  // Leaflet stacks
  const paper = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.9 });
  for (let i = 0; i < 2; i++) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.3), paper);
    stack.position.set(-0.5 + i * 0.28, 0.795, 1.02);
    stack.rotation.y = (i - 0.5) * 0.25;
    group.add(stack);
  }

  // Roll-up banner on the south side of the stand
  const bannerTex = createBannerTexture(org);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 1.9),
    new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.22, roughness: 0.75, side: THREE.DoubleSide })
  );
  banner.position.set(PANEL_W / 2 + 0.5, 1.05, 0.3);
  banner.rotation.y = -0.18;
  group.add(banner);

  const bannerBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.3), dark);
  bannerBase.position.set(PANEL_W / 2 + 0.5, 0.025, 0.3);
  bannerBase.rotation.y = -0.18;
  bannerBase.name = 'bannerBase';
  group.add(bannerBase);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.0, 8), dark);
  pole.position.set(PANEL_W / 2 + 0.5 + 0.02, 1.0, 0.3 - 0.13);
  group.add(pole);

  // Collision: panel + table are one solid (the staff gap between them is narrower than a
  // visitor, so treating it as open space would only invite tunnelling); banner base is its own.
  return { group, solids: [[frame, table], [bannerBase]] };
}

/**
 * World-space AABBs for the solid parts, used by the player collision. Each entry in `solids`
 * is a list of meshes merged into one box.
 */
export function organizerObstacles(group, solids, pad = 0.05) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  return solids.map((meshes) => {
    box.makeEmpty();
    for (const mesh of meshes) box.union(part.setFromObject(mesh));
    return { minX: box.min.x - pad, maxX: box.max.x + pad, minZ: box.min.z - pad, maxZ: box.max.z + pad };
  });
}
