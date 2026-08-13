import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: '127.0.0.1',
    port: 5277,
    strictPort: true,
    hmr: process.env.KIT_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1', port: 5277 },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
});
