import { devvit } from '@devvit/start/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [devvit(), react()],
  build: {
    assetsInlineLimit: 512 * 1024,
  },
  resolve: {
    alias: {
      '@llmphysics/bot-core': path.resolve(__dirname, '../packages/bot-core/src'),
    },
  },
});
