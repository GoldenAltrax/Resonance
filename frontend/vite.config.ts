import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isTauriBuild = process.env.TAURI_ENV_PLATFORM !== undefined;

export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    // Allow Tauri to connect
    strictPort: true,
    proxy: isTauriBuild
      ? {}
      : {
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
  // Tauri needs specific env vars
  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Produce sourcemaps for Tauri debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          virtual: ['@tanstack/react-virtual'],
        },
      },
    },
  },
});
