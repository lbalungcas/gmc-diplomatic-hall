/**
 * Organizer booths (TdH · KNH · VEWU) along the lobby's Executive 3 wall.
 *
 * The three stands are built here, at runtime, so they can be branded per organizer from
 * `src/data/organizers.json` without touching Blender.
 *
 * Each stand follows the organizer booth design: a curved pop-up fabric backwall with two arm
 * spotlights, a counter and a roll-up banner. With the organizer's own prints (the `art` option,
 * from src/data/organizerArt.json) the stand carries them: see "Art mode" below. Without, it is
 * drawn from the organizer's palette, with an oval counter, a TV and a zig-zag brochure rack.
 *
 * Local booth space: the backwall is centred on the origin, spans X, and its graphic faces +Z.
 * main.js rotates the group so +Z points into the foyer aisle.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const PANEL_H = 2.3;
export const PANEL_BOTTOM = 0.05;
export const TV_W = 1.3;
export const TV_H = TV_W * 9 / 16;

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
 *  - bg:     backdrop base (set separately where a brand prints on a different base)
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

// ---------------------------------------------------------------------------------------------
// Pop-up stand geometry (after the organizer booth design: a curved fabric backwall with two
// arm spots, an oval pop-up counter, a roll-up banner and a brochure rack).
//
// The backwall is an arc: chord WALL_CHORD wide, bowed back by WALL_SAG at the middle, so its
// ends sit at z = 0 and its centre at z = -WALL_SAG. Visitors stand on the +Z side.
// ---------------------------------------------------------------------------------------------
const WALL_CHORD = 2.6;
const WALL_SAG = 0.3;
const WALL_R = (WALL_CHORD * WALL_CHORD / 4 + WALL_SAG * WALL_SAG) / (2 * WALL_SAG);
const WALL_HALF = Math.asin(WALL_CHORD / 2 / WALL_R);   // half the arc angle
const WALL_CZ = WALL_R - WALL_SAG;                      // arc centre z
const WALL_PX_PER_M = 500;

/** Point on the backwall arc for a local x (front face). */
function wallZ(x) {
  return WALL_CZ - Math.sqrt(WALL_R * WALL_R - x * x);
}

/** Canvas u (0 = left as seen by a visitor) for a local x on the arc. */
function wallU(x) {
  return (Math.asin(x / WALL_R) + WALL_HALF) / (2 * WALL_HALF);
}

// The organizer TV sits in the lower-left of the wall, where the design has its big photo.
const TV_X0 = -1.2;
const TV_X1 = TV_X0 + TV_W;
const TV_Y = PANEL_BOTTOM + 0.98;
const SPLIT_Y = PANEL_BOTTOM + 1.42;   // top band (logo) above, TV + message panel below

/** Big curved backdrop graphic, with rounded top corners cut out of the alpha. */
export function createBackdropTexture(org) {
  const W = Math.round(WALL_R * 2 * WALL_HALF * WALL_PX_PER_M);   // arc length in px
  const H = Math.round(PANEL_H * WALL_PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const yOf = (worldY) => (PANEL_BOTTOM + PANEL_H - worldY) * WALL_PX_PER_M;
  const xOf = (localX) => wallU(localX) * W;
  const { color, bg, accent, ink } = palette(org);

  // Rounded-top silhouette, like a pop-up frame's fabric sock.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, [90, 90, 10, 10]);
  ctx.clip();

  // Top band: brand background with a soft glow and the logo lock-up.
  const top = yOf(SPLIT_Y);
  const g = ctx.createLinearGradient(0, 0, 0, top);
  g.addColorStop(0, shade(bg, 1.25));
  g.addColorStop(1, shade(bg, 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, top);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(W * (0.1 + i * 0.17), top * (0.2 + (i % 2) * 0.5), 60 + (i % 3) * 30, 0, Math.PI * 2);
    ctx.fill();
  }

  const shortText = org.short || org.name;
  ctx.font = '800 150px "Outfit", "Plus Jakarta Sans", sans-serif';
  const shortW = ctx.measureText(shortText).width;
  ctx.font = '700 64px "Plus Jakarta Sans", "Outfit", sans-serif';
  const nameLines = wrapLines(ctx, org.name, W * 0.42, 2);
  const nameW = Math.max(...nameLines.map((l) => ctx.measureText(l).width));
  const lockW = shortW + 64 + 36 + nameW;
  const lx = (W - lockW) / 2;
  const ly = top * 0.5;
  const tileOnBrand = bg.toLowerCase() === color.toLowerCase();
  ctx.fillStyle = tileOnBrand ? '#ffffff' : color;
  ctx.beginPath();
  ctx.roundRect(lx, ly - 95, shortW + 64, 190, 34);
  ctx.fill();
  ctx.fillStyle = tileOnBrand ? color : '#ffffff';
  ctx.font = '800 150px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(shortText, lx + 32, ly + 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Plus Jakarta Sans", "Outfit", sans-serif';
  nameLines.forEach((line, i) => ctx.fillText(line, lx + shortW + 100, ly + (i - (nameLines.length - 1) / 2) * 72));
  ctx.fillStyle = accent;
  ctx.font = 'bold 34px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText((org.kicker || 'ORGANIZER BOOTH').toUpperCase(), lx, ly - 140);
  ctx.textBaseline = 'alphabetic';

  // Lower left: playful brand pattern around a dark well for the TV.
  ctx.fillStyle = shade(bg, 0.8);
  ctx.fillRect(0, top, xOf(TV_X1 + 0.12), H - top);
  const dots = [accent, '#F6B91A', '#1FA9E1', '#EC2F7B', '#4CB848'];
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = dots[i % dots.length];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc((i * 97) % xOf(TV_X1 + 0.1), top + 20 + ((i * 53) % (H - top - 40)), 8 + (i % 4) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05070d';
  ctx.beginPath();
  ctx.roundRect(xOf(TV_X0) - 16, yOf(TV_Y + TV_H / 2) - 16, xOf(TV_X1) - xOf(TV_X0) + 32, TV_H * WALL_PX_PER_M + 32, 20);
  ctx.fill();

  // Lower right: accent message panel with the tagline and three bullets.
  const px = xOf(TV_X1 + 0.12);
  ctx.fillStyle = accent;
  ctx.fillRect(px, top, W - px, H - top);
  ctx.fillStyle = ink;
  ctx.font = '800 50px "Plus Jakarta Sans", "Outfit", sans-serif';
  const tag = wrapLines(ctx, org.tagline || '', W - px - 80, 3);
  tag.forEach((line, i) => ctx.fillText(line, px + 40, top + 90 + i * 60));
  ctx.font = '600 38px "Plus Jakarta Sans", "Outfit", sans-serif';
  (org.bullets || []).slice(0, 3).forEach((b, i) => {
    const y = top + 110 + tag.length * 60 + 40 + i * 64;
    ctx.beginPath();
    ctx.arc(px + 52, y - 12, 10, 0, Math.PI * 2);
    ctx.fill();
    wrapLines(ctx, b, W - px - 120, 1).forEach((line) => ctx.fillText(line, px + 78, y));
  });

  // Footer strip
  ctx.fillStyle = shade(bg, 0.55);
  ctx.fillRect(0, H - 56, W, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('YOUTH INNOVATION MARKETPLACE  •  GMC 2026', W / 2, H - 18);
  ctx.textAlign = 'left';
  ctx.restore();

  const tex = makeTexture(canvas);
  // The arc is seen from inside, which mirrors cylinder UVs; flip u back.
  tex.repeat.x = -1;
  tex.offset.x = 1;
  return tex;
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

/** Wrap graphic for the oval pop-up counter: logo centred on the front, brand band below. */
function createCounterWrapTexture(org) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const { color, bg, accent } = palette(org);
  ctx.fillStyle = '#F7F6F2';
  ctx.fillRect(0, 0, 1024, 384);
  // u = 0.5 is the front of the counter (see the thetaStart in buildOrganizerBooth).
  ctx.fillStyle = accent;
  ctx.fillRect(0, 300, 1024, 84);
  const cx = 512;
  const shortText = org.short || org.name;
  ctx.font = '800 96px "Outfit", "Plus Jakarta Sans", sans-serif';
  const w = ctx.measureText(shortText).width;
  const tileOnBrand = bg.toLowerCase() === color.toLowerCase();
  ctx.fillStyle = tileOnBrand ? color : bg;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2 - 34, 70, w + 68, 140, 26);
  ctx.fill();
  ctx.fillStyle = tileOnBrand ? '#ffffff' : color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shortText, cx, 144);
  ctx.fillStyle = '#2E4570';
  ctx.font = '700 30px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ASK US · Passport · Programme', cx, 256);
  return makeTexture(canvas);
}

function createBrochureTexture(org, i) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const { color, bg, accent } = palette(org);
  const fills = [bg, accent, color, '#F6B91A'];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 180);
  ctx.fillStyle = fills[i % fills.length];
  ctx.fillRect(0, 0, 128, 110);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(40 + i * 14, 60, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2E4570';
  ctx.fillRect(14, 126, 100, 10);
  ctx.fillRect(14, 146, 70, 8);
  return makeTexture(canvas);
}

/**
 * Builds one organizer stand. `art` is the organizer's entry in src/data/organizerArt.json (its
 * own prints); `attachTV(parent, localPos)` is supplied by main.js so all TVs in the hall share
 * the same video element and click handling (only the palette-drawn stand has one).
 *
 * Footprint stays inside ±1.75 m along X so neighbouring stands (3.5 m apart) never touch.
 */
export function buildOrganizerBooth(org, { attachTV, art, castShadow = true, lowPower = false } = {}) {
  if ((art && art.backwall) || (org.art && org.art.backwall)) return buildArtBooth(org, { art, castShadow, lowPower });
  const group = new THREE.Group();
  group.name = `Organizer_${org.id}`;

  const pal = palette(org);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.3, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.55, metalness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2.2 });

  // --- Curved pop-up backwall: printed fabric on the front, plain brand colour on the back.
  const backdropTex = createBackdropTexture(org);
  const arcGeo = new THREE.CylinderGeometry(WALL_R, WALL_R, PANEL_H, 48, 1, true, Math.PI - WALL_HALF, WALL_HALF * 2);
  const front = new THREE.Mesh(arcGeo, new THREE.MeshStandardMaterial({
    map: backdropTex, emissive: 0xffffff, emissiveMap: backdropTex, emissiveIntensity: 0.18,
    roughness: 0.8, side: THREE.BackSide, alphaTest: 0.5, transparent: false,
  }));
  front.position.set(0, PANEL_BOTTOM + PANEL_H / 2, WALL_CZ);
  front.receiveShadow = true;
  front.castShadow = castShadow;
  front.name = 'panel';
  group.add(front);

  const back = new THREE.Mesh(
    new THREE.CylinderGeometry(WALL_R + 0.04, WALL_R + 0.04, PANEL_H - 0.12, 48, 1, true, Math.PI - WALL_HALF, WALL_HALF * 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(pal.bg, 0.7)), roughness: 0.9, side: THREE.FrontSide }),
  );
  back.position.copy(front.position);
  group.add(back);

  // End caps where the fabric wraps round the frame.
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.05, PANEL_H - 0.14, 0.06), new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(pal.bg, 0.85)), roughness: 0.85 }));
    cap.position.set(sx * (WALL_CHORD / 2 - 0.005), PANEL_BOTTOM + PANEL_H / 2 - 0.05, 0.0);
    group.add(cap);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.5), frameMat);
    foot.position.set(sx * (WALL_CHORD / 2 - 0.1), 0.015, -0.05);
    group.add(foot);
  }

  // Two arm spotlights on the top edge, aimed down at the graphic.
  for (const sx of [-0.65, 0.65]) {
    const z = wallZ(sx);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6), frameMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(sx, PANEL_BOTTOM + PANEL_H + 0.02, z + 0.2);
    group.add(arm);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 12), dark);
    head.position.set(sx, PANEL_BOTTOM + PANEL_H + 0.0, z + 0.42);
    head.rotation.x = -0.9;
    group.add(head);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 12), glow);
    lens.position.set(0, -0.061, 0);
    lens.rotation.x = Math.PI / 2;
    head.add(lens);
  }

  // TV in the lower-left "photo" area, flat on the chord of that stretch of the arc.
  if (attachTV) {
    const za = wallZ(TV_X0), zb = wallZ(TV_X1);
    const mount = new THREE.Group();
    mount.position.set((TV_X0 + TV_X1) / 2, TV_Y, (za + zb) / 2 + 0.045);
    mount.rotation.y = -Math.atan2(zb - za, TV_X1 - TV_X0);
    group.add(mount);
    attachTV(mount, new THREE.Vector3(0, 0, 0));
  }

  // --- Oval pop-up counter with a printed wrap and a dark top.
  const counter = new THREE.Group();
  counter.position.set(0.3, 0, 1.0);
  group.add(counter);
  const wrapTex = createCounterWrapTexture(org);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.95, 48, 1, false, Math.PI, Math.PI * 2),
    [new THREE.MeshStandardMaterial({ map: wrapTex, roughness: 0.45 }), dark, dark],
  );
  body.scale.set(1.2, 1, 0.48);
  body.position.y = 0.95 / 2;
  body.castShadow = castShadow;
  body.receiveShadow = true;
  body.name = 'table';
  counter.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.03, 48), dark);
  lid.scale.set(1.2, 1, 0.5);
  lid.position.y = 0.965;
  counter.add(lid);
  const paper = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.9 });
  for (let i = 0; i < 2; i++) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.025, 0.28), paper);
    stack.position.set(-0.22 + i * 0.3, 0.995, -0.02);
    stack.rotation.y = (i - 0.5) * 0.3;
    counter.add(stack);
  }

  // --- Roll-up banner on the right.
  const bannerX = WALL_CHORD / 2 + 0.42;
  const bannerTex = createBannerTexture(org);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 1.95),
    new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.18, roughness: 0.75, side: THREE.DoubleSide }),
  );
  banner.position.set(bannerX, 1.06, 0.2);
  banner.rotation.y = -0.25;
  group.add(banner);
  const bannerBase = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.07, 0.2), frameMat);
  bannerBase.position.set(bannerX, 0.035, 0.2);
  bannerBase.rotation.y = -0.25;
  bannerBase.name = 'bannerBase';
  group.add(bannerBase);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.0, 6), frameMat);
  pole.position.set(bannerX + 0.03, 1.0, 0.1);
  group.add(pole);

  // --- Zig-zag brochure rack, front-left.
  const rack = new THREE.Group();
  rack.position.set(-1.05, 0, 0.55);
  rack.rotation.y = 0.35;
  group.add(rack);
  for (const sx of [-0.17, 0.17]) {
    for (let k = 0; k < 4; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 5), frameMat);
      seg.position.set(sx, 0.2 + k * 0.36, (k % 2 ? 0.06 : -0.06));
      seg.rotation.x = k % 2 ? -0.3 : 0.3;
      rack.add(seg);
    }
  }
  const rackFoot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.36), frameMat);
  rackFoot.position.y = 0.01;
  rackFoot.name = 'rackFoot';
  rack.add(rackFoot);
  for (let k = 0; k < 4; k++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.1), frameMat);
    shelf.position.set(0, 0.32 + k * 0.36, 0.06);
    rack.add(shelf);
    const brochure = new THREE.Mesh(
      new THREE.PlaneGeometry(0.21, 0.29),
      new THREE.MeshStandardMaterial({ map: createBrochureTexture(org, k), roughness: 0.6 }),
    );
    brochure.position.set(0, 0.32 + k * 0.36 + 0.15, 0.08);
    brochure.rotation.x = -0.25;
    rack.add(brochure);
  }

  // Collision: the backwall arc + counter as one solid (the staff gap behind the counter is
  // narrower than a visitor), the banner base and the rack each on their own.
  return { group, solids: [[front, body], [bannerBase], [rackFoot]] };
}

// ---------------------------------------------------------------------------------------------
// Art mode: the organizers' own booth designs (venue designs/booth art/Organizers booth, prepared
// into public/venue/organizers by scripts/prepare_assets.py, which also writes the manifest
// src/data/organizerArt.json with each print's files and aspect ratio).
//
// Each stand is a pop-up display after the organizer booth design: a gently curved fabric
// backwall with rounded top corners on a tube frame, two arm spotlights, a table in a fitted
// cover with the table print across its front and a few handouts on top, and a roll-up banner
// with the standing-banner print. No TV, as in the designs.
//
// Three stands share the 8.9 m Executive 3 frontage, 2.95 m each, which is less than a backwall
// plus a banner side by side. So the banner stands in front of the stand's right-hand boundary,
// turned in toward its own table: it overlaps only the outer edge of the two walls behind it.
// ---------------------------------------------------------------------------------------------
// `z` is how far the wall's two ends stand in front of the stand's origin: the wall bows back
// from there by `sag`, and the lobby wall's panelling is close behind the origin.
const ART_WALL = { chord: 2.55, sag: 0.14, z: 0.2, bottom: 0.14, corner: 0.14 };
const ART_TABLE = { w: 1.6, h: 0.8, d: 0.6, z: 1.05 };
const ART_BANNER = { w: 0.85, x: 1.475, z: 0.66, yaw: -0.5, bottom: 0.1 };
const ART_ASPECT = { backwall: 4 / 3, table: 2, banner: 0.4231 };   // when the manifest has none

function artTexture(url) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** { url, aspect } for one print: the manifest entry, or the legacy path in organizers.json. */
function artPart(org, art, part, lowPower) {
  const m = art && art[part];
  if (m) return { url: lowPower ? m.sm : m.lg, aspect: m.aspect };
  const legacy = org.art && org.art[part];
  return typeof legacy === 'string' ? { url: legacy, aspect: ART_ASPECT[part] } : null;
}

/**
 * The curved backwall as one strip of quads: `aspect` fixes its height from its arc length, the
 * top corners are rounded in the geometry (no alpha cut-out), and the columns bunch up at the
 * ends so those corners stay round. Front face toward +Z; u runs left to right as a visitor
 * sees it. `inset` pulls the surface back along its normal (for the plain backing shell).
 */
function curvedWallGeometry(aspect, { inset = 0, grow = 0 } = {}) {
  const { chord, sag, bottom, corner } = ART_WALL;
  const z0 = ART_WALL.z;
  const R = (chord * chord / 4 + sag * sag) / (2 * sag);
  const half = Math.asin(chord / 2 / R);
  const arc = 2 * R * half;
  const height = arc / aspect;
  const top = bottom + height;

  // Arc positions (metres from the left end): fine steps through each corner, even between.
  const steps = [0, 0.012, 0.035, 0.07, 0.105, corner];
  const inner = 20;
  const ss = [...steps];
  for (let i = 1; i < inner; i++) ss.push(corner + (arc - 2 * corner) * i / inner);
  for (let i = steps.length - 1; i >= 0; i--) ss.push(arc - steps[i]);

  const pos = [], nor = [], uv = [], idx = [];
  ss.forEach((s, i) => {
    const a = -half + s / R;
    const nx = -Math.sin(a), nz = Math.cos(a);
    const x = R * Math.sin(a) - nx * inset;
    const z = z0 - sag + R * (1 - Math.cos(a)) - nz * inset;
    const edge = Math.min(s, arc - s);
    const drop = edge < corner ? corner - Math.sqrt(corner * corner - (corner - edge) ** 2) : 0;
    const yTop = top - drop + grow;
    pos.push(x, bottom - grow, z, x, yTop, z);
    nor.push(nx, 0, nz, nx, 0, nz);
    uv.push(s / arc, 0, s / arc, (yTop - grow - bottom) / height);
    if (i) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 3, k, k + 3, k + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return { geo, R, half, top, height, zAt: (x) => z0 - sag + R - Math.sqrt(R * R - x * x) };
}

function buildArtBooth(org, { art, castShadow = true, lowPower = false } = {}) {
  const group = new THREE.Group();
  group.name = `Organizer_${org.id}`;
  const prints = {
    backwall: artPart(org, art, 'backwall', lowPower),
    table: artPart(org, art, 'table', lowPower),
    banner: artPart(org, art, 'banner', lowPower),
  };
  const pal = palette(org);
  const style = org.stand || {};
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.3, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.55, metalness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2.2 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.85 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.accent), roughness: 0.8 });
  const add = (mesh, parent = group) => { parent.add(mesh); return mesh; };
  const printMaterial = (url, roughness) => {
    const map = artTexture(url);
    // A little self-light, as a spot-lit print has: the lobby's lights are far overhead.
    return new THREE.MeshStandardMaterial({ map, roughness, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.12 });
  };

  // --- Curved backwall: the print on the front, a plain fabric shell wrapping the frame behind.
  const W = ART_WALL;
  const wall = curvedWallGeometry(prints.backwall.aspect);
  const front = add(new THREE.Mesh(wall.geo, printMaterial(prints.backwall.url, 0.78)));
  front.castShadow = castShadow;
  front.receiveShadow = true;
  front.name = 'panel';
  const shell = add(new THREE.Mesh(
    curvedWallGeometry(prints.backwall.aspect, { inset: 0.012, grow: 0.012 }).geo,
    new THREE.MeshStandardMaterial({ color: 0xeceae6, roughness: 0.9, side: THREE.DoubleSide }),
  ));
  shell.receiveShadow = true;
  // Tube frame: an upright at each end, down to a flat foot.
  for (const sx of [-1, 1]) {
    const x = sx * (W.chord / 2 - 0.02);
    const upright = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, wall.top - W.corner, 8), frameMat));
    upright.position.set(x, (wall.top - W.corner) / 2, W.z - 0.03);
    const foot = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.022, 0.5), frameMat));
    foot.position.set(x, 0.011, W.z + 0.1);
  }
  // Two arm spotlights on the top edge, aimed down at the print.
  for (const sx of [-0.62, 0.62]) {
    const z = wall.zAt(sx);
    const arm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 6), frameMat));
    arm.rotation.x = Math.PI / 2;
    arm.position.set(sx, wall.top + 0.02, z + 0.19);
    const head = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.12, 12), dark));
    head.position.set(sx, wall.top + 0.0, z + 0.4);
    head.rotation.x = -0.9;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), glow);
    lens.position.set(0, -0.061, 0);
    lens.rotation.x = Math.PI / 2;
    head.add(lens);
  }

  // --- Table in a fitted cover: the table print across the front, the cover's own colour on
  // the top and sides, a slightly proud top with soft edges.
  const t = ART_TABLE;
  const cover = new THREE.MeshStandardMaterial({ color: new THREE.Color(style.tableColor || pal.bg), roughness: 0.88 });
  const body = add(new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h - 0.03, t.d), cover));
  body.position.set(0, (t.h - 0.03) / 2, t.z);
  body.castShadow = castShadow;
  body.receiveShadow = true;
  body.name = 'table';
  const top = add(new THREE.Mesh(new RoundedBoxGeometry(t.w + 0.03, 0.034, t.d + 0.03, 2, 0.014), cover));
  top.position.set(0, t.h - 0.017, t.z);
  top.receiveShadow = true;
  if (prints.table) {
    const h = Math.min(t.h - 0.02, t.w / prints.table.aspect);
    const print = add(new THREE.Mesh(new THREE.PlaneGeometry(t.w, h), printMaterial(prints.table.url, 0.7)));
    print.position.set(0, t.h - 0.02 - h / 2, t.z + t.d / 2 + 0.003);
  }
  // Handouts: two stacks with a coloured cover sheet, and a small tent sign.
  [[-0.5, -0.04, -0.14], [-0.2, 0.05, 0.2]].forEach(([x, dz, yaw], i) => {
    const stack = add(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.02 + i * 0.014, 0.297), paper));
    stack.position.set(x, t.h + (0.02 + i * 0.014) / 2, t.z + dz);
    stack.rotation.y = yaw;
    const sheet = add(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.002, 0.297), i ? accent : paper));
    sheet.position.set(x, t.h + 0.021 + i * 0.014, t.z + dz);
    sheet.rotation.y = yaw;
  });
  const tent = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.004), paper));
  tent.position.set(0.48, t.h + 0.072, t.z + 0.08);
  tent.rotation.set(-0.3, -0.12, 0);
  const tentBand = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.002), accent));
  tentBand.position.set(0, 0.05, 0.003);
  tent.add(tentBand);

  // --- Roll-up banner: cassette base with two swivel feet, a pole, the print hung from a top rail.
  const b = ART_BANNER;
  const bh = b.w / prints.banner.aspect;
  const stand = add(new THREE.Group());
  stand.position.set(b.x, 0, b.z);
  stand.rotation.y = b.yaw;
  const banner = add(new THREE.Mesh(new THREE.PlaneGeometry(b.w, bh), printMaterial(prints.banner.url, 0.7)), stand);
  banner.position.set(0, b.bottom + bh / 2, 0.014);
  const backing = add(new THREE.Mesh(new THREE.PlaneGeometry(b.w, bh), new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.8 })), stand);
  backing.position.set(0, b.bottom + bh / 2, 0.01);
  backing.rotation.y = Math.PI;
  const bannerBase = add(new THREE.Mesh(new RoundedBoxGeometry(b.w + 0.06, 0.085, 0.13, 2, 0.02), frameMat), stand);
  bannerBase.position.y = 0.06;
  bannerBase.name = 'bannerBase';
  for (const sx of [-1, 1]) {
    const foot = add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.014, 0.4), frameMat), stand);
    foot.position.set(sx * (b.w / 2 - 0.1), 0.007, 0);
  }
  const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, bh, 6), frameMat), stand);
  pole.position.set(0, b.bottom + bh / 2, -0.012);
  const rail = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, b.w + 0.02, 8), frameMat), stand);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, b.bottom + bh, 0.012);

  return { group, solids: [[front, body], [bannerBase]] };
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
