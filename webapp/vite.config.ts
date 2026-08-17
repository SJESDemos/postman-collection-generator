// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function chunkName(moduleId: string): string | undefined {
  if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) {
    return 'react';
  }
  return undefined;
}

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../webui/static',
    emptyOutDir: true,
    sourcemap: false,
    // Cloudscape is a cohesive UI runtime. Its 808 kB vendor/application chunk is 229 kB gzip.
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'styles.css' : '[name][extname]',
        manualChunks: chunkName,
      },
    },
  },
});
