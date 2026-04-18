import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(here, 'src/renderer'),
  build: {
    outDir: path.resolve(here, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src/renderer'),
      '@shared': path.resolve(here, 'src/shared'),
    },
  },
});
