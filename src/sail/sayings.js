/**
 * The build-up: signs that pop up out of the sea at the sides of the route as boats sail past.
 * The wording is in src/data/sailSayings.json, in the colours of the photowall's beams of light.
 *
 * On a phone a sign pops up ahead of your own boat and passes beside you, alternating sides. On
 * the LED the same signs rise along the far side of the route as the lead boat reaches them.
 */
import * as THREE from 'three';
import { ROUTE } from './world.js';
import sayings from '../data/sailSayings.json';

const NAVY = '#1B3461';
const ASPECT = 620 / 400;

function signTexture({ lines, bg, ink }) {
  const c = document.createElement('canvas');
  c.width = 620;
  c.height = 400;
  const ctx = c.getContext('2d');
  // Post and float below the board.
  ctx.fillStyle = '#E7ECF2';
  ctx.fillRect(296, 268, 28, 132);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(296, 268, 8, 132);
  ctx.fillStyle = bg;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect(10, 10, 600, 270, 46);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink || NAVY;
  const fit = (t, size, weight) => {
    let s = size;
    do {
      ctx.font = `${weight} ${s}px Fredoka, system-ui, sans-serif`;
      if (ctx.measureText(t).width <= 540) break;
      s -= 3;
    } while (s > 24);
    return s;
  };
  if (lines.length === 1) {
    fit(lines[0], 96, 700);
    ctx.fillText(lines[0], 310, 145);
  } else {
    fit(lines[0], 66, 500);
    ctx.fillText(lines[0], 310, 92);
    fit(lines[1], 100, 700);
    ctx.fillText(lines[1], 310, 182);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const back = (v) => { const c = 2.2; return 1 + (c + 1) * (v - 1) ** 3 + c * (v - 1) ** 2; };

export function createSayings(world, { isLed = false } = {}) {
  const geo = new THREE.PlaneGeometry(ASPECT, 1);
  geo.translate(0, 0.5, 0);
  const signs = sayings.map((item, i) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: signTexture(item), transparent: true, alphaTest: 0.5, toneMapped: false, side: THREE.DoubleSide,
    }));
    mesh.visible = false;
    mesh.name = `Saying_${i}`;
    world.scene.add(mesh);
    return { mesh, p: item.p, side: i % 2 ? 1 : -1, pop: 0 };
  });

  const POP_AHEAD = 50;       // metres ahead of the boat at which a sign starts to rise
  const SINK_AHEAD = 13;      // and where it sinks again, before it is too close to read
  const camFlat = new THREE.Vector3();

  function place(s, x, z, height, u) {
    s.mesh.visible = u > 0.001;
    if (!s.mesh.visible) return;
    const k = back(clamp01(u));
    s.mesh.position.set(x, -height * 1.05 + height * 1.05 * k + Math.sin(performance.now() * 0.0016 + s.p * 40) * 0.08, z);
    s.mesh.scale.setScalar(height);
    camFlat.copy(world.camera.position);
    camFlat.y = s.mesh.position.y;
    s.mesh.lookAt(camFlat);
  }

  return {
    /** Phone: `boatX` and `boatZ` are your boat's position. */
    updateChase(boatX, boatZ, active) {
      const fovV = THREE.MathUtils.degToRad(world.camera.fov);
      const halfW = Math.tan(fovV / 2) * world.camera.aspect * 42;   // half the view, 42 m out
      const height = THREE.MathUtils.clamp(halfW * 0.62, 5.2, 9);
      const offset = Math.max(Math.min(halfW * 0.5, 13), height * ASPECT * 0.56);
      for (const s of signs) {
        const z = -ROUTE * s.p - 22;
        const ahead = boatZ - z;
        let u = 0;
        if (active && ahead < POP_AHEAD && ahead > SINK_AHEAD - 5) {
          u = Math.min((POP_AHEAD - ahead) / 9, 1) * clamp01((ahead - (SINK_AHEAD - 5)) / 5);
        }
        place(s, boatX + s.side * offset, z, height, u);
      }
    },

    /** LED: signs on alternating sides of the route, as the lead boat reaches them. */
    updateOverview(leaderP, active) {
      for (const s of signs) {
        const age = leaderP - s.p + 0.06;
        const fade = clamp01(1 - (age - 0.26) / 0.04);
        const u = active && age > 0 ? clamp01(age / 0.05) * fade : 0;
        // Far-side signs stand behind the fleet; near-side ones low in the frame, in front of it.
        if (s.side < 0) place(s, -58, -ROUTE * s.p, 19, u);
        else place(s, 92, -ROUTE * s.p, 13, u);
      }
    },

    hide() {
      for (const s of signs) s.mesh.visible = false;
    },
  };
}
