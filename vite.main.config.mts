import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Bake the static update feed URL into the main bundle at make time. A build knows its own
  // update channel; an empty string (the default when unset) makes autoupdate explicitly
  // disable itself rather than fail at runtime. [LAW:no-silent-failure]
  define: {
    WORKBENCH_UPDATE_FEED_URL: JSON.stringify(process.env.WORKBENCH_UPDATE_FEED_URL ?? ''),
  },
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
