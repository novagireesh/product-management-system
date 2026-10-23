import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.PORT || 5050}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: true,
    // The costing engine in /shared is used by both the server and the browser.
    fs: { allow: ['..'] },
    proxy: {
      '/api': api,
      '/media': api,
    },
  },
});
