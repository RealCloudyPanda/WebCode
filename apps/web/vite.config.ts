import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// monaco-editor's package exports map `esm/vs/...` deep imports (used by y-monaco and the workers) to the wrong place.
const monacoEsm = fileURLToPath(new URL('./node_modules/monaco-editor/esm/', import.meta.url));

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const backend = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^monaco-editor\/esm\//, replacement: monacoEsm }] },
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
