/**
 * The sea, the sky, the lighthouse and the fleet: everything the phone and LED views share.
 *
 * Built for phones first. The sea and sky are unlit shaders in the brand's flat illustrated
 * palette, there are no shadows or post-processing, and however many boats there are, the fleet
 * is two instanced draw calls (hull + Tutu, and the sails, which take a colour per boat).
 *
 * Route: boats sail straight along -z, from z = 0 to z = -ROUTE, toward the lighthouse. Each boat
 * has a fixed place in a sunflower spiral, so they never sit on top of each other, and it stays
 * valid however many boats join.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ROUTE = 150;
export const LH_Z = -176;              // the lighthouse's centre; its island reaches about z = -163
export const LANTERN_Y = 22.55;
export const DOME_TOP_Y = 27.3;
const SAIL_COLORS = ['#EDAFB8', '#F2C667', '#9CCCE3', '#DD9366', '#FFFFFF', '#BFE3C8'];

/** The wave height at a point: the same formula as the sea's vertex shader. */
export function waveAt(x, z, t) {
  return 0.20 * Math.sin(x * 0.18 + t * 1.1) + 0.16 * Math.sin(z * 0.25 + t * 1.4) + 0.08 * Math.sin((x + z) * 0.5 + t * 2.1);
}

/** Where boat `n` sails: x is its lane; z runs from its start to its parking spot off the island. */
export function boatPosition(n, p, spread = 1) {
  const r = Math.sqrt(n + 1) * 3.1 * spread;
  const a = n * 2.39996;
  const off = r * Math.sin(a) * 0.6;
  return { x: r * Math.cos(a), z: -ROUTE * p + (off > 0 ? off : off * 0.3) };
}

function flatten(node) {
  node.updateWorldMatrix(true, true);
  const parts = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const count = src.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const c = o.material.color;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(src.attributes.position, i).applyMatrix4(o.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(src.attributes.normal, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (src.index) g.setIndex(Array.from(src.index.array));
    parts.push(g);
  });
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

function makeSea() {
  const geo = new THREE.PlaneGeometry(900, 900, 56, 56);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uDawn: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uIsland: { value: new THREE.Vector2(0, LH_Z) }, uWaveScale: { value: 1 }, uWaveAxis: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y = 0.20 * sin(w.x * 0.18 + uTime * 1.1) + 0.16 * sin(w.z * 0.25 + uTime * 1.4)
            + 0.08 * sin((w.x + w.z) * 0.5 + uTime * 2.1);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uDawn, uWaveScale, uWaveAxis;
      uniform vec3 uCam;
      uniform vec2 uIsland;
      varying vec3 vW;
      void main() {
        float d = length(vW.xz - uCam.xz);
        // Rows of scalloped crests, after the waves in the client's art, rolling toward the viewer.
        // Rows of waves run across the view: the phone looks along z, the LED along x.
        vec2 wp = (uWaveAxis > 0.5 ? vW.zx : vW.xz) * uWaveScale;
        float roll = wp.y * 0.30 + sin(wp.x * 0.22 + uTime * 0.30) * 0.42 - uTime * 0.28;
        float band = fract(roll);
        float near = 1.0 - smoothstep(60.0 / uWaveScale, 210.0 / uWaveScale, d);
        // Each row of crests is broken into separate arcs, offset row to row, like the art.
        float arcs = smoothstep(0.05, 0.55, sin(wp.x * 0.28 + floor(roll) * 2.4 + uTime * 0.12));
        float crest = smoothstep(0.66, 0.74, band) * (1.0 - smoothstep(0.80, 0.92, band)) * near * arcs;
        float roll2 = wp.y * 0.035 + sin(wp.x * 0.03 - uTime * 0.1) * 0.22 + uTime * 0.03;
        float swell = 0.5 + 0.5 * sin(roll2 * 6.283);
        vec3 deep = mix(vec3(0.020, 0.135, 0.270), vec3(0.030, 0.265, 0.450), uDawn);
        vec3 mid  = mix(vec3(0.030, 0.220, 0.400), vec3(0.060, 0.400, 0.610), uDawn);
        vec3 lite = mix(vec3(0.200, 0.480, 0.640), vec3(0.420, 0.760, 0.860), uDawn);
        vec3 col = mix(deep, mid, swell);
        col = mix(col, lite, crest * 0.62);
        // Foam where the sea meets the island.
        float isl = length(vW.xz - uIsland);
        float foam = (1.0 - smoothstep(12.5, 15.5, isl)) * (0.55 + 0.45 * sin(isl * 3.5 - uTime * 1.6));
        col = mix(col, vec3(0.86, 0.94, 0.97), clamp(foam, 0.0, 1.0) * 0.8);
        // A path of light on the water, off the lantern, then off the sunrise behind it.
        float path = exp(-pow(vW.x * 0.055, 2.0)) * smoothstep(40.0, -170.0, vW.z) * (0.5 + 0.5 * swell);
        col += path * mix(vec3(0.10, 0.08, 0.03), vec3(0.42, 0.28, 0.10), uDawn);
        vec3 horizon = mix(vec3(0.040, 0.100, 0.260), vec3(0.930, 0.620, 0.350), uDawn);
        col = mix(col, horizon, smoothstep(170.0, 430.0, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.frustumCulled = false;
  sea.name = 'Sea';
  return sea;
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uDawn: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uDawn, uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 nightTop = vec3(0.012, 0.030, 0.095), nightLow = vec3(0.040, 0.100, 0.260);
        vec3 dawnTop = vec3(0.045, 0.190, 0.430), dawnMid = vec3(0.420, 0.420, 0.560), dawnLow = vec3(0.930, 0.620, 0.350);
        vec3 night = mix(nightLow, nightTop, smoothstep(0.0, 0.5, h));
        vec3 dawn = mix(dawnLow, dawnMid, smoothstep(0.0, 0.10, h));
        dawn = mix(dawn, dawnTop, smoothstep(0.08, 0.42, h));
        vec3 col = mix(night, dawn, uDawn);
        // Stars, fading with the dawn.
        vec2 g = vec2(atan(vDir.z, vDir.x), asin(clamp(vDir.y, -1.0, 1.0))) * 70.0;
        vec2 id = floor(g);
        float s = step(0.965, hash(id));
        float tw = 0.6 + 0.4 * sin(uTime * 1.5 + hash(id + 3.1) * 40.0);
        float dotm = 1.0 - smoothstep(0.02, 0.17, length(fract(g) - 0.5));
        col += s * dotm * tw * smoothstep(0.03, 0.25, h) * (1.0 - uDawn) * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = 'Sky';
  return sky;
}

function wakeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 128);
  // A V of foam, narrow at the bow (top), fading astern.
  for (let y = 0; y < 128; y++) {
    const k = y / 128;
    const half = 4 + k * 26;
    const a = (1 - k) * (1 - k);
    ctx.fillStyle = `rgba(255,255,255,${(0.75 * a).toFixed(3)})`;
    ctx.fillRect(32 - half - 2.5, y, 5 + k * 3, 1);
    ctx.fillRect(32 + half - 2.5 - k * 3, y, 5 + k * 3, 1);
    ctx.fillStyle = `rgba(255,255,255,${(0.12 * a).toFixed(3)})`;
    ctx.fillRect(32 - half, y, half * 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function radialTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function youMarker() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(58, 8, 140, 70, 34);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(110, 76);
  ctx.lineTo(146, 76);
  ctx.lineTo(128, 118);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1B3461';
  ctx.font = '700 48px Fredoka, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOU', 128, 45);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(2.6, 1.3, 1);
  s.renderOrder = 5;
  return s;
}

export async function createWorld(canvas, { isLed = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const maxDpr = Math.min(window.devicePixelRatio || 1, isLed ? 2 : 1.75);
  let dpr = maxDpr;
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20405f, 1.15);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(30, 60, 40);
  scene.add(hemi, sun);

  const sky = makeSky();
  const sea = makeSea();
  scene.add(sky, sea);

  const gltf = await new Promise((res, rej) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load('/models/sail_set.glb', res, undefined, rej);
  });
  const set = gltf.scene;
  set.updateMatrixWorld(true);

  // --- Lighthouse.
  const lighthouse = new THREE.Mesh(
    flatten(set.getObjectByName('Lighthouse')),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  lighthouse.position.set(0, 0, LH_Z);
  lighthouse.name = 'Lighthouse';
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false });
  const lantern = new THREE.Mesh(flatten(set.getObjectByName('LanternGlow')), lanternMat);
  lantern.position.copy(lighthouse.position);
  scene.add(lighthouse, lantern);

  const glowTex = radialTexture();
  const lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  lanternGlow.position.set(0, LANTERN_Y, LH_Z);
  lanternGlow.scale.setScalar(20);
  scene.add(lanternGlow);

  // Sweeping beams: two long thin cones, additive.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0.16 } },
    vertexShader: 'varying float vK; void main() { vK = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // uv.y runs from the far end (0) to the lantern (1).
    fragmentShader: 'uniform float uOpacity; varying float vK; void main() { gl_FragColor = vec4(vec3(1.0, 0.91, 0.66) * uOpacity * vK * vK * vK, 1.0); }',
  });
  const beamGeo = new THREE.ConeGeometry(11, 170, 12, 1, true);
  beamGeo.translate(0, -85, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beams = new THREE.Group();
  beams.position.set(0, LANTERN_Y, LH_Z);
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI;
  beams.add(beamA, beamB);
  scene.add(beams);

  // --- Fleet.
  const hullGeo = mergeGeometries([flatten(set.getObjectByName('Boat')), flatten(set.getObjectByName('Tutu'))], false);
  const sailGeo = flatten(set.getObjectByName('BoatSail'));
  const CAP = isLed ? 620 : 42;
  const hulls = new THREE.InstancedMesh(hullGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), CAP);
  const sails = new THREE.InstancedMesh(sailGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), CAP);
  hulls.frustumCulled = sails.frustumCulled = false;
  hulls.name = 'Fleet_Hulls';
  sails.name = 'Fleet_Sails';
  const wakeGeo = new THREE.PlaneGeometry(4.4, 9);
  wakeGeo.rotateX(-Math.PI / 2);
  wakeGeo.translate(0, 0.05, 3.2);
  const wakes = new THREE.InstancedMesh(wakeGeo, new THREE.MeshBasicMaterial({
    map: wakeTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }), CAP);
  wakes.frustumCulled = false;
  scene.add(wakes, hulls, sails);
  const sailColors = SAIL_COLORS.map((c) => new THREE.Color(c));
  const colorTmp = new THREE.Color();
  // Touch every instance colour once so the attributes exist.
  for (let i = 0; i < CAP; i++) {
    sails.setColorAt(i, sailColors[0]);
    wakes.setColorAt(i, colorTmp.setScalar(0));
  }

  const marker = youMarker();
  marker.visible = false;
  const ringMat = new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0)'], [0.75, 'rgba(255,255,255,0.9)'], [0.92, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), ringMat);
  ring.visible = false;
  scene.add(marker, ring);

  // --- State shared with the views.
  const shown = new Map();     // n -> displayed progress and speed
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let dawn = 0;
  let lanternLevel = 1;
  let boatScale = isLed ? 3.2 : 1;
  const spread = isLed ? 2.1 : 1;
  sea.material.uniforms.uWaveScale.value = isLed ? 0.42 : 1;
  sea.material.uniforms.uWaveAxis.value = isLed ? 1 : 0;

  function setDawn(v) {
    dawn = v;
    sea.material.uniforms.uDawn.value = v;
    sky.material.uniforms.uDawn.value = v;
    hemi.intensity = 1.75 + v * 0.7;
    hemi.color.set(0xbfd4ff).lerp(new THREE.Color(0xfff2e0), v);
    sun.intensity = 2.2 + v * 0.7;
    sun.color.set(0xdfe6ff).lerp(new THREE.Color(0xffe2bc), v);
    const beamFade = 1 - Math.min(1, v * 2);
    beamMat.uniforms.uOpacity.value = 0.5 * beamFade * (beams.userData.fade ?? 1);
  }
  setDawn(0);

  function setLantern(level) {
    lanternLevel = level;
    lanternMat.color.setRGB(1.0 * level, 0.85 * level, 0.45 * level);
    lanternGlow.scale.setScalar(18 + level * 8);
    lanternGlow.material.opacity = Math.min(1, 0.55 + level * 0.2);
  }
  setLantern(1);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  // Drop resolution if the device is struggling; the phone in someone's hand is what matters.
  let slow = 0;
  function governor(dt) {
    if (dt > 1 / 28) slow += dt; else slow = Math.max(0, slow - dt * 0.5);
    if (slow > 1.6 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      resize();
      slow = 0;
    }
  }

  /**
   * Places the fleet. `boats` is an iterable of { n, p, rank }; `self` is the viewer's own number,
   * and its progress is taken as given rather than smoothed. Only the nearest boats are drawn on
   * a phone; the LED draws everyone.
   */
  function updateFleet(boats, t, dt, { self = -1, selfP = 0, glide = false, selfRock = 0 } = {}) {
    let list = [];
    for (const b of boats) {
      let s = shown.get(b.n);
      if (!s) {
        s = { p: b.p, v: 0 };
        shown.set(b.n, s);
      }
      const prev = s.p;
      if (b.n === self) {
        s.p = selfP;
      } else {
        const target = glide ? 1 : b.p;
        if (target < s.p) s.p = target;       // a reset
        else if (glide) s.p = Math.min(1, s.p + dt / 9);
        else s.p += (target - s.p) * (1 - Math.exp(-dt * 4));
      }
      s.v += ((s.p - prev) / Math.max(dt, 1e-3) - s.v) * Math.min(1, dt * 3);
      list.push({ n: b.n, s });
    }
    if (list.length > CAP) {
      const cap = CAP - 1;
      list = list
        .map((row) => ({ row, d: row.n === self ? -1 : Math.abs(row.s.p - selfP) + row.n * 1e-5 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, cap + 1)
        .map((r) => r.row);
    }
    let selfPos = null;
    list.forEach(({ n, s }, i) => {
      const { x, z } = boatPosition(n, s.p, spread);
      const speed = Math.min(1, Math.abs(s.v) * 15);
      const phase = n * 1.37;
      const y = waveAt(x, z, t) * 0.9 + 0.02 + Math.sin(t * 1.3 + phase) * 0.05;
      e.set(
        Math.sin(t * 1.1 + phase) * 0.035 - speed * 0.05,
        Math.sin(t * 0.4 + phase) * 0.012,
        Math.sin(t * 0.9 + phase * 2) * 0.045 + (n === self ? selfRock : 0),
      );
      q.setFromEuler(e);
      pos.set(x, y, z);
      // On a phone, a boat right beside the camera would fill the screen: it ducks out of the way.
      const near = isLed || n === self ? 1 : THREE.MathUtils.smoothstep(camera.position.distanceTo(pos), 7, 13);
      scl.setScalar(boatScale * Math.max(near, 0.001));
      m4.compose(pos, q, scl);
      hulls.setMatrixAt(i, m4);
      sails.setMatrixAt(i, m4);
      wakes.setMatrixAt(i, m4);
      sails.setColorAt(i, n === self ? sailColors[0] : sailColors[n % sailColors.length]);
      wakes.setColorAt(i, colorTmp.setScalar(speed * 0.42));
      if (n === self) selfPos = { x, y, z };
    });

    hulls.count = sails.count = wakes.count = list.length;
    hulls.instanceMatrix.needsUpdate = sails.instanceMatrix.needsUpdate = wakes.instanceMatrix.needsUpdate = true;
    if (sails.instanceColor) sails.instanceColor.needsUpdate = true;
    if (wakes.instanceColor) wakes.instanceColor.needsUpdate = true;

    if (selfPos) {
      marker.visible = ring.visible = true;
      marker.position.set(selfPos.x, selfPos.y + 5.2 * boatScale + Math.sin(t * 2.4) * 0.12, selfPos.z);
      ring.position.set(selfPos.x, 0.12, selfPos.z);
      ring.scale.setScalar(1 + (t * 0.6) % 1 * 0.5);
      ringMat.opacity = 1 - ((t * 0.6) % 1);
    } else {
      marker.visible = ring.visible = false;
    }
    return selfPos;
  }

  function frame(t, dt) {
    sea.material.uniforms.uTime.value = t;
    sky.material.uniforms.uTime.value = t;
    sea.material.uniforms.uCam.value.copy(camera.position);
    sea.position.set(camera.position.x, 0, camera.position.z);
    sky.position.copy(camera.position);
    if (beams.userData.spin !== false) beams.rotation.y = t * 0.45;
    governor(dt);
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, frame, updateFleet, setDawn, setLantern, glowTex,
    beams, beamMat, shown, marker, ring,
    get dawn() { return dawn; },
    get lanternLevel() { return lanternLevel; },
    setBoatScale: (s) => { boatScale = s; },
    get boatScale() { return boatScale; },
    spread,
    hud: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, dpr }),
  };
}
