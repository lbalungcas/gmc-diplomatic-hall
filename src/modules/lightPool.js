/**
 * Light pool: a fixed number of real point lights shared by many light fixtures.
 *
 * The venue has ~25 fixtures (hall ceiling lights, warm pools over the booth islands, the lobby's
 * ceiling lights and chandeliers). Each point light in the scene adds a term to every lit
 * fragment's shader loop whether or not it reaches that fragment, so ~25 always-on lights were
 * the largest single per-pixel cost. Only the fixtures near the viewer matter visually; the far
 * ones are a few percent of the light on any surface you are looking at, and the environment map
 * and the emissive fixtures themselves carry the rest.
 *
 * So the scene holds `size` PointLights. A few times a second the pool picks the fixtures that
 * matter most to the camera (intensity over distance squared) and hands them a light; fixtures
 * that drop out fade to zero before their light is reused, and newcomers fade in, so there is
 * no pop. The light count never changes, which matters: changing it would recompile every
 * material's shader.
 */
import * as THREE from 'three';

const PICK_INTERVAL = 0.25;   // seconds between re-ranking the fixtures
const FADE_TIME = 0.6;        // seconds for a light to fade fully in or out

export function createLightPool(scene, fixtures, { size = 10 } = {}) {
  const slots = [];
  for (let i = 0; i < size; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 1, 1.5);
    light.name = `LightPool_${i}`;
    scene.add(light);
    slots.push({ light, fixture: null, w: 0, target: 0 });
  }
  let sincePick = PICK_INTERVAL;
  const _cam = new THREE.Vector3();

  function rank(pos) {
    return fixtures
      .map((f) => {
        const d2 = (f.x - pos.x) ** 2 + (f.y - pos.y) ** 2 + (f.z - pos.z) ** 2;
        return { f, score: f.intensity / Math.max(4, d2) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, size)
      .map((r) => r.f);
  }

  function assign(slot, f) {
    slot.fixture = f;
    slot.light.color.set(f.color);
    slot.light.distance = f.distance;
    slot.light.decay = f.decay ?? 1.5;
    slot.light.position.set(f.x, f.y, f.z);
    slot.w = 0;
    slot.target = 1;
  }

  function pick(pos) {
    const wanted = new Set(rank(pos));
    for (const s of slots) if (s.fixture && !wanted.has(s.fixture)) s.target = 0;
    for (const f of wanted) {
      if (slots.some((s) => s.fixture === f)) {
        slots.find((s) => s.fixture === f).target = 1;
        continue;
      }
      const free = slots.find((s) => !s.fixture);
      if (free) assign(free, f);
    }
  }

  /** Per frame: re-rank occasionally, advance the fades. `instant` skips the fade (teleports). */
  function update(camera, dt, { instant = false } = {}) {
    camera.getWorldPosition(_cam);
    sincePick += dt;
    if (instant || sincePick >= PICK_INTERVAL) {
      sincePick = 0;
      pick(_cam);
    }
    const step = instant ? 1 : Math.min(1, dt / FADE_TIME);
    for (const s of slots) {
      if (!s.fixture) continue;
      s.w += Math.sign(s.target - s.w) * Math.min(step, Math.abs(s.target - s.w));
      s.light.intensity = s.fixture.intensity * s.w;
      if (s.w <= 0 && s.target === 0) {
        s.fixture = null;
        s.light.intensity = 0;
      }
    }
    if (instant) {
      // A second pass places newcomers into the slots just freed.
      pick(_cam);
      for (const s of slots) if (s.fixture) { s.w = s.target; s.light.intensity = s.fixture.intensity * s.w; }
    }
  }

  return { update, slots, fixtures };
}
