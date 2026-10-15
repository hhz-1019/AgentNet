import { build } from 'vite';
await build({
  configFile: false,
  build: {
    outDir: 'dist-moment-panel',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: 'eigenflux/client/moment-panel.mjs',
      formats: ['es'],
      fileName: () => 'panel.js',
    },
  },
});
