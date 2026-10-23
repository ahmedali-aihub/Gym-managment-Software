import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where /api goes in development. Overridable so a second API — one on a
// throwaway test database, say — can be used without touching the one on
// :4000, which reads the real .env and therefore the real database.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Proxying in dev keeps the frontend same-origin with the API, so the
    // httpOnly refresh cookie behaves exactly as it will in production.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries so a code change does
        // not invalidate the whole bundle in users' caches.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
