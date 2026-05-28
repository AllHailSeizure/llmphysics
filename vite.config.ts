import { devvit } from '@devvit/start/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [devvit(), react()],
});
