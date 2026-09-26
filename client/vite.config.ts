import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to this origin. In development Vite forwards /api/* to the Express server
// (server/), which is the only thing that calls NOAA. PORT must match the server's (default 3001).
const apiPort = process.env.PORT ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
