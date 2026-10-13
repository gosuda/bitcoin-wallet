import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("native HTTP enforces the backend scope on every redirect", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );

  assert.equal(config.plugins?.http?.scopeRedirects, true);
});
