/**
 * Wayfinding: a guided route on the floor and floating markers.
 *
 *  - Floor arrows run from the registration desk along the vestibule, through the Diplomatic
 *    Hall foyer's entrance doors and across the foyer to the event arch and the booths
 *    (hallLayout.json `wayfinding.route`). They are one InstancedMesh — a single draw call for
 *    the whole route, which matters on the tablets this runs on — and a soft pulse travels along
 *    them in the walking direction.
 *  - Markers float over the entrance and the arch, and a label floats over every area standee
 *    (registration, deal corner, media hub, booth entrance, safeguarding), shown within range.
 */
import * as THREE from 'three';

const FONT = 'system-ui, "Segoe UI", sans-serif';
const CYAN = new THREE.Color('#38bdf8');

function chevronGeometry() {
  // A flat chevron pointing along +z in its local frame (laid on the floor later).
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.12);
  s.lineTo(0, 0.2);
  s.lineTo(0.32, -0.12);
  s.lineTo(0.32, -0.26);
  s.lineTo(0, 0.06);
  s.lineTo(-0.32, -0.26);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);    // lay it flat facing up; its tip now points along -z
  g.rotateY(Math.PI);         // and turn it to point along +z, the yaw-0 walking direction
  return g;
}

function labelTexture(title, sub, { accent = '#38bdf8', big = false } = {}) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const ctx = c.getContext('2d');
  const W = c.width;
  ctx.fillStyle = 'rgba(12, 20, 38, 0.86)';
  ctx.beginPath();
  ctx.roundRect(8, 8, W - 16, 118, 59);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.stroke();
  // Pointer under the pill.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 22, 128);
  ctx.lineTo(W / 2 + 22, 128);
  ctx.lineTo(W / 2, 168);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  let size = big ? 50 : 44;
  do {
    ctx.font = `900 ${size}px ${FONT}`;
    if (ctx.measureText(title).width <= W - 90) break;
    size -= 2;
  } while (size > 20);
  ctx.fillText(title, W / 2, sub ? 52 : 67);
  if (sub) {
    ctx.fillStyle = accent;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(sub, W / 2, 96);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createWayfinding(scene, layout) {
  const wf = layout.wayfinding;
  const group = new THREE.Group();
  group.name = 'Wayfinding';
  scene.add(group);
  const disposables = [];

  // --- Floor arrows along the route, evenly spaced, each turned to the walking direction.
  const pts = wf.route.map(([x, z]) => new THREE.Vector2(x, z));
  const stops = [];
  let carry = 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    for (let d = carry; d < len; d += wf.spacing) {
      stops.push({ x: a.x + dir.x * d, z: a.y + dir.y * d, yaw: Math.atan2(dir.x, dir.y) });
    }
    carry = (carry - len) % wf.spacing;
    if (carry < 0) carry += wf.spacing;
  }
  const geo = chevronGeometry();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  disposables.push(geo, mat);
  const arrows = new THREE.InstancedMesh(geo, mat, stops.length);
  arrows.name = 'Wayfinding_Arrows';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  stops.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m4.compose(new THREE.Vector3(s.x, 0.03, s.z), q, new THREE.Vector3(1, 1, 1));
    arrows.setMatrixAt(i, m4);
    arrows.setColorAt(i, CYAN);
  });
  arrows.instanceMatrix.needsUpdate = true;
  arrows.frustumCulled = false;        // the route spans two rooms; its bounds would be the instance at the origin
  group.add(arrows);

  // --- Markers: entrance, booths, and a label over every area standee.
  const markers = [];
  const addMarker = (title, sub, x, y, z, range, opts = {}) => {
    const tex = labelTexture(title, sub, opts);
    const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    disposables.push(tex, sm);
    const sprite = new THREE.Sprite(sm);
    const w = opts.big ? 2.2 : 1.6;
    sprite.scale.set(w, w * 176 / 512, 1);
    sprite.position.set(x, y, z);
    sprite.name = `Marker_${title}`;
    group.add(sprite);
    markers.push({ sprite, x, y, z, range, phase: markers.length * 0.9 });
  };
  for (const m of wf.markers) addMarker(m.title, m.sub, m.x, m.y, m.z, m.range, { big: true, accent: '#fbbf24' });
  for (const s of layout.signs) {
    const lbl = wf.signLabels[s.id];
    if (lbl) addMarker(lbl[0], lbl[1], s.x, s.bottom + s.h + 0.5, s.z, 14);
  }

  /** Per frame: the pulse along the arrows, marker bob and range fade. */
  function update(t, playerPos) {
    const inHall = playerPos.x < 19.0;
    arrows.visible = !inHall;
    if (arrows.visible) {
      const c = new THREE.Color();
      for (let i = 0; i < stops.length; i++) {
        // A bright band moves along the route toward the arch, about one arrow every 0.12 s.
        const wave = 0.5 + 0.5 * Math.cos((i * 0.55) - t * 4.5);
        c.copy(CYAN).multiplyScalar(0.45 + 0.75 * wave * wave);
        arrows.setColorAt(i, c);
      }
      arrows.instanceColor.needsUpdate = true;
    }
    for (const m of markers) {
      const d = Math.hypot(playerPos.x - m.x, playerPos.z - m.z);
      const on = d < m.range && d > 1.2;
      m.sprite.visible = on;
      if (!on) continue;
      m.sprite.position.y = m.y + Math.sin(t * 1.8 + m.phase) * 0.06;
      m.sprite.material.opacity = Math.min(1, (m.range - d) / 3);
    }
  }

  return { group, update, route: wf.route, dispose: () => disposables.forEach((d) => d.dispose()) };
}
