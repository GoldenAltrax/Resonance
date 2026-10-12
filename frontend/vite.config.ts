/// <reference types="vitest/config" />
import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Static files from /public that belong to the app shell
const PUBLIC_SHELL = ['/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

/**
 * Emits /sw.js from sw.template.js with the build's asset list and a unique build id.
 * Replaces vite-plugin-pwa + Workbox (~30 transitive packages) with ~20 lines.
 */
function serviceWorker(): Plugin {
  return {
    name: 'resonance-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.entries(bundle)
        .filter(([file]) => /\.(js|css|woff2?|svg|png)$/.test(file))
        // Non-Latin font subsets are only fetched when a page uses those scripts
        .filter(([file]) => !/inter-(?!latin-wght)[\w-]+\.woff2$/.test(file))
        // Large, rarely needed chunks (transliteration tables) are cached on first use instead
        .filter(([, chunk]) => chunk.type !== 'chunk' || !chunk.moduleIds.some((id) => id.includes('/transliteration/')))
        .map(([file]) => `/${file}`);
      const precache = ['/index.html', ...PUBLIC_SHELL, ...assets];
      const buildId = Date.now().toString(36);
      const source = readFileSync(path.resolve(__dirname, 'sw.template.js'), 'utf8')
        .replace('__BUILD_ID__', buildId)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-dom/client', 'zustand'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          virtual: ['@tanstack/react-virtual'],
        },
      },
    },
  },
});
