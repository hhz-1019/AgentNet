import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: '../../dist-core', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 4321,
    proxy: {
      '^/api/': {
        target: process.env.CORE_HTTP_URL || 'http://127.0.0.1:4320',
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
