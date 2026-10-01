import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ENGINE = process.env.MENTOR_ENGINE_URL || 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  base: './', // load from file:// inside Electron
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': ENGINE,
      '/ws': { target: ENGINE.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
