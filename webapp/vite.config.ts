// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function chunkName(moduleId: string): string | undefined {
  if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) {
    return 'react';
  }
  if (moduleId.includes('/node_modules/@cloudscape-design/')) {
    return 'cloudscape';
  }
  if (moduleId.includes('/node_modules/oidc-client-ts/')) {
    return 'authentication';
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
    // Cloudscape remains one cohesive 787 kB chunk and compresses to about 219 kB.
    chunkSizeWarningLimit: 800,
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
