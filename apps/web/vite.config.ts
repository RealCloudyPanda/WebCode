import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const backend = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    headers: isolationHeaders,
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/collab': { target: backend, ws: true },
    },
  },
  preview: { headers: isolationHeaders },
});
