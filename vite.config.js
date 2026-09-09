import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The `textures/` folder is shared with the Blender pipeline (scripts/*.py) so it lives at the
 * repo root rather than in `public/`. Vite's dev server already serves it from the root; this
 * plugin makes sure the production build ships it too (booth screen images + PBR normal maps).
 */
function copyTexturesPlugin() {
  return {
    name: 'copy-root-textures',
    apply: 'build',
    closeBundle() {
      const src = resolve(rootDir, 'textures');
      const dest = resolve(rootDir, 'dist', 'textures');
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true, filter: (p) => !/\.(blend1?|py)$/i.test(p) });
      }
    },
  };
}

const presencePort = process.env.PRESENCE_PORT || '8787';

// Same-origin `/presence` is forwarded to the presence server (start it with `npm run server`,
// or use `npm run dev` which launches both). Errors are swallowed: the client shows an
// "Offline" pill and keeps retrying with back-off instead of spamming the terminal.
const presenceProxy = {
  '/presence': {
    target: `ws://127.0.0.1:${presencePort}`,
    ws: true,
    configure: (proxy) => {
      proxy.on('error', () => {});
    },
  },
  '/analytics': {
    target: `http://127.0.0.1:${presencePort}`,
    // `/analytics` is the API; `/analytics.html` is the staff page — don't proxy the page.
    bypass(req) {
      const path = (req.url || '').split('?')[0];
      if (path === '/analytics.html' || path.startsWith('/src/')) return req.url;
    },
    configure: (proxy) => {
      proxy.on('error', () => {});
    },
  },
  '/health': {
    target: `http://127.0.0.1:${presencePort}`,
    configure: (proxy) => {
      proxy.on('error', () => {});
    },
  },
};

export default defineConfig({
  plugins: [copyTexturesPlugin()],
  define: {
    // Lets the client fall back to a direct connection when the dev proxy isn't in front of it
    // (e.g. `vite preview`, or a phone opening the LAN URL while the proxy target is down).
    __PRESENCE_PORT__: JSON.stringify(presencePort),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        analytics: resolve(rootDir, 'analytics.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true, // Listen on all local IPs so mobile devices on the same Wi-Fi can connect
    proxy: presenceProxy,
  },
  preview: {
    host: true,
    proxy: presenceProxy,
  },
});
