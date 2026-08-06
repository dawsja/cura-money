import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Vite config lives in src/ui/. We emit the production build to
// /public at the repo root, which the Hono app serves as static SPA.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../public',
    // Persistent assets live in src/ui/public and are copied back after
    // cleanup. Emptying first prevents obsolete hashed bundles accumulating.
    emptyOutDir: true,
  },
});
