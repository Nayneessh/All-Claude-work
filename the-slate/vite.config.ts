import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA: `npm run build` -> dist/ can be served by any web server (see Dockerfile / nginx.conf / docs/MIGRATION_GUIDE.md).
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5175 },
});
