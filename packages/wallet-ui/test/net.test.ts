import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChainFetch, REQUEST_TIMEOUT_MS, REQWEST_TIMED_OUT, withTimeout } from "../src/net";
import { session } from "../src/session";

/**
 * A stand-in for `fetch` that answers only when told to, and fails the way a
 * real one does once its signal is aborted.
 */
function heldFetch() {
  const seen: AbortSignal[] = [];
  let answer: (response: Response) => void = () => undefined;
  const fetchFn = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          seen.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }
        answer = resolve;
      }),
  );
  return { fetchFn, seen, answer: (response: Response) => answer(response) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("passes an answer through, and leaves no timer behind once reqwest is done", async () => {
    const held = heldFetch();
    const caller = new AbortController();
    const pending = withTimeout(held.fetchFn)(
      new Request("https://mempool.space/api/blocks/tip/height", { signal: caller.signal }),
    );
    held.answer(new Response("123"));
    await expect(pending).resolves.toBeInstanceOf(Response);

    // `caller` stands for reqwest's own signal, on the Request it hands to
    // fetch: its AbortGuard lives in the response and aborts on drop, once the
    // response has been read.
    caller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cuts off a request that never answers, the way reqwest's own timeout would", async () => {
    const held = heldFetch();
    const pending = withTimeout(held.fetchFn)("https://mempool.space/api/blocks/tip/height");
    const outcome = pending.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(held.seen[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    // The exact value reqwest's wasm client reads back as a timeout.
    expect(await outcome).toBe(REQWEST_TIMED_OUT);
    expect(held.seen[0]?.aborted).toBe(true);
    expect(held.seen[0]?.reason).toBe(REQWEST_TIMED_OUT);
  });

  it("hands the caller's abort to the inner fetch as init.signal, and stops the clock", async () => {
    const held = heldFetch();
    const caller = new AbortController();
    const pending = withTimeout(held.fetchFn)(
      new Request("https://mempool.space/api/tx/00", { signal: caller.signal }),
    );
    const outcome = pending.catch((e: unknown) => e);

    caller.abort("dropped");
    expect(held.seen[0]?.aborted).toBe(true);
    expect(await outcome).toBe("dropped");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("installChainFetch", () => {
  const original = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("location", new URL("http://localhost:5173/"));
  });

  afterEach(() => {
    globalThis.fetch = original;
    session.config = null;
    vi.unstubAllGlobals();
  });

  it("bounds and reroutes what leaves this origin, and leaves the rest alone", async () => {
    const page = vi.fn(async () => new Response("asset"));
    const route = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("chain"),
    );
    globalThis.fetch = page;
    installChainFetch(route);

    await globalThis.fetch("/assets/app.js");
    await globalThis.fetch("http://localhost:5173/wallet_wasm_bg.wasm");
    expect(page).toHaveBeenCalledTimes(2);
    expect(route).not.toHaveBeenCalled();

    await globalThis.fetch("https://mempool.space/signet/api/blocks/tip/height");
    expect(route).toHaveBeenCalledTimes(1);
    // Rerouted with a signal of its own: the one the time limit aborts.
    const init = route.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("bounds a backend served from this very origin too, and nothing else there", async () => {
    session.config = {
      network: "signet",
      address_type: "p2wpkh",
      backend: { kind: "esplora", url: "http://localhost:5173/esplora/api/" },
    };
    const page = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("same origin"),
    );
    globalThis.fetch = page;
    installChainFetch();

    await globalThis.fetch("http://localhost:5173/wallet_wasm_bg.wasm");
    await globalThis.fetch("http://localhost:5173/esplora/api-docs");
    await globalThis.fetch("http://localhost:5173/esplora/api/blocks/tip/height");

    // The app's own files keep the page's fetch untouched: no signal of ours.
    expect(page.mock.calls[0]?.[1]?.signal).toBeUndefined();
    expect(page.mock.calls[1]?.[1]?.signal).toBeUndefined();
    expect(page.mock.calls[2]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
