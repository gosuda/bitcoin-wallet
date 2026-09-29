import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 14200,
    strictPort: true,
    host: host ?? false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Vite matches these as literal prefixes, so the "TAURI_ENV_*" spelling
  // that reads like a glob silently matches nothing and every TAURI_ENV_
  // value arrives as undefined.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Vite's own minifier, not a named one: on Vite 8 that is oxc, which can
    // lower to safari13 where the esbuild pass cannot.
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
