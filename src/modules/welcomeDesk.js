/**
 * Welcome & Information desk for the Pre-Function Foyer.
 *
 * The venue GLB ships the desk as a plain scaled cube whose single "welcome_desk" texture is
 * stretched over every face (giant wrapped letters, blank top). main.js hides that node and its
 * floor label and drops this procedural counter in the same footprint so it reads as a real
 * reception desk: branded fascia, counter top with LED lip, back-lit header sign and a few props.
 *
 * Local space: the counter runs along X, the visitor side is +Z. main.js rotates the group so
 * +Z points east into the foyer.
 */
import * as THREE from 'three';

export const DESK_W = 3.0;   // along the counter
export const DESK_D = 0.7;   // body depth
export const DESK_H = 1.05;  // body height (top at ~1.11 m)
export const TOP_D = 0.92;

const NAVY = '#0B132B';
const CYAN = '#00D4FF';
const AMBER = '#F59E0B';

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(ctx, x, y, w, h, r, fill, stroke, lw = 3) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function infoGlyph(ctx, cx, cy, r, bg = CYAN, fg = '#04070F') {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(r * 1.35)}px "Outfit", "Plus Jakarta Sans", sans-serif`;
  ctx.fillText('i', cx, cy + r * 0.05);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/** Front fascia (3.0 × 1.05 m). */
function createFasciaTexture({ isTouch = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 538;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0E1A3A');
  grad.addColorStop(0.6, NAVY);
  grad.addColorStop(1, '#07101F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Fine grid + diagonal sheen
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const sheen = ctx.createLinearGradient(0, 0, W, 0);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Top rule + bottom kick band
  ctx.fillStyle = CYAN;
  ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = '#04070F';
  ctx.fillRect(0, H - 54, W, 54);
  ctx.fillStyle = 'rgba(0, 212, 255, 0.35)';
  ctx.fillRect(0, H - 54, W, 3);

  // Left block: info glyph + WELCOME
  infoGlyph(ctx, 118, 200, 66);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 150px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('WELCOME', 214, 256);
  ctx.fillStyle = CYAN;
  ctx.font = '700 40px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('INFORMATION  •  REGISTRATION  •  DIRECTIONS', 216, 322);

  // Right block: event lock-up
  roundRect(ctx, W - 470, 60, 400, 62, 31, 'rgba(0,212,255,0.14)', CYAN, 3);
  ctx.fillStyle = CYAN;
  ctx.font = 'bold 30px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GMC 2026  •  NOV 17–18', W - 270, 102);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 34px "Plus Jakarta Sans", "Outfit", sans-serif';
  ctx.fillText('Youth Innovations Marketplace', W - 270, 176);
  ctx.fillStyle = 'rgba(226,232,240,0.7)';
  ctx.font = '500 28px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Diplomatic Main Hall • Marriott Manila', W - 270, 218);

  // Service chips
  const chips = ['Passport', 'Programme', 'Booth map', 'Commitment Wall', 'Live stage'];
  ctx.font = '600 26px "Plus Jakarta Sans", sans-serif';
  let cx = 216;
  const cy = 388;
  for (const chip of chips) {
    const w = ctx.measureText(chip).width + 44;
    roundRect(ctx, cx, cy, w, 48, 24, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.22)', 2);
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'left';
    ctx.fillText(chip, cx + 22, cy + 33);
    cx += w + 16;
  }

  // Kick band caption
  ctx.fillStyle = 'rgba(226,232,240,0.55)';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(isTouch ? 'WALK UP AND TAP TO OPEN THE VENUE GUIDE' : 'WALK UP AND PRESS [E] FOR THE VENUE GUIDE', 40, H - 18);
  ctx.textAlign = 'right';
  ctx.fillText('RECEPTION', W - 40, H - 18);
  ctx.textAlign = 'left';

  return tex(canvas);
}

/** Back-lit header sign (2.6 × 0.5 m). */
function createHeaderTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1664;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#111C3E');
  grad.addColorStop(1, NAVY);
  roundRect(ctx, 0, 0, W, H, 40, grad, CYAN, 8);

  infoGlyph(ctx, 150, H / 2, 84);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 118px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('INFORMATION', 270, H / 2 - 22);
  ctx.fillStyle = CYAN;
  ctx.font = '700 40px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('WELCOME DESK  •  ASK US ANYTHING', 274, H / 2 + 74);
  ctx.textBaseline = 'alphabetic';

  // Right-side event badge
  roundRect(ctx, W - 380, 70, 300, 180, 28, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.18)', 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = AMBER;
  ctx.font = '800 62px "Outfit", sans-serif';
  ctx.fillText('GMC', W - 230, 150);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '700 40px "Outfit", sans-serif';
  ctx.fillText('2026', W - 230, 210);
  ctx.textAlign = 'left';

  return tex(canvas);
}

/** Small tablet screen showing the visitor counter / passport prompt. */
function createTabletTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070F';
  ctx.fillRect(0, 0, 384, 256);
  roundRect(ctx, 14, 14, 356, 228, 18, '#0B132B', 'rgba(0,212,255,0.5)', 3);
  ctx.fillStyle = CYAN;
  ctx.font = 'bold 22px "Outfit", sans-serif';
  ctx.fillText('CHECK-IN', 36, 56);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 44px "Outfit", sans-serif';
  ctx.fillText('Get your', 36, 116);
  ctx.fillText('Passport', 36, 164);
  ctx.fillStyle = 'rgba(226,232,240,0.7)';
  ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Visit all 20 booths • collect stamps', 36, 212);
  return tex(canvas);
}

/**
 * @returns {{ group: THREE.Group, solids: THREE.Mesh[] }} solids are merged into one collision box.
 */
export function buildWelcomeDesk({ castShadow = true, isTouch = false } = {}) {
  const group = new THREE.Group();
  group.name = 'Welcome_Desk_Procedural';

  const navy = new THREE.MeshStandardMaterial({ color: 0x0f1a36, roughness: 0.55, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.6, metalness: 0.3 });
  const oak = new THREE.MeshStandardMaterial({ color: 0xe6dfd2, roughness: 0.35, metalness: 0.05 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.25, metalness: 0.85 });
  const led = new THREE.MeshStandardMaterial({ color: 0x00d4ff, emissive: 0x00d4ff, emissiveIntensity: 1.1, roughness: 0.3 });

  // Body with branded fascia on the visitor side (+Z)
  const fasciaTex = createFasciaTexture({ isTouch });
  const fascia = new THREE.MeshStandardMaterial({ map: fasciaTex, emissive: 0xffffff, emissiveMap: fasciaTex, emissiveIntensity: 0.28, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(DESK_W, DESK_H, DESK_D), [navy, navy, navy, navy, fascia, navy]);
  body.position.set(0, DESK_H / 2, 0);
  body.castShadow = castShadow;
  body.receiveShadow = true;
  body.name = 'body';
  group.add(body);

  // Recessed kick so the counter appears to float slightly
  const kick = new THREE.Mesh(new THREE.BoxGeometry(DESK_W - 0.08, 0.06, DESK_D - 0.08), dark);
  kick.position.set(0, 0.03, 0);
  group.add(kick);

  // Counter top + front lip LED
  const top = new THREE.Mesh(new THREE.BoxGeometry(DESK_W + 0.2, 0.06, TOP_D), oak);
  top.position.set(0, DESK_H + 0.03, 0.02);
  top.castShadow = castShadow;
  top.receiveShadow = true;
  top.name = 'top';
  group.add(top);

  const lip = new THREE.Mesh(new THREE.BoxGeometry(DESK_W + 0.1, 0.025, 0.02), led);
  lip.position.set(0, DESK_H - 0.02, DESK_D / 2 + 0.005);
  group.add(lip);

  // Back-lit header sign on two posts, set toward the staff side
  const headerTex = createHeaderTexture();
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.5, 0.05),
    [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: headerTex, emissive: 0xffffff, emissiveMap: headerTex, emissiveIntensity: 0.45, roughness: 0.5 }), dark]
  );
  header.position.set(0, DESK_H + 0.62, -0.3);
  header.castShadow = castShadow;
  group.add(header);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 10), chrome);
    post.position.set(sx * 1.1, DESK_H + 0.26, -0.3);
    group.add(post);
  }

  // --- Props on the counter ---
  // Tablet (angled toward visitors)
  const tabletTex = createTabletTexture();
  const tablet = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.012),
    [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: tabletTex, emissive: 0xffffff, emissiveMap: tabletTex, emissiveIntensity: 0.7, roughness: 0.2 }), dark]
  );
  tablet.position.set(0.85, DESK_H + 0.165, 0.16);
  tablet.rotation.x = -0.55;
  group.add(tablet);
  const tabletStand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), chrome);
  tabletStand.position.set(0.85, DESK_H + 0.07, 0.1);
  group.add(tabletStand);

  // Brochure rack: three tilted leaflet stacks in a small tray
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.22), dark);
  tray.position.set(-0.75, DESK_H + 0.075, 0.1);
  group.add(tray);
  const leafletColors = [0x00d4ff, 0xf59e0b, 0xf4f4f5];
  leafletColors.forEach((c, i) => {
    const leaflet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.012), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    leaflet.position.set(-0.94 + i * 0.19, DESK_H + 0.18, 0.1);
    leaflet.rotation.x = -0.35;
    group.add(leaflet);
  });

  // Reception bell
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.015, 20), chrome);
  bellBase.position.set(0.2, DESK_H + 0.068, 0.2);
  group.add(bellBase);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf5c451, roughness: 0.25, metalness: 0.7 }));
  bell.position.set(0.2, DESK_H + 0.075, 0.2);
  group.add(bell);

  // Lanyard / badge box
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0x1c2541, roughness: 0.7 }));
  box.position.set(-0.15, DESK_H + 0.11, -0.12);
  group.add(box);
  const badges = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.18), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
  badges.position.set(-0.15, DESK_H + 0.17, -0.12);
  group.add(badges);

  // Small plant at the far end
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.8 }));
  pot.position.set(1.35, DESK_H + 0.12, -0.15);
  group.add(pot);
  const foliage = new THREE.MeshStandardMaterial({ color: 0x2f9e5b, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), foliage);
    leaf.scale.set(1, 1.4, 1);
    leaf.position.set(1.35 + Math.cos(a) * 0.045, DESK_H + 0.25, -0.15 + Math.sin(a) * 0.045);
    group.add(leaf);
  }

  // Floor mat in front of the counter
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(DESK_W + 0.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x0f1a36, roughness: 1, transparent: true, opacity: 0.5 })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.012, DESK_D / 2 + 0.85);
  mat.receiveShadow = true;
  group.add(mat);

  group.traverse((o) => { if (o.isMesh && o !== mat) o.receiveShadow = true; });

  return { group, solids: [body, top, header] };
}
