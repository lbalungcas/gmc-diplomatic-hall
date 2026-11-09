/**
 * Boat names floating over the masts, so the sail looks like a real race. HTML labels placed over
 * the 3D view each frame: crisp at any size, and a handful of them cost nothing. Each screen
 * chooses which boats get one (the leaders on the LED, the boats around you on a phone), in order of
 * importance: a tag that would cover one already placed is left out, so the first stays readable.
 */
import * as THREE from 'three';

export function createNameTags(parent, camera, { className = 'nametag', max = 10 } = {}) {
  const pool = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < max; i++) {
    const tag = document.createElement('div');
    tag.className = className;
    tag.hidden = true;
    parent.append(tag);
    pool.push({ tag, text: '', cls: '', w: 0, h: 0 });
  }

  return {
    /** `rows`: up to `max` of { pos (world), name, cls }; any not given are hidden. */
    update(rows) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const placed = [];
      for (let i = 0; i < pool.length; i++) {
        const slot = pool[i];
        const row = rows[i];
        if (!row) {
          slot.tag.hidden = true;
          continue;
        }
        v.copy(row.pos).project(camera);
        if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
          slot.tag.hidden = true;
          continue;
        }
        const cls = `${className}${row.cls ? ` ${row.cls}` : ''}`;
        if (slot.text !== row.name || slot.cls !== cls) {
          slot.tag.textContent = slot.text = row.name;
          slot.tag.className = slot.cls = cls;
          slot.tag.hidden = false;
          slot.w = slot.tag.offsetWidth;     // measured only when the words change
          slot.h = slot.tag.offsetHeight;
        }
        const x = ((v.x + 1) / 2) * W;
        const y = ((1 - v.y) / 2) * H;
        const box = { l: x - slot.w / 2 - 3, r: x + slot.w / 2 + 3, t: y - slot.h - 2, b: y + 2 };
        if (placed.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) {
          slot.tag.hidden = true;
          continue;
        }
        placed.push(box);
        slot.tag.hidden = false;
        slot.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    },
    hide() {
      for (const slot of pool) slot.tag.hidden = true;
    },
  };
}
