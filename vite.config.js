import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiMiddleware } from './server/api.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'merry-match-sqlite-api',
      configureServer(server) {
        server.middlewares.use(createApiMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createApiMiddleware());
      },
    },
  ],
  server: {
    allowedHosts: [
      'advice-epson-org-maiden.trycloudflare.com',
      '.trycloudflare.com',
    ],
  },
});
