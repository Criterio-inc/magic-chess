import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8240,
    strictPort: true,
    host: true, // nåbar från telefonen på samma nät
    allowedHosts: true,
    // Online-servern (npm run server) – WebSocket på /ws
    proxy: { '/ws': { target: 'ws://localhost:8241', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
