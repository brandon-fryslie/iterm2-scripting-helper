import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      // Native optional deps of `ws` — leaving them bundled makes esbuild
      // stub bufferutil's `.mask` to `undefined`, and ws falls through to
      // its broken "use-native-for-payloads-over-48-bytes" branch. Marking
      // them external forces `require('bufferutil')` at runtime, which
      // rejects with MODULE_NOT_FOUND, and ws's try/catch pins masking to
      // the pure-JS _mask fallback.
      external: ['bufferutil', 'utf-8-validate'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(here, 'src/shared'),
    },
  },
});
