/**
 * Every test file gets the fakes in `fakes.ts` in place of what jsdom cannot
 * provide: the WebAssembly wrapper and the IndexedDB persister. A test of
 * either real module must `vi.unmock` it.
 */

import { vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);
