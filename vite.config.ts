import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // The markdown/highlight stack (~336KB) must not be parsed before the app's
  // first frame: it is imported only via React.lazy in Message.tsx, so rollup
  // keeps it in its own chunk, loaded on demand. No manualChunks here — both
  // the object and function forms end up packing shared deps (react etc.)
  // into the markdown chunk, which forces the entry to statically import it.
  build: {
    rollupOptions: {
      output: {
        // Don't hoist dynamically-imported chunks into the entry's static
        // imports — otherwise the markdown chunk above would be parsed before
        // the first frame, defeating the lazy load.
        hoistTransitiveImports: false,
      },
    },
  },
}));
