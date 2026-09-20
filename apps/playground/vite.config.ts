import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@captcha-service/react': path.resolve(__dirname, '../../packages/react/src/index.ts'),
    },
  },
  server: {
    port: 5175,
  },
});

