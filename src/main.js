import * as THREE from 'three';
window.THREE = THREE;
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import boothsData from './data/booths.json';
import organizersData from './data/organizers.json';
import mascotsData from './data/mascots.json';
import tutuFaqs from './data/tutuFaqs.json';
import { createPresence, getVisitorInfo, colorFromId } from './modules/presence.js';
import { track } from './modules/analytics.js';
import { buildOrganizerBooth, organizerObstacles, TV_W, TV_H } from './modules/organizers.js';
import { createMascots } from './modules/mascots3d.js';
import { buildWelcomeDesk } from './modules/welcomeDesk.js';
import { createPerfHud, isPerfHudEnabled } from './modules/perfHud.js';
import { createAdaptiveQuality } from './modules/adaptiveQuality.js';

// --- State Variables ---
let scene, camera, renderer, clock;
let cssScene = null, cssRenderer = null;
let hallModel = null;
let stageCSSObject = null;
let ytStagePlayer = null;
let isPointerLocked = false;
let soundEnabled = true;
let isTouchDevice = false;
let isLowPowerDevice = false;
let hasStarted = false;      // User has entered the hall at least once
let venueLoaded = false;     // GLB finished loading (or failed and we let them in anyway)
let currentBoothId = null;   // Booth currently shown in the modal
const openModals = new Set();

// Post-processing (desktop only)
let composer = null;

// Dev-only perf overlay (?stats=1) — see src/modules/perfHud.js
let perfHud = null;

// Measures delivered frame time and steps quality down/up — see src/modules/adaptiveQuality.js
let quality = null;

// Ambient dust mote particles (desktop only)
let dustParticles = null;

// Environment cubemap for reflections (generated procedurally)
let envMap = null;

// Camera smoothing: mouse input accumulator for sub-frame interpolation
let mouseDeltaX = 0, mouseDeltaY = 0;

// Teleport settle animation
let teleportSettleTimer = 0;

// Dynamic 3D Policy & Commitment Wall
let policyBoardMesh = null, policyCanvas = null, policyCtx = null, policyTexture = null;

// YouTube Keynote State
let currentVideoId = 'vYIYIVmOo3Q';
let hasUserInteracted = false;

// Multiplayer Presence & Avatars
const remotePlayers = new Map(); // id -> { model, targetPos, targetYaw, walkTimer }
let avatarTemplate = null;
let presence = null;
let presenceOfflineToastShown = false;

// Booth TVs: every booth (and organizer stand) has a wall-mounted TV looping a muted video.
// Sound only plays in the pop-up you get by clicking / tapping the TV (or pressing E while aiming at it).
// Per-booth clips: set `screenVideo` on a booth in src/data/booths.json (or an organizer in organizers.json);
// anything without one falls back to this branded placeholder loop.
const DEFAULT_SCREEN_VIDEO = '/videos/booth_tv_loop.mp4';
const TV_AIM_DISTANCE = 7.0;
const tvScreens = [];              // screen meshes (raycast targets)
const sharedVideos = new Map();    // src -> <video>
let aimedTV = null;                // userData of the TV the crosshair is on

// Organizer booths & mascots (Pre-Function Foyer)
const organizerBooths = new Map(); // id -> { org, group }
let mascots = null;
const staticBoxes = [];            // world AABBs the player can't walk through

// Player Locomotion & Physics (Normalized realistic height: 1.45m eye level)
const player = {
  pos: new THREE.Vector3(9.68, 1.45, -2.5),
  vel: new THREE.Vector3(0, 0, 0),
  desiredVel: new THREE.Vector3(0, 0, 0),
  pitch: 0,
  yaw: 0, // facing -Z down central aisle toward Stage
  roll: 0,
  maxSpeed: 4.6,
  eyeHeight: 1.45,
  radius: 0.38,
  headBobTimer: 0,
  isSitting: false,
  sittingChairId: null,
};

// Keyboard inputs
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

function resetMovementKeys() {
  keys.forward = keys.backward = keys.left = keys.right = false;
}

// Mobile Touch Controls
let joystickTouchId = null;
let lookTouchId = null;
let touchLookLastX = 0, touchLookLastY = 0;
const joystickVec = { x: 0, y: 0 };

// 10 Audience Chairs (5 Left, 5 Right facing Stage)
const CHAIR_LOCATIONS = [
  { id: 1, x: 6.00,  z: -18.50, label: "VIP Chair L1" },
  { id: 2, x: 6.70,  z: -18.50, label: "VIP Chair L2" },
  { id: 3, x: 7.40,  z: -18.50, label: "VIP Chair L3" },
  { id: 4, x: 8.10,  z: -18.50, label: "VIP Chair L4" },
  { id: 5, x: 8.80,  z: -18.50, label: "VIP Chair L5" },
  { id: 6,  x: 10.60, z: -18.50, label: "VIP Chair R1" },
  { id: 7,  x: 11.30, z: -18.50, label: "VIP Chair R2" },
  { id: 8,  x: 12.00, z: -18.50, label: "VIP Chair R3" },
  { id: 9,  x: 12.70, z: -18.50, label: "VIP Chair R4" },
  { id: 10, x: 13.40, z: -18.50, label: "VIP Chair R5" },
];

// Booth Positions in 3D (X, Z) - Exact glTF coordinates.
// Booths are double-sided panels: two booths share one physical stand and face opposite
// directions. `facing` is the direction (along X) the booth graphic faces, so the
// interaction anchor sits in front of the correct side.
const BOOTH_POSITIONS = {
  1:  { x: 13.75, z: -4.96,  facing: -1, title: "Booth 01", category: "Innovation" },
  2:  { x: 13.75, z: -6.96,  facing: -1, title: "Booth 02", category: "Innovation" },
  3:  { x: 13.75, z: -8.96,  facing: -1, title: "Booth 03", category: "Innovation" },
  4:  { x: 13.75, z: -10.96, facing: -1, title: "Booth 04", category: "Innovation" },
  5:  { x: 13.75, z: -12.96, facing: -1, title: "Booth 05", category: "Innovation" },
  6:  { x: 13.76, z: -4.96,  facing: 1,  title: "Booth 06", category: "GreenTech" },
  7:  { x: 13.76, z: -6.96,  facing: 1,  title: "Booth 07", category: "GreenTech" },
  8:  { x: 13.76, z: -8.96,  facing: 1,  title: "Booth 08", category: "GreenTech" },
  9:  { x: 13.76, z: -10.96, facing: 1,  title: "Booth 09", category: "GreenTech" },
  10: { x: 13.76, z: -12.96, facing: 1,  title: "Booth 10", category: "GreenTech" },
  11: { x: 6.54,  z: -8.99,  facing: 1,  title: "Booth 11", category: "EdTech" },
  12: { x: 6.54,  z: -10.98, facing: 1,  title: "Booth 12", category: "EdTech" },
  13: { x: 6.58,  z: -7.00,  facing: 1,  title: "Booth 13", category: "EdTech" },
  14: { x: 6.52,  z: -12.98, facing: 1,  title: "Booth 14", category: "EdTech" },
  15: { x: 6.58,  z: -4.99,  facing: 1,  title: "Booth 15", category: "Health" },
  16: { x: 6.53,  z: -4.99,  facing: -1, title: "Booth 16", category: "Health" },
  17: { x: 6.53,  z: -6.99,  facing: -1, title: "Booth 17", category: "Health" },
  18: { x: 6.49,  z: -9.00,  facing: -1, title: "Booth 18", category: "Creative" },
  19: { x: 6.50,  z: -10.99, facing: -1, title: "Booth 19", category: "Creative" },
  20: { x: 6.46,  z: -12.99, facing: -1, title: "Booth 20", category: "Creative" }
};

// Interaction anchor: 1.0m in front of the booth graphic
const BOOTH_ANCHOR_OFFSET = 1.0;
for (const b of Object.values(BOOTH_POSITIONS)) {
  b.ax = b.x + b.facing * BOOTH_ANCHOR_OFFSET;
  b.az = b.z;
}

const BOOTH_INTERACT_RADIUS = 2.2;
const TOTAL_BOOTHS = Object.keys(BOOTH_POSITIONS).length;

// Solid furniture that the collision code treats as boxes. The GLB's staircase (Step_00–14,
// Stair_Landing, Stair_Rail) sits along the south wall at x 11.5–19.35 / z -1.85–0; without this
// the player could walk straight into the treads.
const STAIRS_BOX = { minX: 11.45, maxX: 19.4, minZ: -1.9, maxZ: 0.2, label: 'stairs' };
// The welcome desk box is refined from the procedural desk's real bounds in createWelcomeDesk().
const WELCOME_DESK_BOX = { minX: 21.6, maxX: 22.7, minZ: -18.9, maxZ: -15.75, label: 'welcome desk' };
const COMMITMENT_WALL_BOX = { minX: 19.4, maxX: 20.05, minZ: -17.3, maxZ: -13.3, label: 'commitment wall' };
// Hall↔foyer divider is a thick wall with two doorways — solid segments (not a zero-thickness plane)
// so jamb corners and long frames can't tunnel through.
const DIV_X = 19.35;
const DIV_HALF = 0.28;
const DIVIDER_SEGMENTS = [
  { minX: DIV_X - DIV_HALF, maxX: DIV_X + DIV_HALF, minZ: -7.0, maxZ: 0.25, label: 'divider-n' },
  { minX: DIV_X - DIV_HALF, maxX: DIV_X + DIV_HALF, minZ: -11.4, maxZ: -8.8, label: 'divider-m' },
  { minX: DIV_X - DIV_HALF, maxX: DIV_X + DIV_HALF, minZ: -20.95, maxZ: -13.2, label: 'divider-s' },
];
// Foyer L-cutout: block walking into the south exterior corner mesh (x>19.35, z<-20.8).
const FOYER_NOTCH_BOX = { minX: 19.2, maxX: 27.4, minZ: -25.4, maxZ: -20.55, label: 'foyer-notch' };
// Stage apron — solid so you cannot slide onto the platform from the sides.
const STAGE_BOX = { minX: 4.55, maxX: 14.8, minZ: -25.2, maxZ: -21.7, label: 'stage' };

staticBoxes.push(
  STAIRS_BOX,
  WELCOME_DESK_BOX,
  COMMITMENT_WALL_BOX,
  FOYER_NOTCH_BOX,
  STAGE_BOX,
  ...DIVIDER_SEGMENTS,
);

/** Inner playable bounds (kept slightly inside the GLB wall faces so the camera never sits in mesh). */
const WORLD_BOUNDS = { minX: 1.05, maxX: 26.55, minZ: -24.55, maxZ: -1.05 };

// Interactive Venue Hotspots
const HOTSPOTS = {
  welcomeDesk: { x: 22.16, z: -17.31, radius: 2.5, title: "Welcome & Information Desk", action: "Open venue guide", modal: "desk-modal" },
  commitmentWall: { x: 19.43, z: -15.14, radius: 2.8, title: "Commitment & Pledge Wall", action: "Post a pledge", modal: "pledge-modal" },
  mediaHub: { x: 20.16, z: -4.39, radius: 2.5, title: "Media Hub & Press Lounge", action: "Open venue guide", modal: "desk-modal" },
  podium: { x: 8.0, z: -22.8, radius: 2.0, title: "Keynote Speaker Lectern", action: "View from the stage", modal: "podium" },
  stageScreen: { x: 9.68, z: -23.5, radius: 3.5, title: "Main Stage Live Stream", action: "Open theater view", modal: "stage-modal" },
};

let activeTarget = null;
let activeWaypointId = null;
let visitedBooths = new Set();
let quizPassed = new Set();
let heartedBooths = new Set();
let boothMarkers = [];
let boothLabels = new Map(); // id -> sprite

function loadSet(key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {}
  return new Set();
}

function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch (e) {}
}

visitedBooths = loadSet('gmc_visited_booths');
quizPassed = loadSet('gmc_quiz_passed');
heartedBooths = loadSet('gmc_hearted_booths');

// --- Small DOM helpers ---
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad2(n) { return `${n < 10 ? '0' : ''}${n}`; }

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// --- Toast Notifications ---
function showToast(message, { icon = 'ℹ️', type = '', duration = 2600 } = {}) {
  const stack = $('toast-stack');
  if (!stack) return;
  while (stack.children.length >= 3) stack.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// --- Pointer lock helpers ---
function requestLock() {
  if (isTouchDevice || !hasStarted) return;
  if (openModals.size > 0 || isBlockerVisible()) return;
  try {
    const p = document.body.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) {}
}

function releaseLock() {
  if (isTouchDevice) return;
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch (err) {}
}

// --- Blocker (welcome / paused / help) ---
function isBlockerVisible() {
  const blocker = $('blocker');
  return !!blocker && blocker.style.display !== 'none';
}

function showBlocker(mode) {
  const blocker = $('blocker');
  if (!blocker) return;
  blocker.dataset.mode = mode;
  const badge = $('blocker-badge');
  const title = $('blocker-title');
  const label = $('start-btn-label');
  const note = $('blocker-note');
  const noteTouch = $('blocker-note-touch');
  const lead = $('blocker-lead');

  if (mode === 'paused') {
    badge.textContent = 'PAUSED';
    title.textContent = 'Walk Paused';
    label.textContent = 'RESUME WALK';
    if (lead) {
      lead.textContent = isTouchDevice
        ? 'Take a breath — your place in the hall is saved. Resume when you are ready to keep exploring booths and stamps.'
        : 'Your place in the hall is saved. Resume walking whenever you are ready to keep exploring booths and stamps.';
    }
    if (note) note.textContent = 'Click the button, click anywhere, or press Enter to resume.';
    if (noteTouch) noteTouch.textContent = 'Tap Resume Walk to continue. Landscape + fullscreen works best on kiosk tablets.';
  } else if (mode === 'help') {
    badge.textContent = 'CONTROLS & HELP';
    title.textContent = 'How to explore';
    label.textContent = 'BACK TO THE HALL';
    if (lead) {
      lead.textContent = isTouchDevice
        ? 'Use the on-screen joystick and HUD buttons. Approach a booth or Tutu, then tap the prompt (or 🎯) to open it.'
        : 'Use the keys below to walk, look, and open exhibits. Press E near a booth or Tutu — or click a booth TV for sound.';
    }
    if (note) note.textContent = 'Click anywhere to return to the hall.';
    if (noteTouch) noteTouch.textContent = 'Tap Back to the Hall when you are ready.';
  } else {
    badge.textContent = 'FIRST-PERSON 3D EXPO';
    title.textContent = 'Youth Innovations Marketplace';
    label.textContent = venueLoaded ? 'ENTER THE HALL' : 'LOADING VENUE';
    if (lead) {
      lead.textContent = 'Walk the digital companion hall: visit 20 youth innovation booths, collect passport stamps, ask Tutu about the event & safeguarding, and leave a pledge on the Commitment Wall.';
    }
    if (note) note.textContent = 'Click the button or press Enter to lock the cursor and start walking.';
    if (noteTouch) noteTouch.textContent = 'Tip: rotate to landscape and use fullscreen for the best kiosk experience.';
  }
  blocker.style.display = 'flex';
  resetMovementKeys();
  releaseLock();
}

function hideBlocker() {
  const blocker = $('blocker');
  if (blocker) blocker.style.display = 'none';
}

function enterHall() {
  if (!venueLoaded) return;
  hasUserInteracted = true;
  hasStarted = true;
  hideBlocker();

  // Autoplay policies: the muted TV loops may have been blocked before the first gesture.
  for (const v of sharedVideos.values()) {
    if (v.paused) v.play().catch(() => {});
  }

  if (ytStagePlayer && typeof ytStagePlayer.unMute === 'function') {
    try {
      if (soundEnabled) {
        ytStagePlayer.unMute();
        updateStageVolume();
      }
      ytStagePlayer.playVideo();
    } catch (err) {}
  }

  requestLock();
}

// --- Loading progress ---
function setLoadProgress(ratio, text) {
  const fill = $('load-bar-fill');
  const status = $('load-status');
  const label = $('load-text');
  if (!fill || !status) return;
  if (ratio === null) {
    status.classList.add('indeterminate');
    status.removeAttribute('aria-valuenow');
  } else {
    status.classList.remove('indeterminate');
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    fill.style.width = `${pct}%`;
    status.setAttribute('aria-valuenow', String(pct));
  }
  if (label && text) label.textContent = text;
}

function markVenueLoaded(ok) {
  venueLoaded = true;
  const status = $('load-status');
  const btn = $('start-btn');
  const label = $('start-btn-label');
  setLoadProgress(1, ok ? 'Venue ready. Welcome, delegate!' : 'Venue model could not be fully loaded — entering in limited mode.');
  if (status) status.classList.add('done');
  if (btn) btn.disabled = false;
  if (label && $('blocker').dataset.mode === 'welcome') label.textContent = 'ENTER THE HALL';
}

// --- Initialize Scene ---
function init() {
  clock = new THREE.Clock();

  // Input mode detection: prefer pointer capability over screen width so a small desktop
  // window keeps mouse-look and a tablet with no mouse gets touch controls.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  isTouchDevice = (coarse && !fine) || (hasTouch && !fine);
  isLowPowerDevice = isTouchDevice || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  document.body.classList.toggle('touch-device', isTouchDevice);

  // 1. CSS3D Scene & Renderer (Layer 2 - for live YouTube stage screen)
  cssScene = new THREE.Scene();
  cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.domElement.id = 'css-canvas';
  Object.assign(cssRenderer.domElement.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    zIndex: '2', pointerEvents: 'none',
  });

  // 2. WebGL Scene & Renderer (Layer 1 - 3D venue, characters, booths, lighting)
  scene = new THREE.Scene();
  scene.background = null;

  // Atmospheric depth fog — warm navy, subtle enough to not obscure booths
  scene.fog = new THREE.FogExp2(0x08101e, isLowPowerDevice ? 0.012 : 0.016);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.copy(player.pos);
  applyResponsiveFov();

  renderer = new THREE.WebGLRenderer({ antialias: !isLowPowerDevice, alpha: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowPowerDevice ? 1.5 : 2));
  renderer.shadowMap.enabled = !isLowPowerDevice;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Re-tuned upwards: with the ambient flood removed the scene has real dynamic range again,
  // and ACES needs more headroom to land the highlights.
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.id = 'webgl-canvas';
  Object.assign(renderer.domElement.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    zIndex: '1', pointerEvents: 'auto', touchAction: 'none',
  });

  const container = $('canvas-container');
  container.innerHTML = '';
  container.appendChild(cssRenderer.domElement);
  container.appendChild(renderer.domElement);

  // Post-processing (desktop only).
  //
  // Three things were wrong with the previous chain. EffectComposer builds its render targets
  // without a `samples` count, so the renderer's `antialias: true` was silently discarded the
  // moment the composer path was taken and only FXAA remained. Tone mapping ran inside
  // RenderPass (three applies it per-material), so the vignette was multiplying already
  // tone-mapped values instead of linear light. And there was no OutputPass, so the chain had
  // no single place where HDR became display-referred.
  //
  // Now: MSAA on the target, every pass operates on linear HDR, and OutputPass applies ACES
  // and the sRGB transfer once, at the end.
  if (!isLowPowerDevice) {
    composer = new EffectComposer(renderer);
    composer.renderTarget1.samples = 4;
    composer.renderTarget2.samples = 4;
    composer.addPass(new RenderPass(scene, camera));

    // Vignette, applied in linear space ahead of tone mapping.
    const VignetteShader = {
      uniforms: {
        tDiffuse: { value: null },
        offset: { value: 1.0 },
        darkness: { value: 1.1 },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float offset;
        uniform float darkness;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
          float vignette = 1.0 - dot(uv, uv);
          texel.rgb *= mix(1.0, smoothstep(0.0, 1.0, vignette), darkness);
          gl_FragColor = texel;
        }
      `,
    };
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.material.uniforms['offset'].value = 0.95;
    vignettePass.material.uniforms['darkness'].value = 1.15;
    composer.addPass(vignettePass);

    // SMAA reconstructs edges rather than blurring across them the way FXAA does, which the
    // hall's long booth-panel and door-frame lines show up immediately.
    const pr = renderer.getPixelRatio();
    composer.addPass(new SMAAPass(window.innerWidth * pr, window.innerHeight * pr));

    composer.addPass(new OutputPass());
  }

  // Image-based lighting. Needs `renderer`, so it must come after the renderer exists.
  generateEnvMap();

  addVenueLighting();
  loadHallModel();
  createHolographicMarkers();
  createBoothTVs();
  createOrganizerBooths();
  createHallMascots();
  createWelcomeDesk();
  createContactShadows();
  setupStageYouTubeScreen();
  setupPolicyWall();
  initMultiplayer();

  // Floating dust motes near ceiling lights (desktop only)
  if (!isLowPowerDevice) createDustParticles();

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', () => setTimeout(onWindowResize, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onWindowResize);

  // Start from whatever the static heuristics chose, then let measured frame time take over.
  quality = createAdaptiveQuality(renderer, composer, {
    targetFps: 60,
    maxPixelRatio: Math.min(window.devicePixelRatio, isLowPowerDevice ? 1.5 : 2),
    minPixelRatio: 0.75,
    onChange: (cfg) => console.info(`[quality] ${cfg.label} (dpr ${cfg.pixelRatio.toFixed(2)})`),
  });

  if (isPerfHudEnabled()) perfHud = createPerfHud(renderer);

  setupControls();
  setupMobileControls();
  setupHUD();
  setupMinimapCanvas();
  updateVisitedHUD();

  animate();
}

/**
 * Builds the image-based lighting environment.
 *
 * The previous implementation assembled a CubeTexture from six *identical* flat vertical
 * gradients and never ran it through PMREM, so polished marble, the metal trim and the TV
 * bezels had no real specular response to reflect — they just picked up a constant tint. It
 * also allocated a WebGLCubeRenderTarget it never used.
 *
 * RoomEnvironment is a small box-lit room rendered once and prefiltered by PMREMGenerator into
 * a proper roughness mip chain. Assigning it to `scene.environment` gives every PBR material
 * in the venue plausible indirect light and reflections for one render at start-up, which is
 * what lets the ambient flood below be turned down to almost nothing.
 */
function generateEnvMap() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const room = new RoomEnvironment();
  envMap = pmrem.fromScene(room, 0.04).texture;

  scene.environment = envMap;
  scene.environmentIntensity = isLowPowerDevice ? 0.70 : 0.85;

  room.dispose();
  pmrem.dispose();
}

/** Floating translucent dust motes drifting near the ceiling. */
function createDustParticles() {
  const count = 100;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 1.5 + Math.random() * 24;      // x: spread across hall + foyer
    positions[i * 3 + 1] = 1.8 + Math.random() * 1.8;  // y: upper half of the room
    positions[i * 3 + 2] = -1.5 - Math.random() * 22;  // z: full depth
    sizes[i] = 0.015 + Math.random() * 0.025;
    opacities[i] = 0.15 + Math.random() * 0.25;
    speeds[i] = 0.2 + Math.random() * 0.4;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.PointsMaterial({
    color: 0xffe8c8,
    size: 0.03,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  dustParticles = new THREE.Points(geo, mat);
  dustParticles.userData.speeds = speeds;
  dustParticles.userData.basePositions = new Float32Array(positions);
  dustParticles.frustumCulled = false;
  scene.add(dustParticles);
}

// Vertical FOV widens on portrait screens so the hall doesn't feel like a keyhole.
function applyResponsiveFov() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? Math.min(95, 65 + (1 - aspect) * 45) : 65;
  camera.updateProjectionMatrix();
}

// --- Enhanced Venue Lighting & Ceiling Illumination ---
function addVenueLighting() {
  // Ambient and hemisphere used to run at 0.80 / 0.90 on top of fourteen point lights. That
  // much uniform fill lands on every surface at the same strength regardless of orientation,
  // which flattens exactly the shading gradients that read as depth. With `scene.environment`
  // now carrying the indirect light (see generateEnvMap), these only need to lift the deepest
  // shadows off pure black.
  const ambientLight = new THREE.AmbientLight(0xf8f2e6, isLowPowerDevice ? 0.12 : 0.07);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xfff6ea, 0x2b2838, isLowPowerDevice ? 0.34 : 0.26);
  scene.add(hemiLight);

  const ceilingFixtures = [
    [9.68, 3.35, -4.5], [9.68, 3.35, -9.5], [9.68, 3.35, -14.5], [9.68, 3.35, -19.5],
    [6.5, 3.35, -6.0], [6.5, 3.35, -11.0], [6.5, 3.35, -16.0],
    [13.8, 3.35, -6.0], [13.8, 3.35, -11.0], [13.8, 3.35, -16.0],
    [22.5, 3.35, -5.0], [22.5, 3.35, -10.0], [22.5, 3.35, -15.0],
    [9.68, 3.4, -22.5],
  ];

  // Every point light costs a per-fragment lighting term on every surface it reaches, and
  // fourteen of them was the largest single shader cost in the hall. With the environment
  // providing fill, a thinned set of brighter fixtures reads better *and* renders faster.
  ceilingFixtures.forEach(([x, y, z], idx) => {
    if (isLowPowerDevice && idx % 2 === 1) return;
    const light = new THREE.PointLight(0xffe8cc, isLowPowerDevice ? 5.0 : 4.2, isLowPowerDevice ? 16 : 14, 1.6);
    light.position.set(x, y, z);
    scene.add(light);
  });

  const spotStage = new THREE.SpotLight(0xf0eaff, 2.2, 18, Math.PI / 5, 0.4, 1.2);
  spotStage.position.set(9.68, 3.8, -19.5);
  spotStage.target.position.set(9.68, 0.8, -23.5);
  spotStage.castShadow = !isLowPowerDevice;
  spotStage.shadow.mapSize.width = 1024;
  spotStage.shadow.mapSize.height = 1024;
  scene.add(spotStage); scene.add(spotStage.target);

  const stageFillL = new THREE.SpotLight(0xffeedd, 0.7, 14, Math.PI / 4, 0.5, 1.5);
  stageFillL.position.set(5.5, 3.4, -21.0);
  stageFillL.target.position.set(8.0, 1.0, -23.5);
  scene.add(stageFillL); scene.add(stageFillL.target);

  const stageFillR = new THREE.SpotLight(0xffeedd, 0.7, 14, Math.PI / 4, 0.5, 1.5);
  stageFillR.position.set(14.0, 3.4, -21.0);
  stageFillR.target.position.set(11.0, 1.0, -23.5);
  scene.add(stageFillR); scene.add(stageFillR.target);

  const entranceLight = new THREE.SpotLight(0xfff5e6, 0.8, 12, Math.PI / 3, 0.7, 1.8);
  entranceLight.position.set(9.68, 3.35, -1.2);
  entranceLight.target.position.set(9.68, 0, -2.5);
  scene.add(entranceLight); scene.add(entranceLight.target);

  // Soft rectangular backlight wash behind the stage screen (desktop only)
  if (!isLowPowerDevice) {
    try {
      RectAreaLightUniformsLib.init();
      const stageGlow = new THREE.RectAreaLight(0x8090ff, 1.2, 7.0, 3.5);
      stageGlow.position.set(9.68, 2.3, -24.8);
      stageGlow.lookAt(9.68, 2.3, -20.0);
      scene.add(stageGlow);
    } catch (e) { /* RectAreaLight not critical */ }
  }
}

// --- Load the venue GLB ---
//
// Everything about the materials now comes from the GLB itself. The previous version
// re-downloaded nine normal and roughness PNGs with THREE.TextureLoader and assigned them by
// matching substrings of material names — even though the very same images were already
// embedded in the model. That was roughly 10 MB of redundant decode and a second copy of every
// map in GPU memory. scripts/build_venue.py now bakes correct world-scale UVs and packed
// ORM maps into the export, so the runtime's only job is to set filtering and shadow flags.
function loadHallModel() {
  setLoadProgress(null, 'Downloading venue…');

  const loader = new GLTFLoader();
  // Geometry ships meshopt-compressed (see the export settings in scripts/build_venue.py).
  loader.setMeshoptDecoder(MeshoptDecoder);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  loader.load('/models/diplomatic_hall.glb', (gltf) => {
    hallModel = gltf.scene;

    // The GLB is exported without lights or cameras now, but a stale model should still not be
    // able to inject a second lighting rig on top of addVenueLighting().
    const strays = [];
    hallModel.traverse((child) => { if (child.isLight || child.isCamera) strays.push(child); });
    strays.forEach(l => l.parent && l.parent.remove(l));

    // Meshes the runtime replaces with its own procedural versions. build_venue.py drops these
    // from the export, so this is now a guard against an older GLB rather than the mechanism.
    const HIDE_NODE_RE = /^(Table_C_Dressed|T_Desk(\.?001)?$|Welcome_Desk$|Commitment_Wall$)/;
    const SCREEN_MAT_RE = /^Mat_Booth_\d+_Screen$/;

    // Only props should cast shadows. Setting castShadow on the walls, floor and ceiling made
    // the shadow pass re-render the entire hall every frame to light a single spot.
    const NO_CAST_RE = /^(Hall_Floor|Corridor_Floor|Venue_Ceiling|Venue_Walls)$/;

    const seen = new Set();
    let meshes = 0;

    hallModel.traverse((child) => {
      if (HIDE_NODE_RE.test(child.name || '')) child.visible = false;
      if (!child.isMesh) return;
      meshes++;

      child.castShadow = !isLowPowerDevice && !NO_CAST_RE.test(child.parent?.name || child.name || '');
      child.receiveShadow = true;

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat || seen.has(mat.uuid)) continue;
        seen.add(mat.uuid);

        if (SCREEN_MAT_RE.test(mat.name || '')) {
          child.visible = false;
          continue;
        }

        // Anisotropic filtering matters enormously here: the floors are large planes viewed at
        // a grazing angle, which is the exact case trilinear mipmapping blurs into mush.
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const tex = mat[key];
          if (tex) {
            tex.anisotropy = maxAniso;
            tex.needsUpdate = true;
          }
        }

        // The ceiling plane is single-sided and faces down; it is also the only surface the
        // player can end up looking at from above while teleporting.
        if (/ceil/i.test(mat.name || '')) mat.side = THREE.DoubleSide;
      }
    });

    scene.add(hallModel);

    // The venue never moves, so its shadow map only has to be rendered once rather than at
    // every frame for the life of the session.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    console.info(`[venue] ${meshes} meshes, ${seen.size} materials`);
    markVenueLoaded(true);
  }, (xhr) => {
    if (xhr && xhr.total) {
      const ratio = xhr.loaded / xhr.total;
      setLoadProgress(ratio, `Loading venue… ${Math.round(ratio * 100)}%`);
    } else if (xhr && xhr.loaded) {
      setLoadProgress(null, `Loading venue… ${(xhr.loaded / 1048576).toFixed(1)} MB`);
    }
  }, (err) => {
    console.error('Failed to load hall model', err);
    markVenueLoaded(false);
    showToast('The 3D venue model failed to load. Check your connection and refresh.', { icon: '⚠️', type: 'danger', duration: 5000 });
  });
}

// --- Floating 3D Holographic Markers + Booth Labels ---
const MARKER_COLORS = { unvisited: 0x00d4ff, visited: 0x10b981, target: 0xf59e0b };

function createBoothLabelTexture(booth, state) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const accent = state === 'target' ? '#f59e0b' : state === 'visited' ? '#10b981' : '#00d4ff';
  ctx.fillStyle = 'rgba(8, 13, 26, 0.86)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(6, 6, 372, 116, 26);
  ctx.fill();
  ctx.stroke();

  // Number block
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(18, 18, 92, 92, 18);
  ctx.fill();
  ctx.fillStyle = '#04070f';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pad2(booth.id), 64, 66);

  // Text
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText((booth.name || booth.title).slice(0, 14), 128, 60);
  ctx.fillStyle = accent;
  ctx.font = 'bold 22px sans-serif';
  const statusText = state === 'visited' ? '✓ VISITED' : state === 'target' ? '◎ TRACKING' : (booth.category || '').toUpperCase();
  ctx.fillText(statusText, 128, 96);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function boothState(id) {
  if (activeWaypointId === id) return 'target';
  if (visitedBooths.has(id)) return 'visited';
  return 'unvisited';
}

function refreshBoothVisual(id) {
  const b = BOOTH_POSITIONS[id];
  const state = boothState(id);
  const marker = boothMarkers.find(m => m.userData.boothId === id);
  if (marker) {
    if (marker.userData.core) marker.userData.core.material.color.setHex(MARKER_COLORS[state]);
    if (marker.userData.wire) marker.userData.wire.material.color.setHex(MARKER_COLORS[state]);
    if (marker.userData.glow) marker.userData.glow.material.color.setHex(MARKER_COLORS[state]);
    marker.userData.state = state;
  }
  const label = boothLabels.get(id);
  if (label) {
    const info = boothsData.find(x => x.id === id) || {};
    if (label.material.map) label.material.map.dispose();
    label.material.map = createBoothLabelTexture({ id, ...b, name: info.name }, state);
    label.material.needsUpdate = true;
  }
}

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
const markerGlowTex = createGlowTexture();

/** Soft radial falloff used for the ambient-occlusion discs under furniture. */
function createContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // Flat in the middle, then a long tail: a hard-edged blob reads as a decal, not as shade.
  grad.addColorStop(0.0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

let contactShadowMat = null;

/**
 * Lays a soft shadow disc on the floor. `w`/`d` are the footprint in metres.
 * All discs share one geometry and material, so the whole set is a handful of draw calls.
 */
function addContactShadow(x, z, w, d, { y = 0.015, rotation = 0 } = {}) {
  if (!contactShadowMat) {
    contactShadowMat = new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      // Without a polygon offset these z-fight with the floor at grazing angles.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }
  const mesh = new THREE.Mesh(_contactShadowGeo, contactShadowMat);
  mesh.scale.set(w, d, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.position.set(x, y, z);
  mesh.renderOrder = -1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);
  return mesh;
}

const _contactShadowGeo = new THREE.PlaneGeometry(1, 1);

/** Grounds the booth stands, the welcome desk and the commitment wall. */
function createContactShadows() {
  for (const b of Object.values(BOOTH_POSITIONS)) {
    // One disc per physical stand, not per booth: booths pair up back to back on one panel.
    if (b.facing !== 1) continue;
    addContactShadow(b.x, b.z, 4.6, 2.9);
  }
  for (const box of [WELCOME_DESK_BOX, COMMITMENT_WALL_BOX]) {
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    addContactShadow(cx, cz, (box.maxX - box.minX) + 2.0, (box.maxZ - box.minZ) + 1.6);
  }
  for (const { org } of organizerBooths.values()) {
    addContactShadow(org.x, org.z, 4.4, 3.4);
  }
}

function createHolographicMarkers() {
  const markerGeo = new THREE.ConeGeometry(0.22, 0.42, 4);
  markerGeo.rotateX(Math.PI);

  for (const [idStr, b] of Object.entries(BOOTH_POSITIONS)) {
    const id = parseInt(idStr);
    const state = boothState(id);
    
    const marker = new THREE.Group();
    
    // Core glowing mesh
    const coreMat = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[state], transparent: true, opacity: 0.85 });
    const core = new THREE.Mesh(markerGeo, coreMat);
    core.scale.set(0.65, 0.9, 0.65);
    
    // Outer wireframe
    const wireMat = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[state], wireframe: true, transparent: true, opacity: 0.5 });
    const wire = new THREE.Mesh(markerGeo, wireMat);
    
    // Floor glow
    const glowMat = new THREE.MeshBasicMaterial({ map: markerGlowTex, color: MARKER_COLORS[state], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -2.44; // drop to the floor
    
    marker.add(core, wire, glow);
    
    const mx = b.x + b.facing * 0.55;
    marker.position.set(mx, 2.45, b.z);
    marker.userData = { boothId: id, initialY: 2.45, state, facing: b.facing, panelX: b.x, core, wire, glow };
    scene.add(marker);
    boothMarkers.push(marker);

    const info = boothsData.find(x => x.id === id) || {};
    const tex = createBoothLabelTexture({ id, ...b, name: info.name }, state);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
    const label = new THREE.Sprite(spriteMat);
    label.scale.set(1.32, 0.44, 1);
    label.position.set(mx, 2.85, b.z);
    label.userData = { boothId: id, facing: b.facing, panelX: b.x };
    scene.add(label);
    boothLabels.set(id, label);
  }
}

// --- Booth TVs (muted looping video in 3D; sound only in the pop-up) ---
function boothScreenVideoSrc(boothId) {
  const info = boothsData.find(b => b.id === boothId);
  return (info && info.screenVideo) || DEFAULT_SCREEN_VIDEO;
}

/** One hidden <video> per distinct source, shared by every TV that shows it. */
function getSharedVideo(src) {
  if (sharedVideos.has(src)) return sharedVideos.get(src);
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  let holder = $('tv-video-pool');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'tv-video-pool';
    holder.setAttribute('aria-hidden', 'true');
    Object.assign(holder.style, { position: 'fixed', width: '2px', height: '2px', left: '-10px', top: '-10px', overflow: 'hidden', opacity: '0.01', pointerEvents: 'none' });
    document.body.appendChild(holder);
  }
  holder.appendChild(video);
  video.play().catch(() => {});
  sharedVideos.set(src, video);
  return video;
}

/**
 * Builds a wall-mounted TV (bezel + video screen) and parents it at `localPos`.
 * `meta` is stored on the screen mesh so a raycast hit knows which pop-up to open.
 */
function attachTV(parent, localPos, meta) {
  const group = new THREE.Group();
  group.name = `TV_${meta.key}`;

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(TV_W + 0.09, TV_H + 0.09, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.15, metalness: 0.8 })
  );
  bezel.castShadow = false;
  bezel.receiveShadow = true;
  group.add(bezel);

  const video = getSharedVideo(meta.src || DEFAULT_SCREEN_VIDEO);
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(TV_W, TV_H),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  screen.position.z = 0.031;
  screen.userData = { ...meta, isTV: true };
  group.add(screen);

  // Standby LED + "tap for sound" glyph strip so the TV reads as interactive
  const led = new THREE.Mesh(
    new THREE.CircleGeometry(0.012, 12),
    new THREE.MeshBasicMaterial({ color: 0x00d4ff })
  );
  led.position.set(TV_W / 2 - 0.03, -TV_H / 2 - 0.025, 0.031);
  group.add(led);

  group.position.copy(localPos);
  parent.add(group);
  tvScreens.push(screen);
  return group;
}

function createBoothTVs() {
  for (const [idStr, b] of Object.entries(BOOTH_POSITIONS)) {
    const id = parseInt(idStr);
    const info = boothsData.find(x => x.id === id) || {};
    const mount = new THREE.Group();
    // Panel is 0.05m thick; its graphic sits at 0.045m in front of the panel centre.
    mount.position.set(b.x + b.facing * 0.045, 1.55, b.z);
    mount.rotation.y = b.facing === -1 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(mount);
    attachTV(mount, new THREE.Vector3(0, 0, 0.03), {
      key: `booth-${id}`,
      boothId: id,
      label: info.name && info.name !== b.title ? `${b.title} • ${info.name}` : b.title,
      src: boothScreenVideoSrc(id),
    });
  }
}

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/** Which TV (if any) is under the given NDC point, within reach. */
function pickTV(ndcX = 0, ndcY = 0, maxDist = TV_AIM_DISTANCE) {
  if (!tvScreens.length) return null;
  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, camera);
  _raycaster.far = maxDist;
  const hits = _raycaster.intersectObjects(tvScreens, false);
  return hits.length ? hits[0].object.userData : null;
}

function openTV(tv) {
  if (!tv) return;
  if (tv.boothId) {
    openBoothModal(tv.boothId, { tab: 'tab-media', playWithSound: true });
  } else if (tv.orgId) {
    openOrganizerModal(tv.orgId, { playWithSound: true });
  }
}

// --- Organizer booths (TdH · KNH · VEWU) in the Pre-Function Foyer ---
function createOrganizerBooths() {
  for (const org of organizersData) {
    const { group, solids } = buildOrganizerBooth(org, {
      castShadow: !isLowPowerDevice,
      attachTV: (parent, localPos) => attachTV(parent, localPos, {
        key: `org-${org.id}`,
        orgId: org.id,
        label: `${org.short} organizer booth`,
        src: org.screenVideo || DEFAULT_SCREEN_VIDEO,
      }),
    });
    group.position.set(org.x, 0, org.z);
    group.rotation.y = -Math.PI / 2; // graphic faces -X, into the foyer aisle
    scene.add(group);
    organizerBooths.set(org.id, { org, group });
    const boxes = organizerObstacles(group, solids);
    // The stand backs onto the foyer's east wall: close the sliver behind it so nobody squeezes in.
    boxes[0].maxX = Math.max(boxes[0].maxX, 27.0);
    staticBoxes.push(...boxes);

    HOTSPOTS[`org-${org.id}`] = {
      x: org.x - 1.95, z: org.z, radius: 2.0,
      title: `${org.name} • Organizer Booth`,
      action: 'Meet the organizers',
      modal: 'org-modal',
      orgId: org.id,
    };
  }
}

/** Brand colour that stays readable on the dark HUD/nameplates (the lighter of colour/accent). */
function brandHighlight(org) {
  if (!org) return '#F4B400';
  const lum = (hex) => {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const a = org.accent || org.color;
  return lum(a) > lum(org.color) ? a : org.color;
}

function createHallMascots() {
  const orgOf = (cfg) => organizersData.find(o => o.mascot === cfg.id) || null;
  mascots = createMascots(scene, mascotsData, {
    lowPower: isLowPowerDevice,
    colorFor: (cfg) => brandHighlight(orgOf(cfg)),
    themeFor: (cfg) => {
      const org = orgOf(cfg);
      return org ? { color: org.color, accent: org.accent, ink: org.ink } : {};
    },
  });
}

// --- Welcome & Information desk (replaces the GLB's stretched-texture cube) ---
let welcomeDesk = null;
function createWelcomeDesk() {
  const { group, solids } = buildWelcomeDesk({ castShadow: !isLowPowerDevice, isTouch: isTouchDevice });
  const s = HOTSPOTS.welcomeDesk;
  group.position.set(s.x, 0, s.z);
  group.rotation.y = Math.PI / 2; // fascia faces +X, toward the foyer aisle
  scene.add(group);
  welcomeDesk = group;

  // Tighten the collision box to the built counter (body + top + header sign).
  const [box] = organizerObstacles(group, [solids], 0.06);
  Object.assign(WELCOME_DESK_BOX, box);
}

// --- Helper to extract YouTube Video ID ---
export function extractYouTubeId(src) {
  if (!src) return 'vYIYIVmOo3Q';
  const raw = String(src).trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw, 'https://www.youtube.com');
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : 'vYIYIVmOo3Q';
    }
    const v = url.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const embed = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/);
    return embed ? embed[1] : 'vYIYIVmOo3Q';
  } catch {
    return 'vYIYIVmOo3Q';
  }
}

// --- Front Stage Screen (Real YouTube Video in 3D + Depth Occlusion + Proximity Audio) ---
function setupStageYouTubeScreen() {
  const mount = document.createElement('div');
  mount.id = 'stage-yt-mount';
  Object.assign(mount.style, {
    width: '1280px', height: '720px', backgroundColor: '#000000', pointerEvents: 'none',
    boxSizing: 'border-box', border: '10px solid #0f172a', boxShadow: '0 0 35px rgba(0, 212, 255, 0.45)',
    borderRadius: '6px', overflow: 'hidden',
  });
  mount.innerHTML = `<div id="stage-yt-player" style="width: 100%; height: 100%;"></div>`;

  stageCSSObject = new CSS3DObject(mount);
  stageCSSObject.position.set(9.68, 2.30, -24.95);
  stageCSSObject.scale.set(7.0 / 1280, 3.9375 / 720, 1);
  cssScene.add(stageCSSObject);

  if (cssRenderer) cssRenderer.render(cssScene, camera);

  initYouTubePlayer();
}

function initYouTubePlayer() {
  let attempts = 0;
  const tryInit = () => {
    if (ytStagePlayer) return;
    attempts++;
    const playerTarget = document.getElementById('stage-yt-player');
    if (typeof YT !== 'undefined' && YT.Player && playerTarget && document.body.contains(playerTarget)) {
      try {
        ytStagePlayer = new YT.Player('stage-yt-player', {
          videoId: currentVideoId,
          playerVars: {
            autoplay: 1, mute: 1, controls: 0, modestbranding: 1, rel: 0, loop: 1,
            playlist: currentVideoId, playsinline: 1, enablejsapi: 1,
          },
          events: {
            onReady: (e) => {
              try {
                e.target.playVideo();
                if (hasUserInteracted && soundEnabled) {
                  e.target.unMute();
                  updateStageVolume();
                }
              } catch (err) {}
            }
          }
        });
      } catch (err) {
        if (attempts < 30) setTimeout(tryInit, 400);
      }
    } else {
      if (attempts < 40) setTimeout(tryInit, 300);
    }
  };

  if (typeof window.onYouTubeIframeAPIReady === 'function') {
    const oldReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { oldReady(); tryInit(); };
  } else {
    window.onYouTubeIframeAPIReady = tryInit;
  }
  tryInit();
}

const STAGE_AUDIO_POS = new THREE.Vector3(9.68, 2.2, -25.0);
let lastStageVolume = -1;

function updateStageVolume() {
  if (!ytStagePlayer || typeof ytStagePlayer.setVolume !== 'function') return;
  try {
    const distToStage = camera.position.distanceTo(STAGE_AUDIO_POS);
    const inDifferentRoom = (player.pos.x > 19.35) || (player.pos.z < -24.9);

    let vol = 0;
    if (soundEnabled && !inDifferentRoom && !isPopupVideoPlaying()) {
      const maxDist = 22.0;
      const minDist = 7.0;
      const norm = Math.max(0, Math.min(1, 1 - (distToStage - minDist) / (maxDist - minDist)));
      vol = Math.round(norm * norm * 100);
    }
    if (vol !== lastStageVolume) {
      ytStagePlayer.setVolume(vol);
      lastStageVolume = vol;
    }
  } catch (err) {}
}

// --- Dynamic 3D Policy & Commitment Wall in Pre-Function Foyer ---
// Board: 3.8 × 1.9 m canvas (2048 × 1024 px) in a framed lightbox against the foyer's west wall.
const WALL_BOARD_W = 3.8;
const WALL_BOARD_H = 1.9;
const WALL_COLS = 6;
const WALL_ROWS = 3;
const WALL_NOTE_CAPACITY = WALL_COLS * WALL_ROWS;
let policyWallGroup = null;

function setupPolicyWall() {
  policyCanvas = document.createElement('canvas');
  policyCanvas.width = 2048;
  policyCanvas.height = 1024;
  policyCtx = policyCanvas.getContext('2d');

  policyTexture = new THREE.CanvasTexture(policyCanvas);
  policyTexture.colorSpace = THREE.SRGBColorSpace;
  policyTexture.anisotropy = 4;

  // Everything lives in a group so the board, frame and props share one placement.
  policyWallGroup = new THREE.Group();
  policyWallGroup.name = 'Commitment_Wall_Procedural';
  policyWallGroup.position.set(19.88, 0, -15.15);
  policyWallGroup.rotation.y = 1.6085; // faces +X into the foyer (same yaw as the GLB wall)
  scene.add(policyWallGroup);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.5, metalness: 0.4 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x00d4ff, emissive: 0x00d4ff, emissiveIntensity: 0.9, roughness: 0.3 });
  const shadows = !isLowPowerDevice;

  // Backing panel (slightly larger than the board) + bevel frame
  const backing = new THREE.Mesh(new THREE.BoxGeometry(WALL_BOARD_W + 0.24, WALL_BOARD_H + 0.24, 0.08), frameMat);
  backing.position.set(0, 1.35, 0);
  backing.castShadow = shadows;
  backing.receiveShadow = true;
  policyWallGroup.add(backing);

  const boardMat = new THREE.MeshStandardMaterial({ map: policyTexture, emissive: 0xffffff, emissiveMap: policyTexture, emissiveIntensity: 0.22, roughness: 0.45, metalness: 0.05 });
  policyBoardMesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_BOARD_W, WALL_BOARD_H), boardMat);
  policyBoardMesh.position.set(0, 1.35, 0.045);
  policyWallGroup.add(policyBoardMesh);

  // Lit header rail + side light strips
  const rail = new THREE.Mesh(new THREE.BoxGeometry(WALL_BOARD_W + 0.3, 0.06, 0.14), accentMat);
  rail.position.set(0, 1.35 + WALL_BOARD_H / 2 + 0.15, 0.03);
  policyWallGroup.add(rail);
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, WALL_BOARD_H + 0.24, 0.02), accentMat);
    strip.position.set(sx * (WALL_BOARD_W / 2 + 0.135), 1.35, 0.045);
    policyWallGroup.add(strip);
  }

  // Plinth + marker ledge with a few pens
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(WALL_BOARD_W + 0.5, 0.12, 0.45), frameMat);
  plinth.position.set(0, 0.06, 0.16);
  plinth.receiveShadow = true;
  policyWallGroup.add(plinth);
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.14), new THREE.MeshStandardMaterial({ color: 0xe6dfd2, roughness: 0.4 }));
  ledge.position.set(0, 1.35 - WALL_BOARD_H / 2 - 0.02, 0.12);
  policyWallGroup.add(ledge);
  [0xf59e0b, 0x10b981, 0x3b82f6, 0xec4899].forEach((c, i) => {
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    pen.rotation.z = Math.PI / 2 - 0.15 * (i - 1.5);
    pen.position.set(-0.45 + i * 0.3, 1.35 - WALL_BOARD_H / 2 + 0.015, 0.12);
    policyWallGroup.add(pen);
  });

  updatePolicyWallTexture();
}

function formatPledgeStamp(p) {
  const who = (p && p.by) ? String(p.by).slice(0, 18) : 'Delegate';
  if (!p || !p.ts) return who;
  const d = new Date(p.ts);
  if (Number.isNaN(d.getTime())) return who;
  return `${who} • ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function updatePolicyWallTexture() {
  if (!policyCtx) return;
  const ctx = policyCtx;
  const w = policyCanvas.width;
  const h = policyCanvas.height;

  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#0b132b');
  bgGrad.addColorStop(0.5, '#1c2541');
  bgGrad.addColorStop(1, '#0b132b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(14, 165, 233, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const pledges = getPledges();
  const shown = pledges.slice(0, WALL_NOTE_CAPACITY);
  const overflow = Math.max(0, pledges.length - shown.length);

  // Header
  const headerH = 84;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.fillRect(32, 24, w - 64, headerH);
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 24, w - 64, headerH);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 34px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('📌 YOUTH COMMITMENT & PLEDGE WALL', 60, 68);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Delegate pledges, climate actions & youth leadership declarations • Youth Innovations Marketplace • Marriott Manila', 60, 96);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 21px "Outfit", sans-serif';
  ctx.fillText(isTouchDevice ? '● LIVE BOARD • TAP TO ADD YOURS' : '● LIVE BOARD • PRESS [E] TO ADD YOURS', w - 64, 62);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${pledges.length} pledge${pledges.length === 1 ? '' : 's'} posted${overflow ? ` • ${shown.length} newest shown, +${overflow} more in the pop-up` : ''}`, w - 64, 94);
  ctx.textAlign = 'left';

  // Sticky grid (newest first, top-left)
  const cols = WALL_COLS;
  const rows = WALL_ROWS;
  const marginX = 48;
  const marginTop = 24 + headerH + 26;
  const marginBottom = 30;
  const gapX = 22;
  const gapY = 22;
  const cardW = (w - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardH = (h - marginTop - marginBottom - gapY * (rows - 1)) / rows;

  const stickyColors = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#ddd6fe'];

  for (let idx = 0; idx < cols * rows; idx++) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (cardW + gapX);
    const y = marginTop + row * (cardH + gapY);
    const p = shown[idx];

    if (!p) {
      // Empty slot: faint outline invites the next pledge
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 6, y + 6, cardW - 12, cardH - 12);
      ctx.restore();
      if (idx === shown.length) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('your pledge here', x + cardW / 2, y + cardH / 2 + 7);
        ctx.textAlign = 'left';
      }
      continue;
    }

    ctx.save();
    const angle = ((idx * 7) % 7 - 3) * (Math.PI / 180) * 0.7;
    ctx.translate(x + cardW / 2, y + cardH / 2);
    ctx.rotate(angle);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = p.color || stickyColors[idx % stickyColors.length];
    ctx.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);
    ctx.shadowColor = 'transparent';

    // Tape
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(-34, -cardH / 2 - 6, 68, 16);

    // Label strip
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(-cardW / 2 + 12, -cardH / 2 + 16, cardW - 24, 20);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(idx === 0 ? 'LATEST PLEDGE' : `PLEDGE #${pledges.length - idx}`, -cardW / 2 + 20, -cardH / 2 + 30);

    // Body text: shrink until it fits the card
    ctx.fillStyle = '#0f172a';
    const maxTextH = cardH - 96;
    let size = 21;
    let lines;
    do {
      ctx.font = `bold ${size}px "Plus Jakarta Sans", "Outfit", sans-serif`;
      lines = wrapLinesArr(ctx, `“${p.text}”`, cardW - 32);
      if (lines.length * (size + 5) <= maxTextH || size <= 13) break;
      size -= 1;
    } while (true);
    const lineH = size + 5;
    const maxLines = Math.max(1, Math.floor(maxTextH / lineH));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*$/, '') + '…';
    }
    lines.forEach((line, i) => ctx.fillText(line, -cardW / 2 + 16, -cardH / 2 + 62 + i * lineH));

    // Footer: who + when
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.font = 'italic 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(formatPledgeStamp(p), -cardW / 2 + 16, cardH / 2 - 14);

    ctx.restore();
  }

  policyTexture.needsUpdate = true;
}

function wrapLinesArr(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- Multiplayer System ---
function initMultiplayer() {
  const loader = new GLTFLoader();
  loader.load('/models/avatar.glb', (gltf) => {
    avatarTemplate = gltf.scene;
    connectPresenceServer();
  }, undefined, () => {
    avatarTemplate = createProceduralAvatar();
    connectPresenceServer();
  });
}

function createProceduralAvatar() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.95, 12);
  const headGeo = new THREE.SphereGeometry(0.18, 12, 12);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4FA69C, roughness: 0.5 });

  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 1.50;

  group.add(body);
  group.add(head);
  return group;
}

function createNameplateSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 76;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(10, 15, 26, 0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 60, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DELEGATE', 128, 28);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(name, 128, 54);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.4, 0.42, 1);
  sprite.position.set(0, 1.95, 0);
  return sprite;
}

function spawnRemoteAvatar(v) {
  if (!v || !v.id) return;
  if (presence && v.id === presence.visitor.id) return;
  if (remotePlayers.has(v.id)) {
    const existing = remotePlayers.get(v.id);
    existing.targetPos.set(v.x || 9.68, 0, v.z || -2.5);
    existing.targetYaw = v.yaw || 0;
    return;
  }
  if (!avatarTemplate) return;

  const model = avatarTemplate.clone(true);
  model.position.set(v.x || 9.68, 0, v.z || -2.5);
  model.rotation.y = v.yaw || 0;

  const visitorColor = v.color || colorFromId(v.id);
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = !isLowPowerDevice;
      child.receiveShadow = true;
      if (child.material) {
        child.material = child.material.clone();
        child.material.color = new THREE.Color(visitorColor);
        child.material.roughness = 0.55;
      }
    }
  });

  model.add(createNameplateSprite(v.name || 'Delegate', visitorColor));
  scene.add(model);
  remotePlayers.set(v.id, {
    model,
    targetPos: new THREE.Vector3(v.x || 9.68, 0, v.z || -2.5),
    targetYaw: v.yaw || 0,
    walkTimer: 0,
  });
}

function removeRemoteAvatar(id) {
  if (!id || !remotePlayers.has(id)) return;
  const rp = remotePlayers.get(id);
  scene.remove(rp.model);
  remotePlayers.delete(id);
}

function updateRemoteAvatars(delta) {
  for (const rp of remotePlayers.values()) {
    rp.model.position.lerp(rp.targetPos, Math.min(1.0, 10.0 * delta));

    let diff = rp.targetYaw - rp.model.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    rp.model.rotation.y += diff * Math.min(1.0, 10.0 * delta);

    const dx = camera.position.x - rp.model.position.x;
    const dz = camera.position.z - rp.model.position.z;
    rp.model.visible = Math.hypot(dx, dz) >= 2.2;

    const distMoved = rp.model.position.distanceTo(rp.targetPos);
    if (distMoved > 0.05) {
      rp.walkTimer += delta * 12;
      rp.model.position.y = Math.abs(Math.sin(rp.walkTimer)) * 0.06;
    } else {
      rp.walkTimer = 0;
      rp.model.position.y = 0;
    }
  }
}

function connectPresenceServer() {
  presence = createPresence({
    onWelcome: (data) => {
      const list = Array.isArray(data.visitors) ? data.visitors : [];
      const seen = new Set();
      for (const v of list) {
        if (!v || !v.id) continue;
        seen.add(v.id);
        spawnRemoteAvatar(v);
      }
      // Soft reconnect: keep matching avatars; drop anyone no longer in the snapshot.
      for (const id of Array.from(remotePlayers.keys())) {
        if (!seen.has(id)) removeRemoteAvatar(id);
      }
      if (data.count) updateOnlineCount(data.count);
      if (data.screen && data.screen.src) currentVideoId = extractYouTubeId(data.screen.src);
      // Shared wall: the server keeps every pledge posted while it has been running.
      if (Array.isArray(data.pledges) && data.pledges.length) addPledges(data.pledges);
      if (data.engagement) applyEngagementMap(data.engagement);
      maybeEmitPageView();
    },
    onJoined: (visitor) => {
      spawnRemoteAvatar(visitor);
    },
    onMoved: (data) => {
      const rp = remotePlayers.get(data.id);
      // Legacy 2D presence only sends x/y — keep the avatar's current z/yaw when missing.
      const z = Number.isFinite(Number(data.z)) ? Number(data.z) : (rp ? rp.targetPos.z : -2.5);
      const yaw = Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : (rp ? rp.targetYaw : 0);
      if (rp) {
        rp.targetPos.set(Number(data.x) || rp.targetPos.x, 0, z);
        rp.targetYaw = yaw;
      } else {
        spawnRemoteAvatar({ ...data, z, yaw });
      }
    },
    onLeft: removeRemoteAvatar,
    onCount: updateOnlineCount,
    onScreen: (screen) => {
      if (screen && screen.src) {
        const nextId = extractYouTubeId(screen.src);
        if (nextId !== currentVideoId) {
          currentVideoId = nextId;
          if (ytStagePlayer && typeof ytStagePlayer.loadVideoById === 'function') {
            ytStagePlayer.loadVideoById(currentVideoId);
          }
          showToast('The stage stream was changed by another delegate.', { icon: '📺' });
        }
      }
    },
    onPledge: (pledge) => {
      if (pledge && pledge.text) {
        const added = addPledges([pledge]);
        if (added > 0) showToast('A new pledge was posted to the Commitment Wall.', { icon: '📌', type: 'success' });
      }
    },
    onHeart: (heart) => {
      // Legacy delta broadcasts — prefer booth_engagement when available.
      if (!heart || !BOOTH_POSITIONS[heart.boothId]) return;
      if (boothEngagement.has(heart.boothId)) return;
      const next = Math.max(0, getHeartCount(heart.boothId) + (heart.delta > 0 ? 1 : -1));
      setHeartCount(heart.boothId, next);
      if (currentBoothId === heart.boothId) $('modal-heart-count').textContent = next;
    },
    onEngagement: applyBoothEngagement,
    onCommentRejected: (msg) => {
      const hint = $('booth-comment-hint');
      if (!hint) return;
      hint.textContent = msg && msg.reason === 'too_fast'
        ? 'Give it a few seconds between comments.'
        : 'Could not post that note — try a shorter message.';
    },
    onStatus: updatePresenceStatus,
  });
}

let presenceWasConnected = false;
let presenceOfflineTimer = null;
function updatePresenceStatus({ connected, everConnected, attempt }) {
  const badge = $('multiplayer-badge');
  const label = badge ? badge.querySelector('.pill-label') : null;

  if (connected) {
    if (presenceOfflineTimer) {
      clearTimeout(presenceOfflineTimer);
      presenceOfflineTimer = null;
    }
    if (badge) {
      badge.classList.remove('offline');
      badge.title = 'Live delegates in the hall';
    }
    if (label) label.textContent = 'Online';
    if (!presenceWasConnected && everConnected && presenceOfflineToastShown) {
      showToast('Connected to the live hall — other delegates are now visible.', { icon: '🌐', type: 'success' });
    }
    presenceWasConnected = true;
    return;
  }

  // Brief blips (Render hiccups / tab sleep): keep Online until ~3s of sustained disconnect.
  if (presenceWasConnected && !presenceOfflineTimer) {
    presenceOfflineTimer = setTimeout(() => {
      presenceOfflineTimer = null;
      if (presence && presence.isConnected()) return;
      presenceWasConnected = false;
      if (badge) {
        badge.classList.add('offline');
        badge.title = 'Multiplayer server not reachable — exploring solo. Start it with `npm run dev` (or `npm run server`).';
      }
      if (label) label.textContent = 'Solo';
      updateOnlineCount(1);
      // Keep remotes until welcome/left syncs — avoids flicker on soft reconnect.
      showToast('Lost the multiplayer connection — retrying in the background.', { icon: '📡', type: 'danger' });
      presenceOfflineToastShown = true;
    }, 3000);
    return;
  }

  if (!presenceWasConnected && !everConnected && attempt >= 2 && !presenceOfflineToastShown) {
    // Tried the proxy and the direct port: the server isn't running. Say so once, then stay quiet.
    presenceOfflineToastShown = true;
    if (badge) {
      badge.classList.add('offline');
      badge.title = 'Multiplayer server not reachable — exploring solo. Start it with `npm run dev` (or `npm run server`).';
    }
    if (label) label.textContent = 'Solo';
    showToast('Multiplayer server offline — exploring solo. Run "npm run dev" to bring the hall online.', { icon: '📡', duration: 5000 });
  }
}

function updateOnlineCount(count) {
  const el = $('online-count');
  if (el) el.textContent = Math.max(1, count);
}

// --- Sitting & Standing Mechanics ---
function sitDownOnChair(chair) {
  player.isSitting = true;
  player.sittingChairId = chair.id;
  player.pos.set(chair.x, 0.95, chair.z);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0.05;

  $('sitting-hud').classList.remove('hidden');
  $('mobile-stand-btn').classList.remove('hidden');
  $('proximity-prompt').classList.add('hidden');
  showToast(`Seated at ${chair.label}. Enjoy the keynote!`, { icon: '🪑' });
}

function standUp() {
  if (!player.isSitting) return;
  player.isSitting = false;
  player.sittingChairId = null;
  player.pos.y = player.eyeHeight;
  player.pos.z += 0.45;

  $('sitting-hud').classList.add('hidden');
  $('mobile-stand-btn').classList.add('hidden');
}

// --- Controls & PointerLock ---
function setupControls() {
  const blocker = $('blocker');
  const startBtn = $('start-btn');

  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    enterHall();
  });

  // Click anywhere on the overlay (outside the card) also enters / resumes.
  blocker.addEventListener('click', (e) => {
    if (e.target.closest('.welcome-card')) return;
    enterHall();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === document.body) {
      isPointerLocked = true;
      hideBlocker();
    } else {
      isPointerLocked = false;
      resetMovementKeys();
      // Pointer left the game with nothing on screen to explain why → show pause overlay.
      if (hasStarted && !isTouchDevice && openModals.size === 0 && !isBlockerVisible()) {
        showBlocker('paused');
      }
    }
  });

  document.addEventListener('pointerlockerror', () => {
    isPointerLocked = false;
    if (hasStarted && !isTouchDevice && openModals.size === 0) showBlocker('paused');
  });

  // Clicking the 3D view when unlocked (desktop) re-locks.
  $('canvas-container').addEventListener('click', () => {
    if (!isTouchDevice && hasStarted && !isPointerLocked && openModals.size === 0 && !isBlockerVisible()) {
      requestLock();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    mouseDeltaX += e.movementX;
    mouseDeltaY += e.movementY;
  });

  // While the cursor is locked, a left click on a TV opens its pop-up (with sound).
  document.addEventListener('mousedown', (e) => {
    if (!isPointerLocked || e.button !== 0 || openModals.size > 0 || player.isSitting) return;
    // Re-raycast instead of reading the cached `aimedTV`: that cache refreshes at 20 Hz, and a
    // click landing between refreshes while the player turns would open the wrong TV.
    const tv = pickTV(0, 0) || aimedTV;
    if (tv) openTV(tv);
  });

  window.addEventListener('keydown', (e) => {
    // Never hijack typing in inputs/textareas.
    if (isTypingTarget(e.target)) {
      if (e.code === 'Escape') e.target.blur();
      return;
    }

    // Overlay visible: Enter / Space enter or resume the hall.
    if (isBlockerVisible()) {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        enterHall();
      } else if (e.code === 'Escape' && hasStarted && blocker.dataset.mode === 'help') {
        enterHall();
      }
      return;
    }

    // A modal is open: only modal-related shortcuts.
    if (openModals.size > 0) {
      switch (e.code) {
        case 'Escape': closeAllModals(); break;
        case 'KeyP': togglePassportModal(); break;
        case 'KeyT': toggleTeleportModal(); break;
        case 'KeyM': toggleSound(); break;
      }
      return;
    }

    if (player.isSitting && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      standUp();
      return;
    }

    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = true; e.preventDefault(); break;
      case 'KeyS': case 'ArrowDown': keys.backward = true; e.preventDefault(); break;
      case 'KeyA': case 'ArrowLeft': keys.left = true; e.preventDefault(); break;
      case 'KeyD': case 'ArrowRight': keys.right = true; e.preventDefault(); break;
      case 'KeyE': handleInteract(); break;
      case 'KeyP': togglePassportModal(); break;
      case 'KeyT': toggleTeleportModal(); break;
      case 'KeyM': toggleSound(); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyR':
        teleportPlayer(9.68, 1.45, -2.5, 0);
        showToast('Returned to the South Entrance.', { icon: '🚪' });
        break;
      case 'Escape':
        if (hasStarted && !isTouchDevice) showBlocker('paused');
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = false; break;
      case 'KeyS': case 'ArrowDown': keys.backward = false; break;
      case 'KeyA': case 'ArrowLeft': keys.left = false; break;
      case 'KeyD': case 'ArrowRight': keys.right = false; break;
    }
  });

  // Losing window focus must never leave a key "stuck down".
  window.addEventListener('blur', resetMovementKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetMovementKeys(); });
}

// --- Mobile Phone Touch Controls (Joystick & Drag Look on the 3D view) ---
function setupMobileControls() {
  const joystickZone = $('joystick-zone');
  const joystickKnob = $('joystick-knob');
  const joystickBase = $('joystick-base');

  if (joystickZone && joystickKnob && joystickBase) {
    const handleJoystick = (touch) => {
      if (player.isSitting) standUp();

      const rect = joystickBase.getBoundingClientRect();
      const maxDist = rect.width * 0.36;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = touch.clientX - centerX;
      const dy = touch.clientY - centerY;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, maxDist);

      const knobX = Math.cos(angle) * clampedDist;
      const knobY = Math.sin(angle) * clampedDist;
      joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      const rawX = knobX / maxDist;
      const rawY = knobY / maxDist;
      
      // Exponential curve for finer control at low speeds
      joystickVec.x = Math.sign(rawX) * Math.pow(Math.abs(rawX), 1.5);
      joystickVec.y = Math.sign(rawY) * Math.pow(Math.abs(rawY), 1.5);
    };

    joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (joystickTouchId === null) {
          joystickTouchId = e.changedTouches[i].identifier;
          joystickZone.classList.add('active');
          handleJoystick(e.changedTouches[i]);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === joystickTouchId) {
          handleJoystick(e.touches[i]);
          break;
        }
      }
    }, { passive: false });

    const resetJoystick = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          joystickTouchId = null;
          joystickVec.x = 0;
          joystickVec.y = 0;
          joystickKnob.style.transform = `translate(0px, 0px)`;
          joystickZone.classList.remove('active');
          break;
        }
      }
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);
  }

  // Drag-to-look is attached to the 3D view itself, so HUD elements layered above it
  // (minimap, pills, prompts) stay tappable everywhere on screen.
  const lookSurface = $('canvas-container');
  let lookTouchStart = null; // { x, y, t } — to tell a tap (open TV) from a drag (look)
  if (lookSurface) {
    lookSurface.addEventListener('touchstart', (e) => {
      if (!isTouchDevice) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joystickTouchId) continue;
        if (lookTouchId === null) {
          lookTouchId = t.identifier;
          touchLookLastX = t.clientX;
          touchLookLastY = t.clientY;
          lookTouchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
          break;
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier === lookTouchId) {
          const dx = t.clientX - touchLookLastX;
          const dy = t.clientY - touchLookLastY;
          touchLookLastX = t.clientX;
          touchLookLastY = t.clientY;

          // Deadzone to prevent micro-jitter when thumb is resting
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            mouseDeltaX += dx;
            mouseDeltaY += dy;
          }
          break;
        }
      }
    }, { passive: true });

    const resetLook = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          lookTouchId = null;
          // A short, still touch on the 3D view is a tap: open the TV under the finger, if any.
          if (e.type === 'touchend' && lookTouchStart && openModals.size === 0 && !isBlockerVisible() && !player.isSitting) {
            const moved = Math.hypot(t.clientX - lookTouchStart.x, t.clientY - lookTouchStart.y);
            const held = performance.now() - lookTouchStart.t;
            if (moved < 12 && held < 350) {
              const ndcX = (t.clientX / window.innerWidth) * 2 - 1;
              const ndcY = -(t.clientY / window.innerHeight) * 2 + 1;
              const tv = pickTV(ndcX, ndcY, TV_AIM_DISTANCE + 1.5);
              if (tv) openTV(tv);
            }
          }
          lookTouchStart = null;
          break;
        }
      }
    };

    window.addEventListener('touchend', resetLook);
    window.addEventListener('touchcancel', resetLook);
  }

  const mobileInteract = $('mobile-interact-btn');
  if (mobileInteract) {
    mobileInteract.addEventListener('click', (e) => {
      e.preventDefault();
      handleInteract();
    });
  }

  $('mobile-stand-btn').addEventListener('click', (e) => { e.preventDefault(); standUp(); });
  $('stand-up-btn').addEventListener('click', standUp);

  // The floating prompt is itself a button on touch devices.
  $('proximity-prompt').addEventListener('click', () => {
    if (isTouchDevice) handleInteract();
  });
}

// --- Collision System with Smooth Wall Sliding & Chair Collision ---
/** Clamp the player center inside the hall/foyer inner wall faces. */
function clampWorld(p, r) {
  if (p.x < WORLD_BOUNDS.minX + r) p.x = WORLD_BOUNDS.minX + r;
  if (p.x > WORLD_BOUNDS.maxX - r) p.x = WORLD_BOUNDS.maxX - r;
  if (p.z < WORLD_BOUNDS.minZ + r) p.z = WORLD_BOUNDS.minZ + r;
  if (p.z > WORLD_BOUNDS.maxZ - r) p.z = WORLD_BOUNDS.maxZ - r;
}

/**
 * Push a circular player out of an AABB. Uses closest-point depenetration so
 * corners (not just flat faces) keep a full radius of clearance.
 */
function pushOutOfBox(p, box, r) {
  const cx = Math.max(box.minX, Math.min(p.x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(p.z, box.maxZ));
  let dx = p.x - cx;
  let dz = p.z - cz;

  if (dx === 0 && dz === 0) {
    // Center is inside the box — exit along the shortest face.
    const dxMin = p.x - box.minX;
    const dxMax = box.maxX - p.x;
    const dzMin = p.z - box.minZ;
    const dzMax = box.maxZ - p.z;
    const m = Math.min(dxMin, dxMax, dzMin, dzMax);
    if (m === dxMin) p.x = box.minX - r;
    else if (m === dxMax) p.x = box.maxX + r;
    else if (m === dzMin) p.z = box.minZ - r;
    else p.z = box.maxZ + r;
    return true;
  }

  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist >= r || dist < 1e-8) return false;
  const s = r / dist;
  p.x = cx + dx * s;
  p.z = cz + dz * s;
  return true;
}

function pushOutOfCircle(p, cx, cz, radius, r) {
  const dx = p.x - cx;
  const dz = p.z - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = radius + r;
  if (dist < minDist) {
    if (dist > 0.001) {
      p.x = cx + (dx / dist) * minDist;
      p.z = cz + (dz / dist) * minDist;
    } else {
      p.x = cx + minDist;
    }
    return true;
  }
  return false;
}

function resolveSolids(p, r) {
  clampWorld(p, r);
  for (const box of staticBoxes) pushOutOfBox(p, box, r);
  if (mascots) {
    for (const o of mascots.obstacles) pushOutOfCircle(p, o.x, o.z, o.r, r);
  }
  const boothRadius = 0.95;
  for (const b of Object.values(BOOTH_POSITIONS)) {
    pushOutOfCircle(p, b.x, b.z, boothRadius, r);
  }
  const chairRadius = 0.32;
  for (const c of CHAIR_LOCATIONS) {
    if (player.isSitting && player.sittingChairId === c.id) continue;
    pushOutOfCircle(p, c.x, c.z, chairRadius, r);
  }
  // Circles can shove the player back into a wall — re-apply walls + world clamp.
  clampWorld(p, r);
  for (const box of staticBoxes) pushOutOfBox(p, box, r);
  clampWorld(p, r);
}

function checkCollision(nextPos) {
  const r = player.radius;
  // A few passes so overlapping solids / corner contacts settle cleanly.
  for (let i = 0; i < 3; i++) resolveSolids(nextPos, r);
  return nextPos;
}

// --- Smooth Player Locomotion & Inertia ---
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _inputDir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const _resolved = new THREE.Vector3();
let lastPresenceSend = 0;

function updatePlayer(delta) {
  const canMove = (isPointerLocked || isTouchDevice) && openModals.size === 0 && !isBlockerVisible();

  if (player.isSitting) {
    camera.position.set(player.pos.x, player.pos.y, player.pos.z);
    _euler.set(player.pitch, player.yaw, 0);
    camera.quaternion.setFromEuler(_euler);
    updateStageVolume();
    return;
  }

  // Apply smoothed camera rotation (sub-frame interpolation)
  if (Math.abs(mouseDeltaX) > 0.001 || Math.abs(mouseDeltaY) > 0.001) {
    const lookSpeed = isTouchDevice ? 0.0038 : 0.0022;
    // Consume a portion of the delta per frame for a fast but silky lerp
    const consume = Math.min(1.0, 45.0 * delta);
    const stepX = mouseDeltaX * consume;
    const stepY = mouseDeltaY * consume;
    
    player.yaw -= stepX * lookSpeed;
    player.pitch -= stepY * lookSpeed;
    
    mouseDeltaX -= stepX;
    mouseDeltaY -= stepY;
    
    const maxPitch = Math.PI / 2 - 0.08;
    player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));
  } else {
    mouseDeltaX = 0;
    mouseDeltaY = 0;
  }

  const targetSpeed = player.maxSpeed;

  _forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  _inputDir.set(0, 0, 0);

  if (canMove) {
    if (keys.forward) _inputDir.add(_forward);
    if (keys.backward) _inputDir.sub(_forward);
    if (keys.right) _inputDir.add(_right);
    if (keys.left) _inputDir.sub(_right);

    if (Math.abs(joystickVec.x) > 0.05 || Math.abs(joystickVec.y) > 0.05) {
      _inputDir.addScaledVector(_right, joystickVec.x);
      _inputDir.addScaledVector(_forward, -joystickVec.y);
    }
  }

  const isMoving = _inputDir.lengthSq() > 0.001;

  if (isMoving) {
    if (_inputDir.lengthSq() > 1) _inputDir.normalize();
    player.desiredVel.copy(_inputDir).multiplyScalar(targetSpeed);
  } else {
    player.desiredVel.set(0, 0, 0);
  }

  // Touch devices have gentler stopping inertia so it feels more natural
  const accel = isMoving ? 14.0 : (isTouchDevice ? 7.0 : 18.0);
  player.vel.x += (player.desiredVel.x - player.vel.x) * Math.min(1.0, accel * delta);
  player.vel.z += (player.desiredVel.z - player.vel.z) * Math.min(1.0, accel * delta);

  // Camera sway (roll) while walking
  const strafeVal = canMove ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joystickVec.x : 0;
  const targetRoll = isMoving ? -Math.max(-1, Math.min(1, strafeVal)) * 0.015 - (Math.sin(clock.getElapsedTime() * 8.0) * 0.004) : 0;
  player.roll += (targetRoll - player.roll) * Math.min(1.0, 10.0 * delta);

  // Resolve X then Z so you slide along walls instead of tunneling into corners.
  // `_resolved` is reused rather than cloned each frame — this runs 60 times a second for the
  // whole session and the garbage it produced showed up as periodic collection hitches.
  const resolved = _resolved.copy(player.pos);
  resolved.x += player.vel.x * delta;
  checkCollision(resolved);
  resolved.z = player.pos.z + player.vel.z * delta;
  checkCollision(resolved);
  player.pos.x = resolved.x;
  player.pos.z = resolved.z;

  // 10 Hz is plenty for remote avatars, which interpolate towards the last known pose anyway.
  // Sending every frame meant ~60 websocket messages a second per walking visitor.
  if (presence && (isMoving || player.vel.lengthSq() > 0.01)) {
    const nowMs = performance.now();
    if (nowMs - lastPresenceSend > 100) {
      lastPresenceSend = nowMs;
      presence.sendMove(player.pos.x, player.pos.y, player.pos.z, player.yaw);
    }
  }

  // Composite head bob for more natural footstep feel
  if (isMoving && player.vel.length() > 0.5) {
    player.headBobTimer += delta * 9.0;
  } else {
    // Smoothly return to 0
    player.headBobTimer += (0 - player.headBobTimer) * Math.min(1.0, 8.0 * delta);
  }

  player.pos.y = player.eyeHeight;
  player.vel.y = 0;

  const curSpeed = player.vel.length();
  const bobScale = Math.min(1.0, curSpeed / targetSpeed);
  
  // Two-frequency composite: primary step cycle + slower lateral drift
  const bobY = Math.sin(player.headBobTimer) * 0.025 * bobScale;
  const bobX = Math.cos(player.headBobTimer * 0.5) * 0.015 * bobScale;

  // Teleport landing micro-settle
  let landingY = 0;
  if (teleportSettleTimer > 0) {
    teleportSettleTimer -= delta;
    if (teleportSettleTimer < 0) teleportSettleTimer = 0;
    landingY = -Math.sin(teleportSettleTimer / 0.2 * Math.PI) * 0.04;
  }

  camera.position.set(player.pos.x + bobX, player.pos.y + bobY + landingY, player.pos.z);
  _euler.set(player.pitch, player.yaw, player.roll);
  camera.quaternion.setFromEuler(_euler);

  updateStageVolume();
}

// --- Proximity & Hotspot Detection ---
function actionVerb() { return isTouchDevice ? 'Tap to' : 'Press E to'; }

// Walking speed is 4.6 m/s, so 20 Hz means the prompt can be at most 23 cm late — well inside
// the 2.2 m interaction radius, and imperceptible. At 60 Hz this function was doing six DOM
// lookups, two Object.entries allocations and a linear search through booths.json every frame,
// plus a raycast against every TV in the hall.
const PROXIMITY_HZ = 20;
let proximityNextRun = 0;

// Resolved once: querying the DOM by id on every frame for elements that never change is pure
// overhead, and `boothsData.find()` per booth per frame is a quadratic scan of static data.
let promptEls = null;
const BOOTH_LIST = Object.entries(BOOTH_POSITIONS).map(([idStr, booth]) => {
  const id = parseInt(idStr);
  const info = boothsData.find(b => b.id === id);
  return {
    id,
    booth,
    name: info && info.name && info.name !== booth.title
      ? `${booth.title} • ${info.name}`
      : `${booth.title} • ${booth.category}`,
  };
});
const HOTSPOT_LIST = Object.entries(HOTSPOTS).map(([key, spot]) => ({ key, spot }));

function checkProximity(force = false) {
  const now = performance.now();
  if (!force && now < proximityNextRun) return;
  proximityNextRun = now + 1000 / PROXIMITY_HZ;

  if (!promptEls) {
    promptEls = {
      promptEl: $('proximity-prompt'),
      promptTitle: $('prompt-booth-name'),
      promptSub: $('prompt-booth-cat'),
      promptKey: $('prompt-key'),
      crosshair: $('crosshair'),
      interactBtn: $('mobile-interact-btn'),
    };
  }
  const { promptEl, promptTitle, promptSub, promptKey, crosshair, interactBtn } = promptEls;

  const previousKey = activeTarget ? activeTarget.key : null;
  activeTarget = null;
  let closestDist = 999;

  if (!player.isSitting) {
    for (const c of CHAIR_LOCATIONS) {
      const dist = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      if (dist < 1.35 && dist < closestDist) {
        closestDist = dist;
        activeTarget = {
          type: 'chair', key: `chair-${c.id}`, chair: c,
          title: `${c.label} • VIP Audience Seat`,
          sub: `${actionVerb()} sit down & watch the keynote`,
        };
      }
    }
  }

  for (const { id, booth, name } of BOOTH_LIST) {
    const dist = Math.hypot(player.pos.x - booth.ax, player.pos.z - booth.az);
    if (dist < BOOTH_INTERACT_RADIUS && dist < closestDist) {
      closestDist = dist;
      const visited = visitedBooths.has(id);
      activeTarget = {
        type: 'booth', key: `booth-${id}`, id,
        title: name,
        sub: visited ? `${actionVerb()} revisit${quizPassed.has(id) ? ' exhibit' : ' & take the quiz'}` : `${actionVerb()} inspect & collect stamp`,
      };
    }
  }

  for (const { key, spot } of HOTSPOT_LIST) {
    const dist = Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z);
    if (dist < spot.radius && dist < closestDist) {
      closestDist = dist;
      activeTarget = { type: 'hotspot', key: `spot-${key}`, hotspot: key, title: spot.title, sub: `${actionVerb()} ${spot.action.toLowerCase()}`, modal: spot.modal, orgId: spot.orgId };
    }
  }

  // Mascots (Tutu may be roaming — nearest uses live cfg.x/z)
  if (mascots && !player.isSitting) {
    const near = mascots.nearest(player.pos);
    if (near && near.dist < closestDist) {
      closestDist = near.dist;
      const m = near.mascot;
      const isTutu = m.cfg.id === 'tutu';
      activeTarget = {
        type: 'mascot', key: `mascot-${m.cfg.id}`, mascot: m,
        title: isTutu
          ? `${m.cfg.name} • Ask Tutu`
          : `${m.cfg.name} • ${m.cfg.org} mascot`,
        sub: isTutu
          ? `${actionVerb()} Event FAQ & safeguarding`
          : `${actionVerb()} say hello`,
      };
    }
  }

  // TVs: a click / tap on the screen opens the video pop-up with sound. E keeps opening the
  // booth itself (silently), so aiming at the TV only adds a hint — unless nothing else is in
  // reach, in which case the TV becomes the target.
  aimedTV = (!player.isSitting && openModals.size === 0) ? pickTV(0, 0) : null;
  if (aimedTV) {
    const tvVerb = isTouchDevice ? 'tap' : 'click';
    if (!activeTarget) {
      activeTarget = {
        type: 'tv', key: `tv-${aimedTV.key}`, tv: aimedTV,
        title: `${aimedTV.label} • Booth TV`,
        sub: isTouchDevice ? 'Tap the TV to watch with sound' : 'Click or press E to watch with sound',
      };
    } else if (
      (activeTarget.type === 'booth' && activeTarget.id === aimedTV.boothId) ||
      (activeTarget.type === 'hotspot' && activeTarget.orgId && activeTarget.orgId === aimedTV.orgId)
    ) {
      activeTarget.key += '+tv';
      activeTarget.sub = `${activeTarget.sub} · ${tvVerb} TV for sound`;
      activeTarget.tvHint = true;
    }
  }

  const showPrompt = activeTarget && !player.isSitting && openModals.size === 0;
  if (showPrompt) {
    if (activeTarget.key !== previousKey || promptEl.classList.contains('hidden')) {
      promptTitle.textContent = activeTarget.title;
      promptSub.textContent = activeTarget.sub;
      promptKey.textContent = isTouchDevice ? 'TAP' : activeTarget.type === 'tv' ? '📺' : 'E';
      promptEl.classList.remove('hidden');
      promptEl.classList.toggle('is-tv', activeTarget.type === 'tv');
      crosshair.classList.add('active');
      crosshair.classList.toggle('tv', activeTarget.type === 'tv' || !!activeTarget.tvHint);
      if (interactBtn) interactBtn.classList.add('ready');
    }
  } else if (!promptEl.classList.contains('hidden')) {
    promptEl.classList.add('hidden');
    promptEl.classList.remove('is-tv');
    crosshair.classList.remove('active', 'tv');
    if (interactBtn) interactBtn.classList.remove('ready');
  }

  updateWaypointHUD();
}

function handleInteract() {
  if (openModals.size > 0 || isBlockerVisible()) return;

  if (player.isSitting) {
    standUp();
    return;
  }

  if (!activeTarget) {
    if (isTouchDevice) showToast('Walk up to a booth, seat or desk to interact.', { icon: '🚶' });
    return;
  }

  if (activeTarget.type === 'chair') {
    sitDownOnChair(activeTarget.chair);
    return;
  }

  if (activeTarget.type === 'tv') {
    openTV(activeTarget.tv);
  } else if (activeTarget.type === 'mascot') {
    openMascotModal(activeTarget.mascot);
  } else if (activeTarget.type === 'booth') {
    openBoothModal(activeTarget.id);
  } else if (activeTarget.type === 'hotspot') {
    if (activeTarget.modal === 'podium') {
      teleportPlayer(8.0, 1.8, -22.8, Math.PI);
      showToast('Now viewing the hall from the speaker lectern.', { icon: '🎤' });
    } else if (activeTarget.modal === 'pledge-modal') {
      renderPledges();
      openModal('pledge-modal');
    } else if (activeTarget.modal === 'stage-modal') {
      openStageTheater();
    } else if (activeTarget.modal === 'org-modal') {
      openOrganizerModal(activeTarget.orgId);
    } else {
      openModal(activeTarget.modal);
    }
  }
}

// --- Waypoint Navigation ---
function setWaypoint(boothId, { silent = false } = {}) {
  const prev = activeWaypointId;
  activeWaypointId = boothId;
  const b = BOOTH_POSITIONS[boothId];
  $('waypoint-name').textContent = `Tracking: ${b.title}`;
  $('waypoint-hud').classList.remove('hidden');
  if (prev && prev !== boothId) refreshBoothVisual(prev);
  refreshBoothVisual(boothId);
  updateWaypointHUD();
  if (!silent) showToast(`Tracking ${b.title}. Follow the gold marker.`, { icon: '🎯', type: 'gold' });
}

function clearWaypoint() {
  const prev = activeWaypointId;
  activeWaypointId = null;
  $('waypoint-hud').classList.add('hidden');
  if (prev) refreshBoothVisual(prev);
}

function nearestUnvisitedBooth() {
  let best = null;
  let bestDist = Infinity;
  for (const [idStr, b] of Object.entries(BOOTH_POSITIONS)) {
    const id = parseInt(idStr);
    if (visitedBooths.has(id)) continue;
    const dist = Math.hypot(player.pos.x - b.ax, player.pos.z - b.az);
    if (dist < bestDist) { bestDist = dist; best = id; }
  }
  return best;
}

function trackNearestUnvisited() {
  const id = nearestUnvisitedBooth();
  if (!id) {
    showToast('You have visited every booth. Passport complete!', { icon: '🏆', type: 'gold' });
    return false;
  }
  setWaypoint(id);
  return true;
}

function updateWaypointHUD() {
  if (!activeWaypointId) return;
  const b = BOOTH_POSITIONS[activeWaypointId];
  const dx = b.ax - player.pos.x;
  const dz = b.az - player.pos.z;
  const dist = Math.hypot(dx, dz);

  $('waypoint-dist').textContent = `${dist.toFixed(1)}m`;

  // Bearing relative to where the player is looking. Forward = (-sin yaw, -cos yaw).
  const targetYaw = Math.atan2(-dx, -dz);
  let rel = targetYaw - player.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  // Arrow glyph points right by default; -90° makes it point up (straight ahead).
  $('waypoint-arrow').style.transform = `rotate(${-90 - rel * (180 / Math.PI)}deg)`;

  if (dist < 1.9) {
    const id = activeWaypointId;
    clearWaypoint();
    showToast(`You've arrived at ${BOOTH_POSITIONS[id].title}. ${isTouchDevice ? 'Tap' : 'Press E'} to enter.`, { icon: '📍', type: 'success' });
  }
}

// --- Modal Management ---
function openModal(id) {
  const el = $(id);
  if (!el) return;
  releaseLock();
  resetMovementKeys();
  openModals.add(id);
  document.body.classList.add('modal-open');
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  $('proximity-prompt').classList.add('hidden');
  const closeBtn = el.querySelector('.modal-close-btn');
  if (closeBtn && !isTouchDevice) closeBtn.focus({ preventScroll: true });
}

function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  openModals.delete(id);

  if (id === 'stage-modal') {
    const mount = $('theater-player-mount');
    if (mount) mount.innerHTML = '';
  }
  if (id === 'booth-modal') {
    const mount = $('modal-video-mount');
    if (mount) mount.innerHTML = '';
    stopPopupVideo($('modal-tv-video'));
    currentBoothId = null;
  }
  if (id === 'org-modal') {
    stopPopupVideo($('org-tv-video'));
  }

  if (openModals.size === 0) {
    document.body.classList.remove('modal-open');
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    requestLock();
  }
}

function closeAllModals() {
  Array.from(openModals).forEach(closeModal);
}

function isModalOpen(id) { return openModals.has(id); }

function togglePassportModal() {
  if (isModalOpen('passport-modal')) { closeModal('passport-modal'); return; }
  renderPassport();
  openModal('passport-modal');
}

function toggleTeleportModal() {
  if (isModalOpen('teleport-modal')) { closeModal('teleport-modal'); return; }
  openModal('teleport-modal');
}

function openStageTheater() {
  if (isModalOpen('stage-modal')) return;
  openModal('stage-modal');
  const mount = $('theater-player-mount');
  mount.innerHTML = `<iframe src="https://www.youtube.com/embed/${currentVideoId}?autoplay=1&enablejsapi=1&rel=0&playsinline=1" title="Stage keynote" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
}

// --- Booth Modal ---
/** Server-authoritative hearts/comments keyed by booth id. */
const boothEngagement = new Map();
let pageViewSent = false;

function applyBoothEngagement(payload) {
  if (!payload || !Number.isFinite(Number(payload.boothId))) return;
  const boothId = Number(payload.boothId);
  const hearts = Math.max(0, Number(payload.hearts) || 0);
  const liked = !!payload.liked;
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  boothEngagement.set(boothId, { hearts, liked, comments });
  if (liked) heartedBooths.add(boothId);
  else heartedBooths.delete(boothId);
  try { saveSet('gmc_hearted_booths', heartedBooths); } catch (e) {}
  setHeartCount(boothId, hearts);
  if (currentBoothId === boothId && isModalOpen('booth-modal')) {
    refreshBoothEngagementUI(boothId);
  }
}

function applyEngagementMap(map) {
  if (!map || typeof map !== 'object') return;
  for (const [key, value] of Object.entries(map)) {
    applyBoothEngagement({ boothId: Number(key), ...value });
  }
}

function getHeartCount(boothId) {
  if (boothEngagement.has(boothId)) return boothEngagement.get(boothId).hearts;
  const key = `gmc_hearts_${boothId}`;
  const stored = localStorage.getItem(key);
  if (stored !== null && !Number.isNaN(parseInt(stored))) return parseInt(stored);
  return 0;
}

function setHeartCount(boothId, count) {
  try { localStorage.setItem(`gmc_hearts_${boothId}`, String(count)); } catch (e) {}
}

function refreshBoothEngagementUI(boothId) {
  const eng = boothEngagement.get(boothId) || { hearts: getHeartCount(boothId), liked: heartedBooths.has(boothId), comments: [] };
  const heartBtn = $('modal-heart-btn');
  if (heartBtn) {
    heartBtn.classList.toggle('hearted', !!eng.liked);
    heartBtn.setAttribute('aria-pressed', String(!!eng.liked));
  }
  const countEl = $('modal-heart-count');
  if (countEl) countEl.textContent = eng.hearts;

  const list = $('booth-comments-list');
  if (!list) return;
  list.innerHTML = '';
  if (!eng.comments.length) {
    list.innerHTML = '<p class="booth-comment-empty">No visitor notes yet — be the first.</p>';
  } else {
    eng.comments.slice(0, 12).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'booth-comment-card';
      const meta = document.createElement('div');
      meta.className = 'booth-comment-meta';
      meta.textContent = c.name || 'Delegate';
      const text = document.createElement('p');
      text.className = 'booth-comment-text';
      text.textContent = c.text || '';
      row.appendChild(meta);
      row.appendChild(text);
      list.appendChild(row);
    });
  }
}

function emitAnalytics(type, payload = {}) {
  track(type, payload);
  if (presence) presence.sendAnalytics(type, payload);
}

function maybeEmitPageView() {
  if (pageViewSent) return;
  try {
    if (sessionStorage.getItem('yim_page_view_sent')) {
      pageViewSent = true;
      return;
    }
    sessionStorage.setItem('yim_page_view_sent', '1');
  } catch (e) {}
  pageViewSent = true;
  emitAnalytics('page_view', {});
}

function maybeEmitPassportComplete() {
  if (visitedBooths.size < TOTAL_BOOTHS) return;
  try {
    if (localStorage.getItem('yim_passport_complete_sent')) return;
    localStorage.setItem('yim_passport_complete_sent', '1');
  } catch (e) {}
  emitAnalytics('passport_complete', {});
}

// --- Pop-up video (the only place TV audio plays) ---
function stopPopupVideo(video) {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch (e) {}
}

/**
 * Loads `src` into a pop-up <video>. With `play` the video starts unmuted right away (the user
 * just clicked the TV — that's the gesture browsers require); otherwise it waits, paused, with
 * controls so nothing makes a sound until the visitor presses play.
 */
function loadPopupVideo(video, src, { play = false, poster = '' } = {}) {
  if (!video) return;
  if (video.getAttribute('src') !== src) {
    video.src = src;
    video.load();
  }
  if (poster) video.poster = poster; else video.removeAttribute('poster');
  video.loop = true;
  video.muted = false;
  video.volume = 1;
  video.currentTime = 0;
  if (play) {
    video.play().catch(() => {
      // Autoplay with audio refused (rare after a real click): fall back to muted playback with controls.
      video.muted = true;
      video.play().catch(() => {});
      showToast('Tap the video to unmute.', { icon: '🔇' });
    });
  } else {
    video.pause();
  }
}

function isPopupVideoPlaying() {
  const a = $('modal-tv-video');
  const b = $('org-tv-video');
  return (a && !a.paused && !a.muted) || (b && !b.paused && !b.muted);
}

function renderStats(stats, grid = $('modal-stats-grid')) {
  grid.innerHTML = '';
  if (!Array.isArray(stats)) return;
  stats.slice(0, 6).forEach((s) => {
    if (!s || (s.value === undefined && !s.label)) return;
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="stat-card-value">${escapeHtml(s.value ?? '')}</div><div class="stat-card-label">${escapeHtml(s.label ?? '')}</div>`;
    grid.appendChild(card);
  });
}

function safeUrl(url) {
  try {
    const u = new URL(String(url), window.location.origin);
    return (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' || u.protocol === 'tel:') ? u.href : null;
  } catch { return null; }
}

function renderLinksAndSocials(info) {
  const linksBox = $('modal-links-box');
  const socialsBox = $('modal-socials-box');
  linksBox.innerHTML = '';
  socialsBox.innerHTML = '';

  (Array.isArray(info.links) ? info.links : []).forEach((l) => {
    const href = safeUrl(l && (l.url || l.href));
    if (!href) return;
    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `🔗 ${l.label || href.replace(/^https?:\/\//, '')}`;
    linksBox.appendChild(a);
  });

  const SOCIAL_ICONS = { facebook: '📘', instagram: '📸', twitter: '🐦', x: '✖️', linkedin: '💼', youtube: '▶️', tiktok: '🎵', website: '🌐', email: '✉️' };
  Object.entries(info.socials || {}).forEach(([network, url]) => {
    const href = safeUrl(url);
    if (!href) return;
    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${SOCIAL_ICONS[network.toLowerCase()] || '🔗'} ${network.charAt(0).toUpperCase() + network.slice(1)}`;
    socialsBox.appendChild(a);
  });

  const contact = info.contact || {};
  if (contact.email) {
    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = `mailto:${contact.email}`;
    a.textContent = `✉️ ${contact.email}`;
    socialsBox.appendChild(a);
  }
  if (contact.phone) {
    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = `tel:${String(contact.phone).replace(/[^\d+]/g, '')}`;
    a.textContent = `📞 ${contact.phone}`;
    socialsBox.appendChild(a);
  }
}

function activateTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = b.getAttribute('data-tab') === tabId;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== tabId));

  // Lazy-load media only when the media tab is shown.
  if (tabId === 'tab-media' && currentBoothId) {
    const info = boothsData.find(b => b.id === currentBoothId) || {};

    // The booth TV loop, now with sound available (paused unless opened from the TV itself).
    const tvVideo = $('modal-tv-video');
    if (tvVideo && !tvVideo.getAttribute('src')) {
      loadPopupVideo(tvVideo, boothScreenVideoSrc(currentBoothId), { poster: `/textures/booth_${pad2(currentBoothId)}_screen.png` });
    }

    const wrapper = $('modal-video-wrapper');
    const mount = $('modal-video-mount');
    if (info.introVideo && mount && !mount.firstChild) {
      const vid = extractYouTubeId(info.introVideo);
      mount.innerHTML = `<iframe src="https://www.youtube.com/embed/${vid}?rel=0&playsinline=1" title="Booth intro video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      wrapper.classList.remove('hidden');
    }
  }
}

function openBoothModal(boothId, { tab = 'tab-overview', playWithSound = false } = {}) {
  const firstVisit = !visitedBooths.has(boothId);
  visitedBooths.add(boothId);
  saveSet('gmc_visited_booths', visitedBooths);
  updateVisitedHUD();

  if (activeWaypointId === boothId) clearWaypoint();
  refreshBoothVisual(boothId);

  currentBoothId = boothId;
  const boothInfo = boothsData.find(b => b.id === boothId) || {};
  const boothMeta = BOOTH_POSITIONS[boothId] || {};

  $('modal-booth-id').textContent = pad2(boothId);
  $('modal-booth-title').textContent = boothInfo.name || boothMeta.title;
  $('modal-booth-category').textContent = boothInfo.category && boothInfo.category !== 'Innovation' ? boothInfo.category : boothMeta.category;
  $('modal-overview-text').textContent = boothInfo.overview && !boothInfo.placeholder
    ? boothInfo.overview
    : "This youth-led satellite innovation team delivers scalable solutions tackling systemic environmental and social challenges. Full project details will appear here once the exhibitor publishes them.";
  $('modal-placeholder-note').classList.toggle('hidden', !boothInfo.placeholder);
  $('modal-quiz-pill').classList.toggle('hidden', !quizPassed.has(boothId));
  $('quiz-tab-dot').classList.toggle('on', !quizPassed.has(boothId) && !!(boothInfo.quiz && boothInfo.quiz.questions && boothInfo.quiz.questions.length));

  const screenImg = $('modal-screen-img');
  screenImg.src = `/textures/booth_${pad2(boothId)}_screen.png`;
  screenImg.alt = `${boothInfo.name || boothMeta.title} display terminal`;
  $('modal-media-id').textContent = pad2(boothId);

  const videoWrapper = $('modal-video-wrapper');
  $('modal-video-mount').innerHTML = '';
  videoWrapper.classList.add('hidden');
  stopPopupVideo($('modal-tv-video'));

  renderStats(boothInfo.stats);
  renderLinksAndSocials(boothInfo);
  renderQuiz(boothInfo.quiz, boothId);
  refreshBoothEngagementUI(boothId);
  activateTab(tab);

  if (playWithSound) {
    const tvVideo = $('modal-tv-video');
    loadPopupVideo(tvVideo, boothScreenVideoSrc(boothId), { play: true, poster: `/textures/booth_${pad2(boothId)}_screen.png` });
    emitAnalytics('intro_play', { boothId });
  }

  $('modal-next-booth-btn').classList.toggle('hidden', nearestUnvisitedBooth() === null);

  openModal('booth-modal');
  emitAnalytics('booth_open', { boothId });

  if (firstVisit) {
    const count = visitedBooths.size;
    if (count === TOTAL_BOOTHS) {
      showToast('🏆 Passport complete — all 20 booths visited!', { icon: '🌟', type: 'gold', duration: 4500 });
      maybeEmitPassportComplete();
    } else {
      showToast(`Stamp collected! ${count}/${TOTAL_BOOTHS} booths visited.`, { icon: '⭐', type: 'success' });
    }
  }
}

function toggleHeart() {
  if (!currentBoothId) return;
  const id = currentBoothId;
  // Optimistic UI; server ownership arrives via booth_engagement.
  const liked = heartedBooths.has(id);
  if (liked) heartedBooths.delete(id); else heartedBooths.add(id);
  saveSet('gmc_hearted_booths', heartedBooths);
  const next = Math.max(0, getHeartCount(id) + (liked ? -1 : 1));
  setHeartCount(id, next);
  const prev = boothEngagement.get(id) || { comments: [] };
  boothEngagement.set(id, { hearts: next, liked: !liked, comments: prev.comments || [] });
  refreshBoothEngagementUI(id);
  const btn = $('modal-heart-btn');
  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
  if (presence) presence.sendHeart(id);
  track('booth_heart', { boothId: id });
  if (!liked) showToast('Thanks for the love! The team will see your heart.', { icon: '❤️', type: 'danger' });
}

function submitBoothComment(e) {
  if (e) e.preventDefault();
  if (!currentBoothId || !presence) return;
  const input = $('booth-comment-input');
  const hint = $('booth-comment-hint');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const sent = presence.sendComment(currentBoothId, text);
  if (!sent) {
    if (hint) hint.textContent = 'Connect to the live hall to post a note.';
    return;
  }
  if (input) input.value = '';
  if (hint) hint.textContent = '';
  track('booth_comment', { boothId: currentBoothId });
}

// --- Organizer booth & mascot info modal ---
function renderTutuFaq(tabId) {
  const tabsEl = $('tutu-faq-tabs');
  const listEl = $('tutu-faq-list');
  if (!tabsEl || !listEl || !tutuFaqs || !Array.isArray(tutuFaqs.tabs)) return;
  const tabs = tutuFaqs.tabs;
  const activeId = tabId || (tabs[0] && tabs[0].id) || 'overview';
  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  tabsEl.innerHTML = '';
  tabs.forEach((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tutu-faq-tab${tab.id === active.id ? ' active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab.id === active.id ? 'true' : 'false');
    btn.textContent = tab.label;
    btn.addEventListener('click', () => renderTutuFaq(tab.id));
    tabsEl.appendChild(btn);
  });

  listEl.innerHTML = '';
  (active.items || []).forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'tutu-faq-item';
    const qBtn = document.createElement('button');
    qBtn.type = 'button';
    qBtn.className = 'tutu-faq-q';
    const qLabel = document.createElement('span');
    qLabel.textContent = item.q;
    const chevron = document.createElement('span');
    chevron.className = 'tutu-faq-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▸';
    qBtn.appendChild(qLabel);
    qBtn.appendChild(chevron);
    const a = document.createElement('div');
    a.className = 'tutu-faq-a';
    a.textContent = item.a;
    qBtn.addEventListener('click', () => {
      const open = row.classList.contains('open');
      listEl.querySelectorAll('.tutu-faq-item.open').forEach((el) => el.classList.remove('open'));
      if (!open) row.classList.add('open');
    });
    row.appendChild(qBtn);
    row.appendChild(a);
    if (idx === 0) row.classList.add('open');
    listEl.appendChild(row);
  });
}

function setTutuFaqVisible(show) {
  const faq = $('tutu-faq');
  const textEl = $('org-modal-text');
  const overviewBox = textEl && textEl.closest('.overview-box');
  if (faq) faq.classList.toggle('hidden', !show);
  if (overviewBox) overviewBox.classList.toggle('hidden', !!show);
  if (show) renderTutuFaq();
}

function openInfoModal({ badge, badgeColor, kicker, title, subtitle, heading, overview, stats, links, video, tutuFaq }) {
  $('org-modal-badge').textContent = badge || 'ℹ️';
  $('org-modal-badge').style.background = badgeColor || '';
  $('org-modal-kicker').textContent = kicker || '';
  $('org-modal-title').textContent = title || '';
  const sub = $('org-modal-sub');
  sub.textContent = subtitle || '';
  sub.classList.toggle('hidden', !subtitle);
  $('org-modal-heading').textContent = heading || 'About';
  $('org-modal-text').textContent = overview || '';
  setTutuFaqVisible(!!tutuFaq);
  renderStats(stats, $('org-modal-stats'));

  const linksBox = $('org-modal-links');
  linksBox.innerHTML = '';
  (Array.isArray(links) ? links : []).forEach((l) => {
    const href = safeUrl(l && (l.url || l.href));
    if (!href) return;
    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `🔗 ${l.label || href.replace(/^https?:\/\//, '')}`;
    linksBox.appendChild(a);
  });

  const wrapper = $('org-video-wrapper');
  const tvVideo = $('org-tv-video');
  stopPopupVideo(tvVideo);
  if (video && video.src) {
    wrapper.classList.remove('hidden');
    loadPopupVideo(tvVideo, video.src, { play: !!video.play });
  } else {
    wrapper.classList.add('hidden');
  }

  openModal('org-modal');
}

function openOrganizerModal(orgId, { playWithSound = false } = {}) {
  const org = organizersData.find(o => o.id === orgId);
  if (!org) return;
  const mascot = org.mascot ? mascotsData.find(m => m.id === org.mascot) : null;
  const stats = Array.isArray(org.stats) ? org.stats.slice() : [];
  openInfoModal({
    badge: org.short,
    badgeColor: org.color,
    kicker: org.kicker || 'ORGANIZER BOOTH',
    title: org.name,
    subtitle: mascot ? `${org.tagline} • Mascot: ${mascot.name}` : org.tagline,
    heading: 'About the organizer',
    overview: org.overview,
    stats,
    links: org.links,
    video: { src: org.screenVideo || DEFAULT_SCREEN_VIDEO, play: playWithSound },
  });
  if (playWithSound) showToast(`${org.short} booth TV — now playing with sound.`, { icon: '📺' });
}

function openMascotModal(m) {
  if (!m || !m.cfg) return;
  const cfg = m.cfg;
  const org = organizersData.find(o => o.mascot === cfg.id);
  const md = cfg.modal || {};
  const isTutu = cfg.id === 'tutu';
  openInfoModal({
    badge: cfg.kind === 'lighthouse' ? '🗼' : '🐘',
    badgeColor: (org && org.color) || '#F4B400',
    kicker: md.kicker || 'MASCOT',
    title: md.title || cfg.name,
    subtitle: md.subtitle || cfg.org,
    heading: isTutu ? 'Ask Tutu' : `Meet ${cfg.name}`,
    overview: md.overview || '',
    stats: isTutu ? null : md.stats,
    links: isTutu ? [] : ((org && org.links) || []),
    tutuFaq: isTutu,
  });
}

// --- Quiz System ---
function renderQuiz(quiz, boothId) {
  const container = $('quiz-questions-list');
  const resultEl = $('quiz-result');
  const desc = $('quiz-desc');
  container.innerHTML = '';
  resultEl.classList.add('hidden');
  resultEl.classList.remove('pass', 'fail');
  resultEl.innerHTML = '';

  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    $('quiz-title').textContent = 'Booth Challenge';
    desc.textContent = 'No quiz is active for this exhibit yet. Feel free to explore the project media!';
    return;
  }

  const total = quiz.questions.length;
  const passScore = Math.min(total, Math.max(1, quiz.passScore || total));
  $('quiz-title').textContent = quiz.title || 'Booth Challenge';
  desc.textContent = quizPassed.has(boothId)
    ? `You already earned this gold stamp. Retake for fun — ${passScore} of ${total} correct passes.`
    : `Answer ${total} question${total > 1 ? 's' : ''}. Get ${passScore} or more right to earn the gold passport stamp!`;

  let answeredCount = 0;
  let correctCount = 0;

  quiz.questions.forEach((q, qIdx) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    const prompt = document.createElement('div');
    prompt.className = 'question-prompt';
    prompt.textContent = `${qIdx + 1}. ${q.prompt}`;
    card.appendChild(prompt);

    const choicesList = document.createElement('div');
    choicesList.className = 'choices-list';

    q.choices.forEach((choice, cIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = choice;

      btn.addEventListener('click', () => {
        Array.from(choicesList.children).forEach(c => c.disabled = true);
        if (cIdx === q.correctIndex) {
          btn.classList.add('correct');
          correctCount++;
        } else {
          btn.classList.add('wrong');
          if (choicesList.children[q.correctIndex]) choicesList.children[q.correctIndex].classList.add('correct');
        }

        answeredCount++;
        if (answeredCount === total) finishQuiz();
      });

      choicesList.appendChild(btn);
    });

    card.appendChild(choicesList);
    container.appendChild(card);
  });

  function finishQuiz() {
    const passed = correctCount >= passScore;
    resultEl.classList.remove('hidden');
    resultEl.classList.add(passed ? 'pass' : 'fail');

    const msg = document.createElement('div');
    msg.textContent = passed
      ? `🎉 ${correctCount} of ${total} correct — gold stamp earned!`
      : `${correctCount} of ${total} correct. You need ${passScore} to pass — give it another go!`;
    resultEl.appendChild(msg);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'secondary-btn btn-xs';
    retry.textContent = passed ? 'Retake quiz' : 'Try again';
    retry.addEventListener('click', () => renderQuiz(quiz, boothId));
    resultEl.appendChild(retry);

    if (passed && !quizPassed.has(boothId)) {
      quizPassed.add(boothId);
      saveSet('gmc_quiz_passed', quizPassed);
      $('modal-quiz-pill').classList.remove('hidden');
      $('quiz-tab-dot').classList.remove('on');
      showToast(`Gold stamp earned for ${BOOTH_POSITIONS[boothId].title}!`, { icon: '🏅', type: 'gold' });
      emitAnalytics('quiz_complete', { boothId, passed: true });
    } else {
      emitAnalytics('quiz_complete', { boothId, passed: !!passed });
    }
  }
}

// --- Commitment Wall Pledges ---
// Seed pledges so the wall never looks empty. ids are stable so merging with the server list dedupes.
const DEFAULT_PLEDGES = [
  { id: 'seed-1', text: "Clean Energy for every public high school!", color: "#fef08a", by: 'GMC Youth Council' },
  { id: 'seed-2', text: "Zero-waste community youth hubs in Manila.", color: "#bbf7d0", by: 'Delegate, PH' },
  { id: 'seed-3', text: "Free coding & AI literacy for all students!", color: "#bfdbfe", by: 'Booth 03 team' },
  { id: 'seed-4', text: "Youth mental health hotlines in all barangays.", color: "#fbcfe8", by: 'Delegate, PH' },
  { id: 'seed-5', text: "Sustainable urban farming initiatives!", color: "#fed7aa", by: 'Delegate, VN' },
  { id: 'seed-6', text: "I commit to mentoring five young coders in my community this year.", color: "#ddd6fe", by: 'Lightkeeper, ID' },
  { id: 'seed-7', text: "Safe spaces for every child — online and offline. Violence ends with us.", color: "#bfdbfe", by: 'VEWU' },
  { id: 'seed-8', text: "Girls in STEM scholarships in every province by 2030.", color: "#fef08a", by: 'Delegate, NP' }
];
const MAX_PLEDGES = 200;

function normalizePledge(p) {
  if (!p || typeof p.text !== 'string') return null;
  const text = p.text.trim().slice(0, 160);
  if (!text) return null;
  return {
    id: p.id ? String(p.id).slice(0, 64) : `legacy-${hashString(text)}`,
    text,
    color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#fef08a',
    by: p.by ? String(p.by).slice(0, 24) : undefined,
    ts: Number.isFinite(Number(p.ts)) ? Number(p.ts) : undefined,
  };
}

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Newest first; dedupes by id; caps at MAX_PLEDGES. */
function mergePledges(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const p = normalizePledge(raw);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  // Stable sort: stamped pledges newest first, unstamped keep their incoming order after them.
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, MAX_PLEDGES);
}

function getPledges() {
  try {
    const saved = localStorage.getItem('gmc_wall_pledges');
    const parsed = saved ? JSON.parse(saved) : null;
    return Array.isArray(parsed) && parsed.length ? mergePledges(parsed) : mergePledges(DEFAULT_PLEDGES);
  } catch (e) {
    return mergePledges(DEFAULT_PLEDGES);
  }
}

function savePledges(list) {
  try { localStorage.setItem('gmc_wall_pledges', JSON.stringify(mergePledges(list))); } catch (e) {}
}

/** Adds pledges (from this visitor, another visitor, or the server snapshot) and redraws everything. */
function addPledges(incoming, { highlight = false } = {}) {
  const before = getPledges();
  const merged = mergePledges(incoming, before);
  const added = merged.length - before.length;
  savePledges(merged);
  renderPledges(highlight);
  updatePolicyWallTexture();
  return added;
}

function renderPledges(highlightFirst = false) {
  const container = $('pledges-grid');
  container.innerHTML = '';
  const list = getPledges();
  $('pledge-count').textContent = list.length;
  const wallNote = $('pledge-wall-note');
  if (wallNote) {
    wallNote.textContent = list.length > WALL_NOTE_CAPACITY
      ? `The ${WALL_NOTE_CAPACITY} newest pledges are pinned on the 3D wall; all ${list.length} are listed here.`
      : `All ${list.length} pledges are pinned on the 3D wall in the foyer.`;
  }
  list.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'pledge-sticky' + (highlightFirst && idx === 0 ? ' is-new' : '');
    card.style.background = p.color || '#fef08a';
    const text = document.createElement('div');
    text.className = 'pledge-sticky-text';
    text.textContent = p.text;
    const meta = document.createElement('div');
    meta.className = 'pledge-sticky-meta';
    meta.textContent = formatPledgeStamp(p);
    card.append(text, meta);
    container.appendChild(card);
  });
}

// --- Passport System ---
function renderPassport() {
  const grid = $('passport-grid');
  grid.innerHTML = '';
  const count = visitedBooths.size;
  $('passport-progress-pill').textContent = `${count} of ${TOTAL_BOOTHS} Visited`;
  $('passport-quiz-pill').textContent = `${quizPassed.size} Quiz${quizPassed.size === 1 ? '' : 'zes'} passed`;
  $('passport-bar-fill').style.width = `${(count / TOTAL_BOOTHS) * 100}%`;
  $('passport-next-btn').classList.toggle('hidden', count === TOTAL_BOOTHS);

  for (let i = 1; i <= TOTAL_BOOTHS; i++) {
    const b = BOOTH_POSITIONS[i];
    const info = boothsData.find(x => x.id === i) || {};
    const isVisited = visitedBooths.has(i);
    const isPassed = quizPassed.has(i);
    const isTracking = activeWaypointId === i;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `passport-item ${isVisited ? 'visited' : ''} ${isPassed ? 'quiz-passed' : ''} ${isTracking ? 'tracking' : ''}`;
    item.title = isTracking ? 'Stop tracking this booth' : `Track ${b.title} on the radar`;
    item.innerHTML = `
      <div class="stamp-icon">${isPassed ? '🏅' : isVisited ? '⭐' : '⭕'}</div>
      <div class="passport-item-num">${escapeHtml(b.title)}</div>
      <div class="passport-item-cat">${escapeHtml(info.name && info.name !== b.title ? info.name : b.category)}</div>
      <div class="passport-item-action">${isTracking ? '◎ Tracking' : isVisited ? 'Visited' : 'Tap to track'}</div>
    `;
    item.addEventListener('click', () => {
      if (activeWaypointId === i) {
        clearWaypoint();
        renderPassport();
        return;
      }
      setWaypoint(i);
      closeModal('passport-modal');
    });
    grid.appendChild(item);
  }
}

// --- Sound / Fullscreen toggles ---
function toggleSound() {
  soundEnabled = !soundEnabled;
  lastStageVolume = -1;
  if (ytStagePlayer && typeof ytStagePlayer.mute === 'function') {
    try {
      if (!soundEnabled) ytStagePlayer.mute();
      else { ytStagePlayer.unMute(); updateStageVolume(); }
    } catch (e) {}
  }
  const btn = $('audio-toggle');
  if (btn) {
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    btn.classList.toggle('is-off', !soundEnabled);
    btn.setAttribute('aria-pressed', String(soundEnabled));
  }
  showToast(soundEnabled ? 'Stage audio on' : 'Stage audio muted', { icon: soundEnabled ? '🔊' : '🔇' });
}

function toggleFullscreen() {
  const doc = document;
  const el = doc.documentElement;
  try {
    if (!doc.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (doc.exitFullscreen) {
      doc.exitFullscreen().catch(() => {});
    }
  } catch (e) {}
}

function teleportPlayer(x, y, z, yaw) {
  standUp();
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.yaw = yaw;
  player.pitch = 0;
  closeAllModals();
  teleportSettleTimer = 0.2; // Start a 200ms landing settle ease
}

// --- HUD Setup & Click Handlers ---
function setupHUD() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });

  // Tap on the dimmed backdrop closes the modal.
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
  });

  $('passport-btn').addEventListener('click', togglePassportModal);
  $('teleport-btn').addEventListener('click', toggleTeleportModal);
  $('stage-stream-btn').addEventListener('click', openStageTheater);
  $('audio-toggle').addEventListener('click', toggleSound);
  $('help-btn').addEventListener('click', () => {
    closeAllModals();
    showBlocker('help');
  });

  const fsBtn = $('fullscreen-btn');
  if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
    fsBtn.classList.add('hidden');
  } else {
    fsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = document.fullscreenElement ? '🗗' : '⛶';
      setTimeout(onWindowResize, 100);
    });
  }

  $('waypoint-clear').addEventListener('click', clearWaypoint);
  $('modal-heart-btn').addEventListener('click', toggleHeart);
  const commentForm = $('booth-comment-form');
  if (commentForm) commentForm.addEventListener('submit', submitBoothComment);
  $('modal-next-booth-btn').addEventListener('click', () => {
    if (trackNearestUnvisited()) closeModal('booth-modal');
  });
  $('passport-next-btn').addEventListener('click', () => {
    if (trackNearestUnvisited()) closeModal('passport-modal');
  });

  document.querySelectorAll('.jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const coords = btn.getAttribute('data-pos').split(',').map(Number);
      const yaw = Number(btn.getAttribute('data-yaw'));
      teleportPlayer(coords[0], 1.45, coords[2], yaw);
      const title = btn.querySelector('.jump-title');
      showToast(`Jumped to ${title ? title.textContent : 'location'}.`, { icon: '🚀' });
    });
  });

  // Custom YouTube URL loader
  const ytForm = $('stage-url-form');
  const customYtInput = $('custom-yt-input');
  ytForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = customYtInput.value.trim();
    if (!url) return;
    const nextId = extractYouTubeId(url);
    if (nextId === 'vYIYIVmOo3Q' && !/vYIYIVmOo3Q/.test(url)) {
      showToast('That does not look like a valid YouTube link.', { icon: '⚠️', type: 'danger' });
      return;
    }
    currentVideoId = nextId;
    if (ytStagePlayer && typeof ytStagePlayer.loadVideoById === 'function') {
      try { ytStagePlayer.loadVideoById(currentVideoId); } catch (err) {}
    }
    const mount = $('theater-player-mount');
    if (mount) mount.innerHTML = `<iframe src="https://www.youtube.com/embed/${currentVideoId}?autoplay=1&enablejsapi=1&rel=0&playsinline=1" title="Stage keynote" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    customYtInput.value = '';
    customYtInput.blur();
    if (presence) presence.sendScreen({ src: `https://www.youtube.com/watch?v=${currentVideoId}` });
    showToast('Stage stream updated for everyone in the hall.', { icon: '📺', type: 'success' });
  });

  // Sticky Note Pledge Submission
  let selectedColor = '#fef08a';
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      selectedColor = opt.getAttribute('data-color');
    });
  });

  const pledgeInput = $('pledge-input');
  const charCount = $('pledge-char-count');
  pledgeInput.addEventListener('input', () => { charCount.textContent = pledgeInput.value.length; });
  pledgeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitPledge(); }
  });

  function submitPledge() {
    const text = pledgeInput.value.trim().slice(0, 160);
    if (!text) {
      showToast('Write your pledge first.', { icon: '✍️' });
      pledgeInput.focus();
      return;
    }
    const visitor = presence ? presence.visitor : getVisitorInfo();
    const newPledge = {
      id: `${visitor.id}-${Date.now().toString(36)}`,
      text,
      color: selectedColor,
      by: visitor.name,
      ts: Date.now(),
    };
    addPledges([newPledge], { highlight: true });
    pledgeInput.value = '';
    charCount.textContent = '0';
    if (presence) presence.sendPledge(newPledge);
    showToast('Your pledge is now on the Commitment Wall!', { icon: '📌', type: 'success' });
  }

  $('submit-pledge-btn').addEventListener('click', submitPledge);

  // Minimap: click/tap a booth to track it; collapse on small screens.
  const mapCanvas = $('minimap-canvas');
  mapCanvas.addEventListener('click', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (MAP_SIZE / rect.width);
    const clickY = (e.clientY - rect.top) * (MAP_SIZE / rect.height);

    let nearestId = null;
    let minDist = 999;
    const hitRadius = isTouchDevice ? 18 : 12;
    for (const [idStr, b] of Object.entries(BOOTH_POSITIONS)) {
      const id = parseInt(idStr);
      const dist = Math.hypot(clickX - mapX(b.ax), clickY - mapZ(b.az));
      if (dist < hitRadius && dist < minDist) {
        minDist = dist;
        nearestId = id;
      }
    }
    if (nearestId) {
      if (activeWaypointId === nearestId) clearWaypoint();
      else setWaypoint(nearestId);
    }
  });

  const minimap = $('minimap-container');
  const minimapToggle = $('minimap-toggle');
  minimapToggle.addEventListener('click', () => {
    const collapsed = minimap.classList.toggle('collapsed');
    minimapToggle.setAttribute('aria-expanded', String(!collapsed));
  });
}

function updateVisitedHUD() {
  const el = $('stamps-count');
  if (el) el.textContent = visitedBooths.size;
}

// --- Minimap Radar ---
const MAP_SIZE = 200;
let mapDpr = 1;
const mapX = (x) => 12 + (x / 28.0) * (MAP_SIZE - 24);
const mapZ = (z) => 12 + ((25.0 + z) / 25.0) * (MAP_SIZE - 24);

function setupMinimapCanvas() {
  const canvas = $('minimap-canvas');
  mapDpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = MAP_SIZE * mapDpr;
  canvas.height = MAP_SIZE * mapDpr;
}

// The minimap is two layers. Everything architectural — perimeter, divider, stage, stairs,
// desk footprints, hotspots, chairs, booth stands and their labels — never changes, but the
// previous version re-rasterised all of it on every animation frame, at 60 Hz, along with a
// fresh getContext('2d') call each time. It is now drawn once into an offscreen canvas and
// blitted, with only the moving marks redrawn on top.
let mapStatic = null;       // OffscreenCanvas/HTMLCanvasElement holding the baked layer
let mapCtx = null;          // cached 2D context for the visible canvas
let mapNextDraw = 0;        // next timestamp (ms) the dynamic layer is allowed to redraw

const MAP_HZ = 15;          // the player marker is smooth enough at 15 Hz and costs a quarter

function buildMinimapStatic() {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE * mapDpr;
  canvas.height = MAP_SIZE * mapDpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);

  // Main Hall perimeter
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(mapX(0.8), mapZ(-24.8), mapX(19.35) - mapX(0.8), mapZ(0.0) - mapZ(-24.8));

  // Foyer perimeter
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
  ctx.strokeRect(mapX(19.35), mapZ(-20.8), mapX(26.8) - mapX(19.35), mapZ(0.0) - mapZ(-20.8));

  // Divider wall with doors
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(mapX(19.35), mapZ(0.0)); ctx.lineTo(mapX(19.35), mapZ(-7.0));
  ctx.moveTo(mapX(19.35), mapZ(-8.8)); ctx.lineTo(mapX(19.35), mapZ(-11.4));
  ctx.moveTo(mapX(19.35), mapZ(-13.2)); ctx.lineTo(mapX(19.35), mapZ(-20.8));
  ctx.stroke();

  // Stage
  ctx.fillStyle = 'rgba(168, 85, 247, 0.45)';
  ctx.fillRect(mapX(4.68), mapZ(-24.8), mapX(14.68) - mapX(4.68), mapZ(-21.75) - mapZ(-24.8));

  // Staircase (solid)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(mapX(STAIRS_BOX.minX), mapZ(STAIRS_BOX.minZ), mapX(STAIRS_BOX.maxX) - mapX(STAIRS_BOX.minX), mapZ(-0.8) - mapZ(STAIRS_BOX.minZ));

  // Welcome desk + commitment wall footprints
  ctx.fillStyle = 'rgba(0, 212, 255, 0.35)';
  for (const b of [WELCOME_DESK_BOX, COMMITMENT_WALL_BOX]) {
    ctx.fillRect(mapX(b.minX), mapZ(b.minZ), mapX(b.maxX) - mapX(b.minX), mapZ(b.maxZ) - mapZ(b.minZ));
  }

  // Hotspots
  ctx.fillStyle = 'rgba(245, 158, 11, 0.8)';
  for (const key of ['welcomeDesk', 'commitmentWall', 'mediaHub']) {
    const spot = HOTSPOTS[key];
    ctx.fillRect(mapX(spot.x) - 3, mapZ(spot.z) - 3, 6, 6);
  }

  // Organizer booths (brand-coloured stands along the foyer's east side)
  for (const { org } of organizerBooths.values()) {
    ctx.fillStyle = brandHighlight(org);
    ctx.fillRect(mapX(org.x) - 2.5, mapZ(org.z) - 6, 5, 12);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(org.short.toUpperCase(), mapX(org.x) - 5, mapZ(org.z) + 3);
  }
  ctx.textAlign = 'left';

  // Mascots sit at fixed stations, so they belong to the static layer too.
  if (mascots) {
    for (const m of mascots.list) {
      ctx.fillStyle = brandHighlight(organizersData.find(o => o.mascot === m.cfg.id));
      ctx.beginPath();
      ctx.arc(mapX(m.cfg.x), mapZ(m.cfg.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Chairs
  ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
  for (const c of CHAIR_LOCATIONS) {
    ctx.beginPath();
    ctx.arc(mapX(c.x), mapZ(c.z), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Booth stands (draw the physical panel as a short line so the two faces read as one stand)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  for (const b of Object.values(BOOTH_POSITIONS)) {
    if (b.facing !== 1) continue;
    ctx.beginPath();
    ctx.moveTo(mapX(b.x), mapZ(b.z - 0.9));
    ctx.lineTo(mapX(b.x), mapZ(b.z + 0.9));
    ctx.stroke();
  }

  mapStatic = canvas;
}

/** Forces the baked layer to be rebuilt — call when its inputs change (resize, organizers load). */
function invalidateMinimapStatic() {
  mapStatic = null;
}

function drawMinimap(force = false) {
  const container = $('minimap-container');
  if (container.classList.contains('collapsed')) return;

  const now = performance.now();
  if (!force && now < mapNextDraw) return;
  mapNextDraw = now + 1000 / (isLowPowerDevice ? MAP_HZ / 2 : MAP_HZ);

  const canvas = $('minimap-canvas');
  if (!mapCtx || mapCtx.canvas !== canvas) mapCtx = canvas.getContext('2d');
  const ctx = mapCtx;

  if (!mapStatic || mapStatic.width !== MAP_SIZE * mapDpr) buildMinimapStatic();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mapStatic, 0, 0);
  ctx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);

  // --- dynamic layer -------------------------------------------------------------------
  for (const [idStr, b] of Object.entries(BOOTH_POSITIONS)) {
    const id = parseInt(idStr);
    const bx = mapX(b.ax);
    const bz = mapZ(b.az);
    const isTarget = activeWaypointId === id;

    if (isTarget) {
      const pulse = 6 + Math.sin(clock.getElapsedTime() * 5) * 1.5;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, bz, pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isTarget ? '#f59e0b' : visitedBooths.has(id) ? '#10b981' : '#00d4ff';
    ctx.beginPath();
    ctx.arc(bx, bz, 3.2, 0, Math.PI * 2);
    ctx.fill();

    if (isTarget) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pad2(id), bx, bz - 9);
      ctx.textAlign = 'left';
    }
  }

  // Remote players
  for (const rp of remotePlayers.values()) {
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(mapX(rp.model.position.x), mapZ(rp.model.position.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Local player & vision cone
  const px = mapX(player.pos.x);
  const pz = mapZ(player.pos.z);

  ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
  ctx.beginPath();
  ctx.moveTo(px, pz);
  const coneAngle = Math.PI / 4;
  const lookAngle = -Math.PI / 2 - player.yaw;
  ctx.arc(px, pz, 24, lookAngle - coneAngle, lookAngle + coneAngle);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(px, pz, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function onWindowResize() {
  applyResponsiveFov();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (cssRenderer) cssRenderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  setupMinimapCanvas();
  invalidateMinimapStatic();
}

// --- Animation Loop ---
const _lookDir = new THREE.Vector3();
let lastPresenceHeartbeat = 0;
let lastFrameMs = 0;

function animate() {
  requestAnimationFrame(animate);

  if (perfHud) perfHud.beginFrame();

  // Wall-clock frame time, separate from the clamped simulation delta below: the governor has
  // to see a 300 ms stall as 300 ms, not as the 100 ms the physics step is allowed to assume.
  const nowMs = performance.now();
  const frameMs = lastFrameMs ? nowMs - lastFrameMs : 16.7;
  lastFrameMs = nowMs;

  const delta = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();

  updatePlayer(delta);
  updateRemoteAvatars(delta);
  if (mascots) mascots.update(t, delta, player.pos, openModals.size > 0 || isBlockerVisible());
  checkProximity();
  drawMinimap();

  // Keep the presence server's stale-timeout happy even while standing still.
  if (presence && t - lastPresenceHeartbeat > 5) {
    lastPresenceHeartbeat = t;
    presence.sendMove(player.pos.x, player.pos.y, player.pos.z, player.yaw);
  }

  // Animate holographic markers & labels. A booth's marker/label is only shown to players
  // standing on the side of the stand that booth faces, so the back-side booth never
  // "leaks" above the panel (tracked targets stay visible from anywhere as a beacon).
  const camX = camera.position.x;
  boothMarkers.forEach(m => {
    const isTarget = m.userData.state === 'target';
    const onFacingSide = (camX - m.userData.panelX) * m.userData.facing > -0.35;
    m.visible = isTarget || onFacingSide;
    if (!m.visible) return;
    
    m.rotation.y = t * (isTarget ? 3.0 : 1.5);
    m.position.y = m.userData.initialY + Math.sin(t * 3.0 + m.userData.boothId) * (isTarget ? 0.16 : 0.08);
    
    if (m.userData.wire) {
      m.userData.wire.rotation.y = t * -1.0;
    }
    
    const s = isTarget ? 1.35 + Math.sin(t * 6) * 0.12 : 1;
    m.scale.set(s, s, s);
    
    if (m.userData.glow) {
      m.userData.glow.position.y = (-m.position.y + 0.01) / s;
    }
  });
  for (const label of boothLabels.values()) {
    const isTarget = activeWaypointId === label.userData.boothId;
    label.visible = isTarget || (camX - label.userData.panelX) * label.userData.facing > -0.35;
  }

  if (dustParticles) {
    const positions = dustParticles.geometry.attributes.position.array;
    const basePositions = dustParticles.userData.basePositions;
    const speeds = dustParticles.userData.speeds;
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3] = basePositions[i * 3] + Math.sin(t * speeds[i] * 0.5) * 0.3;
      positions[i * 3 + 2] = basePositions[i * 3 + 2] + Math.cos(t * speeds[i] * 0.4) * 0.3;
      let y = positions[i * 3 + 1] + delta * speeds[i] * 0.1;
      if (y > 4.5) y = 1.8;
      positions[i * 3 + 1] = y;
    }
    dustParticles.geometry.attributes.position.needsUpdate = true;
  }

  // Render CSS3D stage screen only when it could be visible
  const inMainHall = player.pos.x <= 19.35 && player.pos.z > -25.0;
  camera.getWorldDirection(_lookDir);
  const facingStage = _lookDir.z < 0.2;

  if (inMainHall && facingStage && cssRenderer) {
    cssRenderer.domElement.style.display = 'block';
    cssRenderer.render(cssScene, camera);
  } else if (cssRenderer) {
    cssRenderer.domElement.style.display = 'none';
  }

  if (composer && quality.usePost) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }

  if (perfHud) perfHud.update();
  quality.sample(frameMs, nowMs);
}

// Global debug & test hooks
window.__diplomaticGame = {
  player,
  get camera() { return camera; },
  get scene() { return scene; },
  get cssScene() { return cssScene; },
  get cssRenderer() { return cssRenderer; },
  get ytStagePlayer() { return ytStagePlayer; },
  get policyBoardMesh() { return policyBoardMesh; },
  get isTouchDevice() { return isTouchDevice; },
  get activeTarget() { return activeTarget; },
  get openModals() { return Array.from(openModals); },
  get aimedTV() { return aimedTV; },
  get tvScreens() { return tvScreens; },
  get sharedVideos() { return sharedVideos; },
  get mascots() { return mascots; },
  get organizerBooths() { return organizerBooths; },
  get presence() { return presence; },
  get hallModel() { return hallModel; },
  get perfHud() { return perfHud; },
  get quality() { return quality; },
  get welcomeDesk() { return welcomeDesk; },
  get policyWallGroup() { return policyWallGroup; },
  get policyCanvas() { return policyCanvas; },
  staticBoxes,
  WELCOME_DESK_BOX,
  COMMITMENT_WALL_BOX,
  WALL_NOTE_CAPACITY,
  getPledges,
  addPledges,
  updatePolicyWallTexture,
  teleportPlayer,
  sitDownOnChair,
  standUp,
  handleInteract,
  openBoothModal,
  openOrganizerModal,
  openTV,
  pickTV,
  checkCollision,
  checkProximity,
  setWaypoint,
  clearWaypoint,
  showToast,
  CHAIR_LOCATIONS,
  BOOTH_POSITIONS,
  HOTSPOTS,
  openStageTheater,
};

window.addEventListener('DOMContentLoaded', init);
