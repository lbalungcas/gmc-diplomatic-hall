/**
 * The opening animation, a pure function of `t`, the seconds since the server's `openAt`. Every
 * phone and the LED compute it from the same clock, so they play in step, and a phone that joins
 * or reconnects late lands in the right moment.
 *
 *   0.0  the view lifts off the sea to frame the lighthouse; the lantern flares, the beams stop
 *   2.6  the bulb rises out of the lantern on a shaft of light
 *   4.6  it flickers, then catches
 *   5.6  rays burst from it and the sky turns to dawn
 *   6.6  it moves to its place in the logo
 *   7.5  YOUTH / INNOVATIONS / MARKETPLACE / the date write on beside it
 *   9.0  "IS NOW OPEN!", confetti
 */
import * as THREE from 'three';
import { LH_Z, LANTERN_Y, radialTexture } from './world.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (v) => v * v * (3 - 2 * v);
const easeOut = (v) => 1 - (1 - v) ** 3;
const back = (v) => { const c = 1.9; return 1 + (c + 1) * (v - 1) ** 3 + c * (v - 1) ** 2; };

export const CUES = { rise: 2.6, on: 5.6, write: 7.5, open: 9.0, cta: 10.6 };
const LOGOTYPE_ASPECT = 1686 / 936;
const BULB_ASPECT = 232 / 311;

function shapeFrom(points, r) {
  // A closed polygon with rounded corners, in unit coordinates.
  const s = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i], a = points[(i + n - 1) % n], b = points[(i + 1) % n];
    const da = new THREE.Vector2(a[0] - p[0], a[1] - p[1]);
    const db = new THREE.Vector2(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da.length() * 0.45), rb = Math.min(r, db.length() * 0.45);
    da.setLength(ra);
    db.setLength(rb);
    const sx = p[0] + da.x, sy = p[1] + da.y;
    if (i === 0) s.moveTo(sx, sy);
    else s.lineTo(sx, sy);
    s.quadraticCurveTo(p[0], p[1], p[0] + db.x, p[1] + db.y);
  }
  s.closePath();
  return s;
}

/** The logo's bulb, 1 unit tall and centred, traced from the client's mark. */
export function bulbOutlines() {
  // Pixel coordinates from the photowall's logo; y flipped, centred on (175, 187), 311 px tall.
  const P = (x, y) => [(x - 175) / 311, (187 - y) / 311];
  return {
    hex: [P(175, 32), P(291, 98), P(291, 222), P(175, 288), P(59, 222), P(59, 98)],
    core: [P(175, 114), P(206, 150), P(222, 160), P(222, 206), P(175, 235), P(128, 206), P(128, 160), P(144, 150)],
    chevron: [P(108, 272), P(175, 306), P(241, 272), P(241, 316), P(175, 343), P(108, 316)],
  };
}

function makeBulb() {
  const outlines = bulbOutlines();
  const hex = [...outlines.hex].reverse();
  const inner = [...outlines.core].reverse();
  const chev = [...outlines.chevron].reverse();
  const opts = (d) => ({ depth: d, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 });
  const body = new THREE.MeshLambertMaterial({ color: 0xf2c667, emissive: 0xf2b84a, emissiveIntensity: 0 });
  const core = new THREE.MeshLambertMaterial({ color: 0xf8dfa5, emissive: 0xffe9b0, emissiveIntensity: 0 });
  const base = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15 });
  const g = new THREE.Group();
  const hexMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeFrom(hex, 0.085), opts(0.09)), body);
  hexMesh.position.z = -0.05;
  const coreMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeFrom(inner, 0.03), opts(0.02)), core);
  coreMesh.position.z = 0.05;
  const chevMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeFrom(chev, 0.035), opts(0.05)), base);
  chevMesh.position.z = -0.03;
  g.add(hexMesh, coreMesh, chevMesh);
  g.userData = { body, core, base };
  return g;
}

export function raysMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLevel, uFlash;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float a = atan(p.y, p.x);
        // Two sets of rays turning opposite ways, so they shimmer rather than rotate rigidly.
        float s1 = pow(0.5 + 0.5 * sin(a * 12.0 + uTime * 0.25), 3.0);
        float s2 = pow(0.5 + 0.5 * sin(a * 7.0 - uTime * 0.17 + 1.3), 4.0);
        float rays = (s1 * 0.75 + s2 * 0.55) * pow(max(0.0, 1.0 - r), 1.35);
        float core = pow(max(0.0, 1.0 - r * 2.6), 2.0);
        float flash = pow(max(0.0, 1.0 - r), 2.2) * uFlash;
        vec3 col = vec3(1.0, 0.86, 0.55) * (rays * uLevel + core * uLevel * 0.55) + vec3(1.0, 0.95, 0.82) * flash;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function logotypeMaterial(map) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { map: { value: map }, uReveal: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform float uReveal;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        // Four lines of the logotype, each writing on left to right, one after the other.
        float y = 1.0 - vUv.y;
        float row = y < 0.31 ? 0.0 : (y < 0.60 ? 1.0 : (y < 0.835 ? 2.0 : 3.0));
        float local = clamp(uReveal * 4.0 - row * 0.92, 0.0, 1.0);
        float mask = 1.0 - smoothstep(local * 1.2 - 0.2, local * 1.2, vUv.x);
        gl_FragColor = vec4(c.rgb, c.a * mask);
        #include <colorspace_fragment>
      }`,
  });
}

function openTextTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 136px Fredoka, system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = '#132a57';
  ctx.strokeText('IS NOW OPEN!', 512, 100);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('IS NOW OPEN!', 512, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export async function createOpening(world, { isLed = false, onCue = () => {} } = {}) {
  const { scene, camera, glowTex } = world;
  const group = new THREE.Group();
  group.name = 'Opening';
  group.visible = false;
  scene.add(group);

  const logoMap = await new THREE.TextureLoader().loadAsync('/sail/logotype.webp');
  logoMap.colorSpace = THREE.SRGBColorSpace;
  logoMap.anisotropy = 8;

  const rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), raysMaterial());
  rays.renderOrder = 1;
  const shaft = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffe2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  }));
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(14,30,70,0.82)'], [0.55, 'rgba(14,30,70,0.62)'], [1, 'rgba(14,30,70,0)']]),
    transparent: true, depthWrite: false, opacity: 0,
  }));
  veil.renderOrder = 2;
  const bulb = makeBulb();
  bulb.renderOrder = 4;
  bulb.traverse((o) => { if (o.isMesh) { o.renderOrder = 4; } });
  const logotype = new THREE.Mesh(new THREE.PlaneGeometry(LOGOTYPE_ASPECT, 1), logotypeMaterial(logoMap));
  logotype.renderOrder = 3;
  const openText = new THREE.Mesh(new THREE.PlaneGeometry(1024 / 192, 1), new THREE.MeshBasicMaterial({
    map: openTextTexture(), transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
  }));
  openText.renderOrder = 3;
  group.add(rays, shaft, glow, veil, bulb, logotype, openText);

  // Confetti: a fixed set of instanced flakes whose positions are a function of t.
  const COUNT = isLed ? 420 : 130;
  const flakes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 0.6),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    COUNT,
  );
  flakes.frustumCulled = false;
  flakes.visible = false;
  const palette = ['#F2C667', '#E9B4BB', '#9CCCE3', '#DD9366', '#FFFFFF', '#2F7BC4'].map((c) => new THREE.Color(c));
  const seeds = [];
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 14 + Math.random() * 26;
    seeds.push({
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 + 10, vz: (Math.random() - 0.3) * 18,
      spin: 2 + Math.random() * 5, ph: Math.random() * 7, delay: Math.random() * 0.5,
      x: (Math.random() - 0.5) * 1.3, loop: 6 + Math.random() * 4, off: Math.random(),
      size: 0.8 + Math.random() * 0.7,
    });
    flakes.setColorAt(i, palette[i % palette.length]);
  }
  group.add(flakes);

  // Where things end up: worked out on a stand-in camera at the final framing, so the layout is
  // right on any screen shape and doesn't move while the real camera is still travelling.
  const hero = new THREE.PerspectiveCamera();
  let aspectCached = 0;
  const L = {};
  function layout() {
    const aspect = camera.aspect;
    if (aspect === aspectCached) return L;
    aspectCached = aspect;
    const portrait = aspect < 1.05;
    // Far enough back, and tilted little enough, that the bottom of the frame takes in the
    // fleet parked in front of the island rather than just the tips of its masts.
    const dist = portrait ? 66 : 82;
    const fov = portrait ? 66 : 50;
    const domeV = portrait ? -0.2 : -0.09;   // where the top of the lighthouse sits, -1..1
    hero.fov = fov;
    hero.aspect = aspect;
    hero.near = 0.5;
    hero.far = 900;
    hero.updateProjectionMatrix();
    const H = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const W = H * aspect;
    const lookY = 27.3 - domeV * H / 2;
    hero.position.set(0, 8, LH_Z + dist);
    hero.lookAt(0, lookY, LH_Z);
    hero.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(hero.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(hero.matrixWorld, 1);
    const fwd = new THREE.Vector3();
    hero.getWorldDirection(fwd);
    const centre = hero.position.clone().addScaledVector(fwd, dist / Math.max(0.4, fwd.z * -1));
    const at = (u, v) => centre.clone().addScaledVector(right, u * W / 2).addScaledVector(up, v * H / 2);

    let bulbH, textH, bulbAt, textAt, openAt, openH, logoCentre;
    if (portrait) {
      const textW = W * 0.8;
      textH = textW / LOGOTYPE_ASPECT;
      bulbH = Math.min(H * 0.17, textH * 0.95);
      const top = 0.93;
      const bulbV = top - bulbH / H;
      const textV = bulbV - (bulbH / 2 + textH / 2 + H * 0.012) * 2 / H;
      openH = textW / (1024 / 192) * 1.04;
      const openV = textV - (textH / 2 + openH / 2 + H * 0.008) * 2 / H;
      bulbAt = at(0, bulbV);
      textAt = at(0, textV);
      openAt = at(0, openV);
      logoCentre = at(0, (bulbV + textV) / 2);
      L.veilW = W * 1.3;
      L.veilH = H * 0.72;
    } else {
      const h = Math.min(H * 0.34, (W * 0.8) / (BULB_ASPECT + 0.1 + LOGOTYPE_ASPECT));
      bulbH = h;
      textH = h;
      const total = h * (BULB_ASPECT + 0.1 + LOGOTYPE_ASPECT);
      const logoV = 0.95 - h / H;
      bulbAt = at((-total / 2 + (BULB_ASPECT * h) / 2) * 2 / W, logoV);
      textAt = at((total / 2 - (LOGOTYPE_ASPECT * h) / 2) * 2 / W, logoV);
      openH = Math.min(H * 0.11, total * 0.14);
      openAt = at(0, logoV - (h / 2 + openH / 2 + H * 0.012) * 2 / H);
      logoCentre = at(0, logoV);
      L.veilW = total * 1.55;
      L.veilH = (h + openH) * 1.9;
    }
    Object.assign(L, {
      portrait, bulbH, textH, bulbAt, textAt, openAt, openH, logoCentre, right, up,
      rayStart: new THREE.Vector3(0, 40, LH_Z),
      raySize: Math.max(W, H) * 1.5,
      heroPos: hero.position.clone(),
      heroLook: new THREE.Vector3(0, lookY, LH_Z),
      heroFov: fov,
      heroQuat: hero.quaternion.clone(),
    });
    return L;
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const apex = new THREE.Vector3();
  const lantern = new THREE.Vector3(0, LANTERN_Y, LH_Z);
  const fired = new Set();
  let lastT = -1;

  function hide() {
    group.visible = false;
    fired.clear();
    lastT = -1;
    world.setDawn(0);
    world.setLantern(1);
    world.beams.userData.spin = true;
    world.beams.userData.fade = 1;
    world.beams.visible = true;
  }

  /**
   * Advance to time `t` and blend the camera from the view's own pose (`basePos`, `baseLook`,
   * `baseFov`) to the final framing.
   */
  function update(t, time, basePos, baseLook, baseFov) {
    const l = layout();
    group.visible = t >= 0;

    // Cues fire once, and only when actually crossed: a late joiner gets no burst of fanfares.
    for (const [name, at] of Object.entries(CUES)) {
      if (t >= at && !fired.has(name)) {
        fired.add(name);
        if (lastT >= 0 && t - at < 1) onCue(name);
      }
    }
    lastT = t;

    // Camera.
    const k = smooth(span(t, 0, 3));
    camera.position.lerpVectors(basePos, l.heroPos, k);
    const look = new THREE.Vector3().lerpVectors(baseLook, l.heroLook, k);
    camera.fov = THREE.MathUtils.lerp(baseFov, l.heroFov, k);
    camera.updateProjectionMatrix();
    camera.lookAt(look);
    if (isLed) world.setBoatScale(THREE.MathUtils.lerp(3.2, 1.5, k));

    // Lantern and beams.
    const on = span(t, 5.6, 6.0);
    const flare = 1 + smooth(span(t, 0.8, 2.4)) * 2.2;
    world.setLantern(flare - on * 1.5);
    world.beams.userData.spin = t < 0.8;
    world.beams.userData.fade = 1 - span(t, 0.4, 1.6);
    world.beams.visible = t < 1.7;

    // Dawn.
    world.setDawn(smooth(span(t, 5.6, 9)));

    // The bulb: out of the lantern to above the dome, then to its place in the logo.
    const rise = easeOut(span(t, 2.6, 5.0));
    const settle = smooth(span(t, 6.6, 8.0));
    const apexH = l.bulbH * 0.8;
    apex.set(0, 27.3 + 4 + apexH / 2 + 3, LH_Z);
    p.lerpVectors(lantern, apex, rise).lerp(l.bulbAt, settle);
    p.y += Math.sin(time * 1.4) * 0.15 * (1 - settle);
    bulb.position.copy(p);
    const scale = THREE.MathUtils.lerp(0.15 * apexH, apexH, rise) * (1 - settle) + l.bulbH * settle;
    bulb.scale.setScalar(scale);
    bulb.quaternion.copy(l.heroQuat);
    bulb.visible = t >= 2.6;

    // It flickers, then catches.
    const flick = t < 4.6 ? 0.1 : t < 4.85 ? 0.9 : t < 5.0 ? 0.15 : t < 5.2 ? 1 : t < 5.35 ? 0.3 : t < 5.6 ? 0.8 : 1;
    const level = t < 5.6 ? flick * 0.55 : 0.75 + Math.sin(time * 2.2) * 0.05;
    const { body, core, base } = bulb.userData;
    body.emissiveIntensity = level * 0.72;
    core.emissiveIntensity = level * 0.95;
    base.emissiveIntensity = 0.15 + level * 0.5;

    // Shaft of light under the rising bulb.
    const shaftA = span(t, 2.6, 3.0) * (1 - span(t, 4.6, 5.8));
    shaft.material.opacity = shaftA * 0.55;
    shaft.position.lerpVectors(lantern, bulb.position, 0.5);
    shaft.scale.set(Math.max(4, scale * 1.1), Math.max(6, bulb.position.y - LANTERN_Y + 12), 1);
    shaft.visible = shaftA > 0;

    // Glow round the bulb.
    // Behind the bulb: it's additive, so in front it would wash the bulb's colour out.
    glow.position.copy(bulb.position).addScaledVector(l.heroLook.clone().sub(l.heroPos).normalize(), 3);
    glow.scale.setScalar(scale * (2.4 + level * 2.4));
    glow.material.opacity = bulb.visible ? Math.min(1, 0.25 + level * 0.8) * (t < 5.6 ? flick : 1) : 0;

    // Rays: burst at 5.6, then drift over to centre on the whole logo.
    const raysIn = span(t, 5.6, 6.5);
    rays.visible = t >= 5.5;
    rays.position.copy(bulb.position).lerp(l.logoCentre, settle);
    rays.position.addScaledVector(l.heroLook.clone().sub(l.heroPos).normalize(), 2);
    rays.quaternion.copy(l.heroQuat);
    rays.scale.setScalar(l.raySize * (0.55 + easeOut(raysIn) * 0.45));
    rays.material.uniforms.uTime.value = time;
    rays.material.uniforms.uLevel.value = raysIn * (0.42 - span(t, 8.2, 10) * 0.16);
    rays.material.uniforms.uFlash.value = (1 - span(t, 5.6, 6.8)) * (t >= 5.6 ? 1.0 : 0);

    // Soft navy behind the white lettering, so it holds against the rays and the dawn.
    const write = span(t, 7.5, 9.0);   // starts once the bulb has moved clear of the lettering
    // Well behind the bulb's whole path, or it would pass in front of the bulb as it moves.
    veil.position.copy(l.logoCentre).addScaledVector(l.heroLook.clone().sub(l.heroPos).normalize(), 12);
    veil.quaternion.copy(l.heroQuat);
    veil.scale.set(l.veilW, l.veilH, 1);
    veil.material.opacity = smooth(span(t, 6.3, 7.4));
    veil.visible = t > 6.3;

    logotype.position.copy(l.textAt);
    logotype.quaternion.copy(l.heroQuat);
    logotype.scale.setScalar(l.textH);
    logotype.material.uniforms.uReveal.value = write;
    logotype.visible = t > 7.5;

    const pop = span(t, CUES.open, CUES.open + 0.5);
    openText.visible = t >= CUES.open;
    openText.position.copy(l.openAt);
    openText.quaternion.copy(l.heroQuat);
    openText.scale.setScalar(l.openH * (pop < 1 ? Math.max(0.01, back(pop)) : 1 + Math.sin(time * 2) * 0.012));
    openText.material.opacity = pop > 0 ? 1 : 0;

    // Confetti.
    flakes.visible = t >= CUES.open;
    if (flakes.visible) {
      const age0 = t - CUES.open;
      for (let i = 0; i < COUNT; i++) {
        const f = seeds[i];
        const a = age0 - f.delay;
        if (a < 0) { m4.makeScale(0, 0, 0); flakes.setMatrixAt(i, m4); continue; }
        if (a < 4.5) {
          // The burst, from the logo.
          p.copy(l.logoCentre);
          p.x += f.vx * a;
          p.y += f.vy * a - 7.5 * a * a * 0.5 * 2;
          p.z += f.vz * a;
        } else {
          // Then a steady drift down over the whole view, forever.
          const u = ((a - 4.5) / f.loop + f.off) % 1;
          p.set(f.x * l.raySize * 0.6, 72 - u * 76, LH_Z + 8 + f.vz * 1.2);
          p.x += Math.sin(a * 0.8 + f.ph) * 2;
        }
        e.set(a * f.spin + f.ph, a * f.spin * 0.7, f.ph);
        q.setFromEuler(e);
        s.setScalar(f.size);
        m4.compose(p, q, s);
        flakes.setMatrixAt(i, m4);
      }
      flakes.instanceMatrix.needsUpdate = true;
    }
  }

  return { update, hide, layout };
}
