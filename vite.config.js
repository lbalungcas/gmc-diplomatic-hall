import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The `textures/` folder is the *source* art for the Blender pipeline (scripts/*.py), living at
 * the repo root rather than in `public/` because both the generators and Blender read it.
 *
 * Almost none of it belongs in a deploy: every PBR map is baked into `diplomatic_hall.glb` by
 * scripts/build_venue.py, so copying the folder wholesale shipped ~21 MB that no browser ever
 * requested. The only files fetched over HTTP are the booth pop-up video posters
 * (`openBoothModal` in src/main.js), so that is all this copies.
 */
const RUNTIME_TEXTURES = /^booth_\d\d_screen\.png$/i;

function copyTexturesPlugin() {
  return {
    name: 'copy-root-textures',
    apply: 'build',
    closeBundle() {
      const src = resolve(rootDir, 'textures');
      const dest = resolve(rootDir, 'dist', 'textures');
      if (!existsSync(src)) return;
      let copied = 0;
      for (const name of readdirSync(src)) {
        if (!RUNTIME_TEXTURES.test(name)) continue;
        mkdirSync(dest, { recursive: true });
        cpSync(resolve(src, name), resolve(dest, name));
        copied++;
      }
      this.info?.(`copied ${copied} runtime texture(s); PBR maps ship inside the GLB`);
    },
  };
}

/**
 * Copy the landing page static assets (styles, JS, images) into the dist folder.
 * The landing page is pure HTML/CSS/JS with no Vite processing needed for its assets.
 */
function copyLandingAssetsPlugin() {
  return {
    name: 'copy-landing-assets',
    apply: 'build',
    closeBundle() {
      const src = resolve(rootDir, 'landing');
      const dest = resolve(rootDir, 'dist', 'landing');
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
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
  plugins: [copyTexturesPlugin(), copyLandingAssetsPlugin()],
  define: {
    // Lets the client fall back to a direct connection when the dev proxy isn't in front of it
    // (e.g. `vite preview`, or a phone opening the LAN URL while the proxy target is down).
    __PRESENCE_PORT__: JSON.stringify(presencePort),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        game: resolve(rootDir, 'game/index.html'),
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
