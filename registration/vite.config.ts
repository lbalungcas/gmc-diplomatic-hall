import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served from the main site at youthinnovationsmarketplace.org/register/ (see ../netlify.toml).
  base: '/register/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
});
