import { defineConfig } from "vitest/config";

/**
 * Only the pure modules are covered here: parsing, validation and the
 * arithmetic that decides what a transaction pays. They are the code where a
 * mistake costs money rather than a redraw, and they need no DOM — except the
 * router, which asks for jsdom per file.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
