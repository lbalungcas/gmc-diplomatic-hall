/**
 * Starts the multiplayer presence server and the Vite dev server together, so `npm run dev`
 * gives a working "Online" hall out of the box. Ctrl+C stops both.
 *
 *   npm run dev            → presence server on :8787 + Vite on :5173 (LAN-exposed)
 *   npm run dev -- --port 5180   (extra args are passed through to Vite)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const viteBin = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const presencePort = process.env.PRESENCE_PORT || process.env.PORT || '8787';

const children = [];

function run(label, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`\n[${label}] exited with code ${code ?? 0} — stopping the other process.`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill(); } catch {}
  }
  setTimeout(() => process.exit(code), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`[presence] starting on port ${presencePort}`);
run('presence', ['server/presence.js'], { PORT: presencePort });
run('vite', [viteBin, ...process.argv.slice(2)], { PRESENCE_PORT: presencePort });
