import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to this origin. In development Vite forwards /api/* to the Express server
// (server/), which is the only thing that calls NOAA. PORT must match the server's (default 3001).
const apiPort = process.env.PORT ?? '3001';

// Two pages: the landing page at / and the dashboard at /app/.
const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { landing: page('./index.html'), app: page('./app/index.html') },
    },
  },
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
