/**
 * The sailing opening of the Youth Innovations Marketplace.
 *
 *   /sail/                      a phone: tap left and right to sail to the lighthouse
 *   /sail/?view=led             the big screen: the whole fleet, the QR code, the count
 *   /sail/?view=host&token=...  the operator's panel: Start, Open now, threshold, Reset
 *   ...&demo=30                 any of them with 30 bots and no server, for previewing
 */
import './sail.css';
import { createNet } from './net.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') === 'led' ? 'led' : q.get('view') === 'host' ? 'host' : 'player';
const demo = Number(q.get('demo')) || 0;
const token = q.get('token') || '';
const root = document.getElementById('sail-root');
document.body.dataset.view = view;

function fatal(message) {
  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'sail-fatal';
  card.textContent = message;
  root.append(card);
}

async function boot() {
  if (view === 'host') {
    const { startHost } = await import('./hostView.js');
    startHost(root, (on) => createNet({ view, token, demo, on }));
    return;
  }
  // Canvas text needs the brand font ready first, or the signs would draw in a fallback font.
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('500 40px Fredoka')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* fall back to the system font */ }

  const { createWorld } = await import('./world.js');
  const canvas = document.createElement('canvas');
  canvas.id = 'sail-canvas';
  root.append(canvas);
  let world;
  try {
    world = await createWorld(canvas, { isLed: view === 'led' });
  } catch (err) {
    console.error(err);
    fatal('This device could not start the 3D view. Watch the big screen instead!');
    return;
  }
  if (view === 'led') {
    const { startLed } = await import('./ledView.js');
    await startLed(root, world, (on) => createNet({ view, token, demo, on }), { token });
  } else {
    const { startPlayer } = await import('./playerView.js');
    await startPlayer(root, world, (on) => createNet({ view, token, demo, on }));
  }
  document.getElementById('sail-loading')?.remove();
}

boot().catch((err) => {
  console.error(err);
  fatal('Something went wrong loading the sail. Please refresh the page.');
});
