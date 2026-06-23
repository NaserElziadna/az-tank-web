import { defineConfig } from 'vite';

// Clean, zero-config-ish Vite setup. Only files imported from src/ are bundled,
// so the reference `cdn.tanktrouble.com/` folder is never included in the build.
export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
    emptyOutDir: true,
  },
});
