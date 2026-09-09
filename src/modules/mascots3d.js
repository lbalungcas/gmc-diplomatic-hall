/**
 * 3D hall mascots — Tutu the elephant (Terre des hommes) and the VEWU lighthouse — built from
 * primitives so they need no extra downloads. Each mascot is tinted with its organizer's brand
 * palette (organizers.json: color / accent / ink); copy follows the 2D GMC hall's mascots.json.
 *
 * Each mascot idles in place, turns to face nearby visitors (elephant), shows a speech bubble
 * when someone walks up, and can be "talked to" (E / tap) to open an info modal.
 */
import * as THREE from 'three';

const PALETTE = {
  body: 0x9aadbe,
  bodyDark: 0x7a8a9c,
  ear: 0x8a9aad,
  earInner: 0x6b7a8c,
  yellow: 0xf4b400,
  teal: 0x4fa69c,
  coral: 0xe2603c,
  paper: 0xe8eefc,
  navy: 0x2e4570,
  ink: 0x16223d,
};

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...extra });
}

function pick(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------- Elephant
export function createElephant({ theme = {} } = {}) {
  const root = new THREE.Group();
  root.name = 'Mascot_Elephant';
  const accentHex = new THREE.Color(theme.accent || '#F4B400');
  const scarfHex = new THREE.Color(theme.color || '#4FA69C');
  const inkHex = new THREE.Color(theme.ink || '#16223D');
  const bodyMat = std(PALETTE.body);
  const earMat = std(PALETTE.ear, { side: THREE.DoubleSide });
  const innerMat = std(PALETTE.earInner, { side: THREE.DoubleSide });

  // Body (slightly pear-shaped)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), bodyMat);
  body.scale.set(1, 0.9, 1.1);
  body.position.y = 0.72;
  root.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), std(0xb7c6d3));
  belly.scale.set(1, 0.9, 0.7);
  belly.position.set(0, 0.62, 0.28);
  root.add(belly);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.11, 0.135, 0.42, 14);
  const nailGeo = new THREE.SphereGeometry(0.035, 8, 6);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(sx * 0.22, 0.21, sz * 0.2);
    root.add(leg);
    for (let i = -1; i <= 1; i++) {
      const nail = new THREE.Mesh(nailGeo, std(0xf1f0ec));
      nail.position.set(sx * 0.22 + i * 0.07, 0.04, sz * 0.2 + (sz > 0 ? 0.12 : -0.12));
      root.add(nail);
    }
  }

  // Tail
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.95, -0.42),
    new THREE.Vector3(0.05, 0.75, -0.52),
    new THREE.Vector3(0.02, 0.55, -0.5),
  ]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 10, 0.025, 8, false), bodyMat));
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), std(PALETTE.earInner));
  tuft.position.set(0.02, 0.53, -0.5);
  root.add(tuft);

  // Head group (yaws toward the visitor)
  const head = new THREE.Group();
  head.position.set(0, 1.12, 0.22);
  root.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20), bodyMat);
  skull.scale.set(1, 0.95, 0.95);
  head.add(skull);

  // Ears (flattened spheres, flap in idle)
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.24, 0.1, -0.02);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), earMat);
    ear.scale.set(0.16, 1, 0.8);
    ear.position.set(sx * 0.14, 0, 0);
    ear.rotation.z = sx * 0.25;
    pivot.add(ear);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), innerMat);
    inner.scale.set(0.12, 1, 0.8);
    inner.position.set(sx * 0.17, -0.02, 0.02);
    inner.rotation.z = sx * 0.25;
    pivot.add(inner);
    head.add(pivot);
    ears.push({ pivot, side: sx });
  }

  // Yellow headband (from the 2D mascot art)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.04, 10, 32), std(inkHex, { roughness: 0.5 }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.16;
  head.add(band);
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), std(accentHex, { roughness: 0.5 }));
  bow.position.set(0.2, 0.22, 0.2);
  head.add(bow);

  // Eyes
  const eyeMat = std(PALETTE.ink, { roughness: 0.3 });
  const glintMat = std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), eyeMat);
    eye.position.set(sx * 0.13, 0.06, 0.3);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), glintMat);
    glint.position.set(sx * 0.13 + 0.012, 0.075, 0.34);
    head.add(glint);
    // Rosy cheeks
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std(0xc9a0a8));
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(sx * 0.2, -0.04, 0.27);
    head.add(cheek);
  }

  // Tusks
  const tuskMat = std(0xf1f0ec, { roughness: 0.4 });
  for (const sx of [-1, 1]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 10), tuskMat);
    tusk.position.set(sx * 0.11, -0.13, 0.32);
    tusk.rotation.x = Math.PI / 2 - 0.25;
    head.add(tusk);
  }

  // Trunk (swings in idle) — pivot at the face
  const trunkPivot = new THREE.Group();
  trunkPivot.position.set(0, -0.06, 0.3);
  head.add(trunkPivot);
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.18, 0.14),
    new THREE.Vector3(0, -0.36, 0.16),
    new THREE.Vector3(0, -0.5, 0.1),
    new THREE.Vector3(0.05, -0.58, 0.18),
  ]);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 24, 0.065, 12, false), bodyMat);
  trunkPivot.add(trunk);
  const trunkTip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), bodyMat);
  trunkTip.position.set(0.05, -0.58, 0.18);
  trunkPivot.add(trunkTip);

  // Teal scarf
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.055, 10, 32), std(scarfHex, { roughness: 0.85 }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(0, 0.98, 0.16);
  root.add(scarf);
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.04), std(scarfHex, { roughness: 0.85 }));
  scarfTail.position.set(0.22, 0.82, 0.36);
  scarfTail.rotation.z = -0.2;
  root.add(scarfTail);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    root,
    height: 1.55,
    animate(t, facingDelta) {
      body.position.y = 0.72 + Math.sin(t * 2.1) * 0.012;
      head.position.y = 1.12 + Math.sin(t * 2.1 + 0.4) * 0.015;
      head.rotation.y += (facingDelta - head.rotation.y) * 0.08;
      head.rotation.z = Math.sin(t * 0.9) * 0.04;
      for (const e of ears) e.pivot.rotation.y = e.side * (Math.sin(t * 2.6 + e.side) * 0.16);
      trunkPivot.rotation.x = Math.sin(t * 1.4) * 0.16;
      trunkPivot.rotation.y = Math.sin(t * 0.7) * 0.12;
    },
  };
}

// ---------------------------------------------------------------- Lighthouse
function createStripeTexture(stripe = '#1C3462', windowColor = '#1C3462') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? stripe : '#F4F6FA';
    ctx.fillRect((i * 512) / bands, 0, 512 / bands + 1, 128);
  }
  // Little windows on the white bands
  ctx.fillStyle = windowColor;
  for (let i = 1; i < bands; i += 2) {
    const x = (i * 512) / bands + 512 / bands / 2;
    ctx.beginPath();
    ctx.roundRect(x - 9, 30, 18, 26, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x - 9, 78, 18, 26, 6);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function createLighthouse({ withLight = true, theme = {} } = {}) {
  const root = new THREE.Group();
  root.name = 'Mascot_Lighthouse';

  // VEWU brand: navy tower bands, gold lantern & deck (violenceendswithus.com palette)
  const primaryHex = theme.color || '#1C3462';
  const accentHex = theme.accent || '#F2C667';
  const primary = new THREE.Color(primaryHex);
  const gold = new THREE.Color(accentHex);
  const navy = std(primary, { roughness: 0.6 });
  const yellow = std(gold, { roughness: 0.45, emissive: gold, emissiveIntensity: 0.15 });
  const coral = std(primary.clone().offsetHSL(0, 0, 0.08), { roughness: 0.6 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.18, 28), navy);
  base.position.y = 0.09;
  root.add(base);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 28), std(primary.clone().offsetHSL(0, -0.1, 0.18)));
  plinth.position.y = 0.24;
  root.add(plinth);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.4, 1.45, 32, 1), std(0xffffff, { map: createStripeTexture(primaryHex, primaryHex), roughness: 0.65 }));
  tower.position.y = 1.02;
  root.add(tower);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.04), navy);
  door.position.set(0, 0.45, 0.38);
  root.add(door);

  // Gallery deck + railing
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.1, 28), yellow);
  deck.position.y = 1.8;
  root.add(deck);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.018, 8, 40), navy);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 2.0;
  root.add(rail);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), navy);
    post.position.set(Math.cos(a) * 0.37, 1.93, Math.sin(a) * 0.37);
    root.add(post);
  }

  // Lamp room
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.34, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xfff8e1, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  glass.position.y = 2.02;
  root.add(glass);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.34, 0.025), navy);
    mullion.position.set(Math.cos(a) * 0.24, 2.02, Math.sin(a) * 0.24);
    root.add(mullion);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe08a, emissiveIntensity: 1.6, roughness: 0.3 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), lampMat);
  lamp.position.y = 2.02;
  root.add(lamp);

  // Roof + finial
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.36, 20), coral);
  roof.position.y = 2.37;
  root.add(roof);
  const roofRim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20), navy);
  roofRim.position.y = 2.2;
  root.add(roofRim);
  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), yellow);
  finial.position.y = 2.62;
  root.add(finial);

  // Rotating beams
  const beamGroup = new THREE.Group();
  beamGroup.position.y = 2.02;
  root.add(beamGroup);
  const beamMat = new THREE.MeshBasicMaterial({
    color: gold, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const dir of [1, -1]) {
    const geo = new THREE.ConeGeometry(0.34, 2.6, 18, 1, true);
    geo.translate(0, -1.3, 0);
    const beam = new THREE.Mesh(geo, beamMat);
    beam.rotation.z = dir * Math.PI / 2;
    beamGroup.add(beam);
  }

  let light = null;
  if (withLight) {
    light = new THREE.PointLight(0xffd36b, 0.9, 6, 1.6);
    light.position.y = 2.02;
    root.add(light);
  }

  root.traverse((o) => { if (o.isMesh && o !== glass && o.parent !== beamGroup) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    root,
    height: 2.75,
    animate(t) {
      beamGroup.rotation.y = t * 1.1;
      const pulse = 1.3 + Math.sin(t * 2.2) * 0.35;
      lampMat.emissiveIntensity = pulse;
      if (light) light.intensity = 0.6 + Math.sin(t * 2.2) * 0.25;
      root.rotation.z = Math.sin(t * 0.8) * 0.02;
      root.position.y = Math.sin(t * 1.6) * 0.01;
    },
  };
}

// ---------------------------------------------------------------- Sprites
function makeSprite(canvas, w, h, { depthTest = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false }));
  sprite.scale.set(w, h, 1);
  return sprite;
}

function createNameplate(name, org, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10, 15, 26, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 26);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = 'bold 26px "Outfit", sans-serif';
  ctx.fillText(`${org.toUpperCase()} MASCOT`, 256, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px "Outfit", sans-serif';
  ctx.fillText(name, 256, 96);
  return makeSprite(canvas, 1.5, 0.375);
}

function drawBubble(ctx, text) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2E4570';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(10, 10, W - 20, H - 60, 34);
  ctx.fill();
  ctx.stroke();
  // Tail
  ctx.beginPath();
  ctx.moveTo(W / 2 - 26, H - 52);
  ctx.lineTo(W / 2, H - 12);
  ctx.lineTo(W / 2 + 26, H - 52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(W / 2 - 24, H - 56, 48, 8);
  ctx.strokeStyle = '#2E4570';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 26, H - 50);
  ctx.lineTo(W / 2, H - 12);
  ctx.lineTo(W / 2 + 26, H - 50);
  ctx.stroke();

  ctx.fillStyle = '#16223D';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 54;
  ctx.font = `800 ${size}px "Outfit", "Plus Jakarta Sans", sans-serif`;
  while (ctx.measureText(text).width > W - 70 && size > 28) {
    size -= 4;
    ctx.font = `800 ${size}px "Outfit", "Plus Jakarta Sans", sans-serif`;
  }
  ctx.fillText(text, W / 2, (H - 60) / 2 + 8);
}

// ---------------------------------------------------------------- Controller
/**
 * @param {Array} defs mascots.json entries (with world x/z)
 * @returns {{ list, update(t, dt, playerPos, frozen), obstacles, nearest(playerPos) }}
 */
export function createMascots(scene, defs, { lowPower = false, colorFor = () => '#F4B400', themeFor = () => ({}) } = {}) {
  const list = defs.map((cfg) => {
    const theme = themeFor(cfg) || {};
    const built = cfg.kind === 'lighthouse' ? createLighthouse({ withLight: !lowPower, theme }) : createElephant({ theme });
    built.root.position.set(cfg.x, 0, cfg.z);
    built.root.rotation.y = cfg.yaw || 0;
    scene.add(built.root);

    const color = colorFor(cfg);
    const plate = createNameplate(cfg.name, cfg.org, color);
    plate.position.set(cfg.x, built.height + 0.32, cfg.z);
    scene.add(plate);

    const bubbleCanvas = document.createElement('canvas');
    bubbleCanvas.width = 512;
    bubbleCanvas.height = 192;
    const bubble = makeSprite(bubbleCanvas, 1.7, 0.64, { depthTest: false });
    bubble.position.set(cfg.x, built.height + 0.85, cfg.z);
    bubble.visible = false;
    scene.add(bubble);

    return {
      cfg,
      built,
      plate,
      bubble,
      bubbleCtx: bubbleCanvas.getContext('2d'),
      inRange: false,
      idleTimer: 0,
      baseYaw: cfg.yaw || 0,
      facingDelta: 0,
    };
  });

  function say(m, text) {
    if (!text) return;
    drawBubble(m.bubbleCtx, text);
    m.bubble.material.map.needsUpdate = true;
    m.bubble.visible = true;
    m.bubblePop = 0;
  }

  function hush(m) {
    m.bubble.visible = false;
  }

  return {
    list,
    obstacles: list.map((m) => ({ x: m.cfg.x, z: m.cfg.z, r: m.cfg.radius || 0.55 })),

    update(t, dt, playerPos, frozen = false) {
      let nearestIdx = -1;
      let nearestDist = Infinity;
      list.forEach((m, i) => {
        const dx = playerPos.x - m.cfg.x;
        const dz = playerPos.z - m.cfg.z;
        const d = Math.hypot(dx, dz);
        if (d < (m.cfg.bubbleRange || 4.5) && d < nearestDist) { nearestDist = d; nearestIdx = i; }

        // Elephant turns its head toward the visitor when they're close.
        if (m.cfg.kind === 'elephant') {
          if (d < 6) {
            const targetYaw = Math.atan2(dx, dz);
            let rel = targetYaw - m.built.root.rotation.y;
            while (rel > Math.PI) rel -= Math.PI * 2;
            while (rel < -Math.PI) rel += Math.PI * 2;
            m.facingDelta = Math.max(-0.9, Math.min(0.9, rel));
          } else {
            m.facingDelta = 0;
          }
          m.built.animate(t, m.facingDelta);
        } else {
          m.built.animate(t);
        }

        // Bubble pop-in
        if (m.bubble.visible) {
          m.bubblePop = Math.min(1, (m.bubblePop || 0) + dt * 5);
          const s = 0.85 + 0.15 * Math.sin(m.bubblePop * Math.PI / 2);
          m.bubble.scale.set(1.7 * s, 0.64 * s, 1);
          m.bubble.position.y = m.built.height + 0.85 + Math.sin(t * 2.5) * 0.03;
        }
      });

      list.forEach((m, i) => {
        const inRange = !frozen && i === nearestIdx;
        if (inRange && !m.inRange) {
          say(m, pick(m.cfg.lines?.enter) || 'Hi!');
          m.idleTimer = 2.5;
        } else if (!inRange && m.inRange) {
          hush(m);
        } else if (inRange) {
          m.idleTimer -= dt;
          if (m.idleTimer <= 0) {
            m.idleTimer = 5 + Math.random() * 2;
            say(m, pick(m.cfg.lines?.idle));
          }
        }
        m.inRange = inRange;
      });
    },

    nearest(playerPos) {
      let best = null;
      let bestDist = Infinity;
      for (const m of list) {
        const d = Math.hypot(playerPos.x - m.cfg.x, playerPos.z - m.cfg.z);
        if (d < (m.cfg.interactRange || 2.2) && d < bestDist) { best = m; bestDist = d; }
      }
      return best ? { mascot: best, dist: bestDist } : null;
    },
  };
}
