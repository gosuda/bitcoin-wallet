import { defineConfig } from "vitest/config";

/**
 * Most files cover pure modules, and run in Node: parsing, validation, the
 * arithmetic that decides what a transaction pays, the route guard and the
 * shapes the wasm core hands back. A file that needs a DOM asks for jsdom
 * itself — `screens.test.ts` renders real screens over a faked wasm core.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
