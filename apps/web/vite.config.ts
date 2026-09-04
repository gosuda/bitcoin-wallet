import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 14400, strictPort: true },
  build: {
    // The wallet core is WebAssembly, so the floor is any browser that can run
    // it; this matches the desktop shell's non-Windows target.
    target: "safari13",
  },
});
