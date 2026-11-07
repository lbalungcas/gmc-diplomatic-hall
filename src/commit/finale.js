/**
 * The finale: every word of every commitment flies into place, and the words themselves make the
 * bulb. Then it catches, the rays burst, the sea turns to dawn, and the logo writes on beside it,
 * mirroring the morning's opening.
 *
 * All the words are one instanced draw call, and their flight is worked out in the vertex shader
 * from `t` alone, so thousands of them cost almost nothing per frame and a refreshed screen lands in
 * the right moment. It draws in screen pixels on top of the sea (y up, origin bottom left).
 */
import * as THREE from 'three';
import { radialTexture } from '../sail/world.js';
import { raysMaterial, logotypeMaterial, bulbOutlines } from '../sail/opening.js';
import { layoutMosaic, seededShuffle } from './mosaic.js';
import { T } from './timeline.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (v) => v * v * (3 - 2 * v);
const LOGOTYPE_ASPECT = 1686 / 936;
const BULB_ASPECT = 232 / 311;
const FONT = 'Fredoka, system-ui, sans-serif';
const TINTS = { hex: '#F2C667', core: '#FFF1C9', chev: '#FFFFFF' };
const CONFETTI = ['#F2C667', '#E9B4BB', '#9CCCE3', '#DD9366', '#FFFFFF', '#2F7BC4'];

/** Draws the bulb onto a square canvas, with its rounded corners. */
function drawBulb(ctx, S, colors) {
  const { hex, core, chevron } = bulbOutlines();
  const X = (p) => (0.5 + p[0]) * S;
  const Y = (p) => (0.5 - p[1]) * S;
  const shape = (pts, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    const n = pts.length;
    const mid = (a, b) => [(X(a) + X(b)) / 2, (Y(a) + Y(b)) / 2];
    const m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const b = pts[(i + 1) % n];
      ctx.arcTo(X(pts[i]), Y(pts[i]), X(b), Y(b), r * S);
    }
    ctx.closePath();
    ctx.fill();
  };
  shape(hex, 0.085, colors.hex);
  shape(core, 0.03, colors.core);
  shape(chevron, 0.035, colors.chev);
}

/** Where the inside of the bulb is, row by row, and which part each point is in. */
function bulbMask() {
  const M = 512;
  const c = document.createElement('canvas');
  c.width = c.height = M;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  drawBulb(ctx, M, { hex: '#f00', core: '#0f0', chev: '#00f' });
  const { data } = ctx.getImageData(0, 0, M, M);
  let filled = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) filled++;
  return {
    area: filled / (M * M),
    spansAt(y) {
      const row = Math.min(M - 1, Math.floor(y * M));
      const runs = [];
      let start = -1;
      for (let x = 0; x <= M; x++) {
        const inside = x < M && data[(row * M + x) * 4 + 3] > 128;
        if (inside && start < 0) start = x;
        if (!inside && start >= 0) {
          runs.push([start / M, x / M]);
          start = -1;
        }
      }
      return runs;
    },
    partAt(x, y) {
      const i = (Math.min(M - 1, Math.floor(y * M)) * M + Math.min(M - 1, Math.floor(x * M))) * 4;
      if (data[i + 1] > 128) return 'core';
      if (data[i + 2] > 128) return 'chev';
      return 'hex';
    },
  };
}

/** One atlas for every distinct word, white on transparent; the shader colours them. */
function buildAtlas(words, maxSize) {
  const S = Math.min(4096, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  for (const fontPx of [46, 32, 22, 15]) {
    ctx.clearRect(0, 0, S, S);
    ctx.font = `500 ${fontPx}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    const cell = Math.ceil(fontPx * 1.3);
    const pad = 6;
    const map = new Map();
    let x = pad;
    let y = pad;
    let ok = true;
    for (const w of words) {
      const width = Math.ceil(ctx.measureText(w).width) + 2;
      if (x + width + pad > S) {
        x = pad;
        y += cell + pad;
      }
      if (y + cell + pad > S) {
        ok = false;
        break;
      }
      ctx.fillText(w, x + 1, y + cell / 2);
      map.set(w, { u: x / S, v: 1 - (y + cell) / S, uw: width / S, vh: cell / S, aspect: width / cell });
      x += width + pad;
    }
    if (ok) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      return { tex, map };
    }
  }
  throw new Error('too many distinct words for the atlas');
}

const wordsVertex = /* glsl */`
  attribute vec3 aStart;     // x, y, size
  attribute vec3 aEnd;
  attribute vec4 aUv;
  attribute vec4 aMeta;      // delay, swirl, ghost, aspect
  attribute vec3 aTint;
  attribute float aOnDark;   // 1 for words on the bulb's navy base, which go light rather than navy
  uniform float uT, uDur, uDetach, uHot, uBack, uDim, uScale;
  uniform vec2 uC, uC2;
  uniform vec3 uInk, uWarm, uWhite;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    float k = clamp((uT - aMeta.x) / uDur, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    vec2 a = aStart.xy - uC;
    vec2 b = aEnd.xy - uC;
    float a0 = atan(a.y, a.x);
    float d = atan(b.y, b.x) - a0;
    d = mod(d + 3.14159265, 6.2831853) - 3.14159265;
    float r = mix(length(a), length(b), k);
    // The swirl is zero at both ends of the flight, so every word lands exactly on its place.
    float ang = a0 + d * k + aMeta.y * 6.2831853 * sin(3.14159265 * k);
    vec2 pos = uC + r * vec2(cos(ang), sin(ang));
    pos = uC2 + (pos - uC) * uScale;
    float size = mix(aStart.z, aEnd.z, k) * uScale;
    vec2 p = pos + position.xy * vec2(size * aMeta.w, size);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
    vUv = aUv.xy + uv * aUv.zw;
    vec3 c = mix(uInk, uWarm, uDetach);
    c = mix(c, aTint * uDim, k);
    vCol = mix(mix(c, uWhite, uHot), mix(uInk, uWhite, aOnDark), uBack);
    vA = aMeta.z > 0.5 ? k : 1.0;
  }`;
const wordsFragment = /* glsl */`
  uniform sampler2D map;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    float a = texture2D(map, vUv).a * vA * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCol, a);
    #include <colorspace_fragment>
  }`;

export async function createFinale(world, { onCue = () => {} } = {}) {
  const { renderer } = world;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -100, 100);
  const mask = bulbMask();

  const logoMap = await new THREE.TextureLoader().loadAsync('/sail/logotype.webp');
  logoMap.colorSpace = THREE.SRGBColorSpace;
  logoMap.anisotropy = 8;

  const plane = new THREE.PlaneGeometry(1, 1);
  const layer = (mesh, order) => {
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };

  const rays = layer(new THREE.Mesh(plane, raysMaterial()), 1);
  rays.material.depthTest = false;
  const veil = layer(new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(14,30,70,0.82)'], [0.55, 'rgba(14,30,70,0.6)'], [1, 'rgba(14,30,70,0)']]),
    transparent: true, depthWrite: false, depthTest: false, opacity: 0,
  })), 2);
  const glow = layer(new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map: world.glowTex, color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0,
  })), 3);

  const bulbCanvas = document.createElement('canvas');
  bulbCanvas.width = bulbCanvas.height = 1024;
  drawBulb(bulbCanvas.getContext('2d'), 1024, { hex: TINTS.hex, core: '#F8DFA5', chev: '#FFFFFF' });
  const bulbTex = new THREE.CanvasTexture(bulbCanvas);
  bulbTex.colorSpace = THREE.SRGBColorSpace;
  bulbTex.anisotropy = 8;
  const silhouette = layer(new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map: bulbTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0, toneMapped: false,
  })), 4);

  // The white base would vanish into the rays, so it is navy while the bulb is lit (the logo's own
  // colour on a light background), turning white again as the logo lands on the dark veil.
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = baseCanvas.height = 1024;
  drawBulb(baseCanvas.getContext('2d'), 1024, { hex: 'rgba(0,0,0,0)', core: 'rgba(0,0,0,0)', chev: '#1B3461' });
  const baseTex = new THREE.CanvasTexture(baseCanvas);
  baseTex.colorSpace = THREE.SRGBColorSpace;
  baseTex.anisotropy = 8;
  const navyBase = layer(new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map: baseTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0, toneMapped: false,
  })), 4.5);

  const logotype = layer(new THREE.Mesh(plane, logotypeMaterial(logoMap)), 6);

  const wordsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, vertexShader: wordsVertex, fragmentShader: wordsFragment,
    uniforms: {
      map: { value: null }, uT: { value: 0 }, uDur: { value: T.flyDur }, uDetach: { value: 0 }, uHot: { value: 0 }, uBack: { value: 0 }, uDim: { value: 1 },
      uScale: { value: 1 }, uAlpha: { value: 1 }, uC: { value: new THREE.Vector2() }, uC2: { value: new THREE.Vector2() },
      uInk: { value: new THREE.Color('#1B3461') }, uWarm: { value: new THREE.Color('#FFF3D6') }, uWhite: { value: new THREE.Color('#FFFDF2') },
    },
  });
  let words = null;
  let atlas = null;

  const COUNT = 320;
  const flakes = layer(new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 0.6),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, depthTest: false, transparent: true }),
    COUNT,
  ), 7);
  const palette = CONFETTI.map((c) => new THREE.Color(c));
  const seeds = Array.from({ length: COUNT }, (_, i) => {
    flakes.setColorAt(i, palette[i % palette.length]);
    return {
      x: Math.random(), off: Math.random(), speed: 0.07 + Math.random() * 0.1, sway: 10 + Math.random() * 26,
      spin: 2 + Math.random() * 5, ph: Math.random() * 7, size: 7 + Math.random() * 11, delay: Math.random() * 1.6,
    };
  });

  let L = null;
  let lastItems = [];
  let lastRects = new Map();

  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    camera.left = 0;
    camera.right = W;
    camera.top = H;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    const heroH = H * 0.55;
    const hero = new THREE.Vector2(W / 2, H * 0.6);
    const h = Math.min(H * 0.3, (W * 0.74) / (BULB_ASPECT + 0.1 + LOGOTYPE_ASPECT));
    const total = h * (BULB_ASPECT + 0.1 + LOGOTYPE_ASPECT);
    const logoY = H * 0.97 - h / 2;
    L = {
      W, H, heroH, hero, h, logoY,
      bulbAt: new THREE.Vector2(W / 2 - total / 2 + (BULB_ASPECT * h) / 2, logoY),
      textAt: new THREE.Vector2(W / 2 + total / 2 - (LOGOTYPE_ASPECT * h) / 2, logoY),
      veilAt: new THREE.Vector2(W / 2, logoY - h * 0.25),
      veilW: total * 1.7,
      veilH: h * 2.6,
    };
  }

  function build(items, rects) {
    layout();
    if (words) {
      scene.remove(words);
      words.geometry.dispose();
      words = null;
    }
    if (atlas) {
      atlas.tex.dispose();
      atlas = null;
    }
    const tokens = [];
    for (const item of items) {
      const placed = rects.get(item.id);
      item.text.split(/\s+/).filter(Boolean).forEach((word, i) => {
        tokens.push({ word, start: placed && placed[i] });
      });
    }
    if (!tokens.length) return;
    atlas = buildAtlas([...new Set(tokens.map((t) => t.word))], renderer.capabilities.maxTextureSize);
    const aspects = tokens.map((t) => atlas.map.get(t.word).aspect);
    const { slots } = layoutMosaic(aspects, mask.spansAt, mask.area);

    const n = slots.length;
    const aStart = new Float32Array(n * 3);
    const aEnd = new Float32Array(n * 3);
    const aUv = new Float32Array(n * 4);
    const aMeta = new Float32Array(n * 4);
    const aTint = new Float32Array(n * 3);
    const aOnDark = new Float32Array(n);
    const tints = Object.fromEntries(Object.entries(TINTS).map(([k, v]) => [k, new THREE.Color(v)]));
    const order = seededShuffle(n, 31);
    const R = Math.hypot(L.W, L.H) * 0.62;
    slots.forEach((slot, i) => {
      const tok = tokens[slot.word];
      const a = atlas.map.get(tok.word);
      const ex = L.hero.x + (slot.x - 0.5) * L.heroH;
      const ey = L.hero.y - (slot.y - 0.5) * L.heroH;
      const size = slot.size * L.heroH;
      const rnd = order[i] / n;
      let sx;
      let sy;
      let ss;
      let delay;
      if (!slot.ghost && tok.start) {
        // From exactly where it sits on its card.
        sx = tok.start.x;
        sy = L.H - tok.start.y;
        ss = tok.start.size;
        delay = T.flyFrom + rnd * 2.6;
      } else if (!slot.ghost) {
        // Commitments not showing at this moment sweep in from beyond the edges of the screen.
        const ang = rnd * Math.PI * 2 * 7.3;
        sx = L.W / 2 + Math.cos(ang) * R;
        sy = L.H / 2 + Math.sin(ang) * R;
        ss = Math.max(size, 16);
        delay = T.flyFrom + 0.8 + rnd * (T.flyTo - T.flyFrom - 0.8);
      } else {
        // A repeat, filling out the shape when there are few commitments: it fades up in place.
        sx = ex + (rnd - 0.5) * 60;
        sy = ey + ((rnd * 37) % 1 - 0.5) * 60;
        ss = size;
        delay = T.flyTo - 1 + rnd * 2;
      }
      aStart.set([sx, sy, ss], i * 3);
      aEnd.set([ex, ey, size], i * 3);
      aUv.set([a.u, a.v, a.uw, a.vh], i * 4);
      aMeta.set([delay, slot.ghost ? 0 : (rnd - 0.5) * 0.9, slot.ghost ? 1 : 0, (slot.size === 0 ? 1 : a.aspect)], i * 4);
      const part = mask.partAt(slot.x, slot.y);
      const tint = tints[part];
      aTint.set([tint.r, tint.g, tint.b], i * 3);
      aOnDark[i] = part === 'chev' ? 1 : 0;
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(aStart, 3));
    geo.setAttribute('aEnd', new THREE.InstancedBufferAttribute(aEnd, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 4));
    geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(aMeta, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute('aOnDark', new THREE.InstancedBufferAttribute(aOnDark, 1));
    geo.instanceCount = n;
    wordsMat.uniforms.map.value = atlas.tex;
    words = new THREE.Mesh(geo, wordsMat);
    words.frustumCulled = false;
    words.renderOrder = 5;
    scene.add(words);
  }

  window.addEventListener('resize', () => {
    if (L) build(lastItems, new Map());     // the cards are long gone by the time anyone resizes
  });

  const fired = new Set();
  let lastT = -1;
  const CUE_AT = { rise: T.rise, on: T.ignite, write: T.write, open: T.close };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector2();

  return {
    prepare(items, rects) {
      lastItems = items;
      lastRects = rects;
      build(items, rects);
    },

    hide() {
      for (const o of [rays, veil, glow, silhouette, navyBase, logotype, flakes]) o.visible = false;
      if (words) words.visible = false;
      fired.clear();
      lastT = -1;
      world.setDawn(0);
      world.setLantern(1);
      world.beams.userData.fade = 1;
      world.beams.visible = true;
    },

    update(t, time) {
      if (!L) layout();
      // Sound cues fire only when actually crossed: a refresh mid-finale gets no burst of fanfares.
      for (const [name, at] of Object.entries(CUE_AT)) {
        if (t >= at && !fired.has(name)) {
          fired.add(name);
          if (lastT >= 0 && t - at < 1) onCue(name);
        }
      }
      lastT = t;

      // The stutter, then the catch.
      const flick = t < T.flicker ? 0 : t < T.flicker + 0.22 ? 0.75 : t < T.flicker + 0.4 ? 0.05
        : t < T.flicker + 0.6 ? 0.95 : t < T.flicker + 0.75 ? 0.15 : t < T.ignite ? 0.6 : 1;
      const lit = span(t, T.ignite, T.ignite + 0.5);
      const hot = t < T.ignite ? flick * 0.8 : 1 - span(t, T.ignite + 0.5, T.settle) * 0.45;

      // The bulb moves into the logo.
      const k = smooth(span(t, T.settle, T.write + 0.4));
      const scale = THREE.MathUtils.lerp(1, L.h / L.heroH, k);
      pos.lerpVectors(L.hero, L.bulbAt, k);
      const size = L.heroH * scale;

      // World: lantern, beams, dawn.
      world.setDawn(smooth(span(t, T.ignite, T.ignite + 6)));
      world.setLantern(1 + flick * 1.2 - lit * 1.2);
      world.beams.userData.fade = 1 - span(t, T.ignite - 1.2, T.ignite);
      world.beams.visible = t < T.ignite;

      // Words.
      if (words) {
        const alpha = 1 - smooth(span(t, T.settle + 1, T.write + 0.4));
        const u = wordsMat.uniforms;
        u.uT.value = t;
        u.uDetach.value = span(t, T.dissolve, T.dissolve + 1.2);
        u.uHot.value = hot;
        // Once the bulb behind them turns solid, the words go navy: still readable inside the light.
        u.uBack.value = smooth(span(t, T.ignite + 0.5, T.ignite + 2));
        u.uDim.value = 1;
        u.uScale.value = scale;
        u.uAlpha.value = alpha;
        u.uC.value.copy(L.hero);
        u.uC2.value.copy(pos);
        words.visible = t >= T.dissolve && alpha > 0;
      }

      // The bulb behind them: a whisper of the shape, then solid as the words hand over to it.
      const noWords = !words;
      const sil = noWords
        ? smooth(span(t, T.flyFrom, T.ignite))
        : t < T.ignite ? 0.16 * smooth(span(t, T.flyTo, T.flyTo + 3)) : 0.16 + 0.84 * smooth(span(t, T.ignite + 0.3, T.ignite + 1.8));
      silhouette.visible = sil > 0.001;
      silhouette.position.set(pos.x, pos.y, 0);
      silhouette.scale.set(size, size, 1);
      silhouette.material.opacity = sil;
      const navy = smooth(span(t, T.ignite + 0.3, T.ignite + 1.8)) * (1 - smooth(span(t, T.settle + 1, T.write + 0.4)));
      navyBase.visible = navy > 0.001;
      navyBase.position.copy(silhouette.position);
      navyBase.scale.copy(silhouette.scale);
      navyBase.material.opacity = navy;

      // Glow.
      const glowLevel = t < T.ignite ? flick * 0.6 + 0.12 * smooth(span(t, T.flyTo, T.flicker)) : 0.85 - span(t, T.ignite, T.settle + 2) * 0.45;
      glow.visible = t > T.flyTo;
      glow.position.set(pos.x, pos.y, 0);
      glow.scale.setScalar(size * (1.9 + lit * 1.1));
      glow.material.opacity = glowLevel;

      // Rays, from the bulb, then drifting to centre on the logo.
      rays.visible = t >= T.ignite - 0.05;
      rays.position.set(THREE.MathUtils.lerp(L.hero.x, L.W / 2, k), pos.y, 0);
      rays.scale.setScalar(Math.max(L.W, L.H) * (0.9 + lit * 1.0));
      rays.material.uniforms.uTime.value = time;
      rays.material.uniforms.uLevel.value = lit * (0.5 - span(t, T.settle, T.close) * 0.2);
      rays.material.uniforms.uFlash.value = t >= T.ignite ? (1 - span(t, T.ignite, T.ignite + 1.3)) * 1.1 : 0;

      // The logo.
      const vA = smooth(span(t, T.settle + 0.8, T.write + 0.5));
      veil.visible = vA > 0;
      veil.position.set(L.veilAt.x, L.veilAt.y, 0);
      veil.scale.set(L.veilW, L.veilH, 1);
      veil.material.opacity = vA;
      logotype.visible = t >= T.write;
      logotype.position.set(L.textAt.x, L.textAt.y, 0);
      logotype.scale.set(L.h * LOGOTYPE_ASPECT, L.h, 1);
      logotype.material.uniforms.uReveal.value = span(t, T.write, T.close - 0.2);

      // Confetti: position purely from time, so it needs no state.
      flakes.visible = t >= T.close;
      if (flakes.visible) {
        const age = t - T.close;
        for (let i = 0; i < COUNT; i++) {
          const f = seeds[i];
          const a = age - f.delay;
          if (a < 0) {
            m4.makeScale(0, 0, 0);
            flakes.setMatrixAt(i, m4);
            continue;
          }
          const u = (a * f.speed + f.off * Math.min(1, a / 3)) % 1;
          p.set(f.x * L.W + Math.sin(a * 0.9 + f.ph) * f.sway, L.H * 1.05 - u * L.H * 1.1, 0);
          e.set(a * f.spin + f.ph, a * f.spin * 0.7, f.ph);
          q.setFromEuler(e);
          s.setScalar(f.size);
          m4.compose(p, q, s);
          flakes.setMatrixAt(i, m4);
        }
        flakes.instanceMatrix.needsUpdate = true;
      }
    },

    render() {
      renderer.render(scene, camera);
    },

    /** For checking the layout: how many words made it in. */
    stats: () => ({ slots: words ? words.geometry.instanceCount : 0, items: lastItems.length, rects: lastRects.size }),
  };
}
