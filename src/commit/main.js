/**
 * The live commitment wall of the Youth Innovations Marketplace.
 *
 *   /commit/                       a phone: write what you commit to
 *   /commit/?view=wall             the big screen: the commitments, the QR code, then the finale
 *   /commit/?view=admin&token=...  the moderator: approve, remove, start the finale
 *   ...&demo=120                   any of them with made-up commitments and no server, for previewing
 */
import './commit.css';
import { createNet } from './net.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') === 'wall' ? 'wall' : q.get('view') === 'admin' ? 'admin' : 'phone';
const demo = Number(q.get('demo')) || 0;
const token = q.get('token') || '';
const root = document.getElementById('commit-root');
document.body.dataset.view = view;

const connect = (on) => createNet({ view, token, demo, on });

async function boot() {
  if (view === 'admin') {
    const { startAdmin } = await import('./adminView.js');
    startAdmin(root, connect);
  } else if (view === 'wall') {
    // The cards and the finale both measure text, so the brand font has to be ready first.
    try {
      await Promise.race([
        Promise.all([document.fonts.load('500 40px Fredoka'), document.fonts.load('700 40px Fredoka')]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch { /* falls back to the system font */ }
    const { startWall } = await import('./wallView.js');
    await startWall(root, connect, { token });
  } else {
    const { startPhone } = await import('./phoneView.js');
    startPhone(root, connect);
  }
  document.getElementById('commit-loading')?.remove();
}

boot().catch((err) => {
  console.error(err);
  root.textContent = 'Something went wrong loading this page. Please refresh.';
});
