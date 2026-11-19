import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The game server (account API + WebSocket); override with PW_SERVER=http://host:port. */
const SERVER = process.env.PW_SERVER ?? 'http://127.0.0.1:8787';
const proxy = {
  '/api': { target: SERVER, changeOrigin: false },
  '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy,
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
});
