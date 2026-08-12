// Smoke-test vite config: runs the real app in a plain browser with the Tauri
// IPC layer replaced by spike/mock-*.ts (backed by spike/mock-server.mjs).
//   node spike/mock-server.mjs &
//   npx vite --config spike/vite.mock.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: here('./mock-core.ts') },
      { find: /^@tauri-apps\/api\/event$/, replacement: here('./mock-event.ts') },
    ],
  },
  server: {
    port: 4322,
    strictPort: true,
    // Keep the page same-origin: proxy mock-bridge endpoints through vite.
    proxy: {
      '/installed': 'http://localhost:4321',
      '/rpc': 'http://localhost:4321',
      '/events': 'http://localhost:4321',
      '/stderr': 'http://localhost:4321',
      '/sessions': 'http://localhost:4321',
      '/stop': 'http://localhost:4321',
    },
  },
});
