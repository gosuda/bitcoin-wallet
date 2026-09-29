/**
 * The time limit on each chain request.
 *
 * Every request the wasm core sends its chain backend goes out through the
 * page's `fetch`, and this is the only place one can be bounded: on wasm32
 * `esplora-client` does not pass its timeout on to reqwest, so a server that
 * never answers would be waited on for good. The core no longer bounds a scan
 * as a whole — its length follows the wallet's history — so without this a
 * hung server would hang a sync with it.
 */

/** The core's budget for one round trip (`CALL_DEADLINE_SECS`). */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * reqwest's wasm client reads a `fetch` rejected with exactly this string as
 * its own timeout (reqwest 0.12, `wasm/client.rs`), so the core reports a
 * `timeout` — "did not answer within 30 s" — rather than a bare backend error.
 * Were reqwest to rename it, requests would still be cut off; only the
 * message would get vaguer.
 */
export const REQWEST_TIMED_OUT = "reqwest::errors::TimedOut";

/**
 * `fetchFn`, with each request cut off after `ms` — the whole exchange, body
 * included, as reqwest's own timeout does natively.
 *
 * reqwest aborts a request's signal once it has finished with the response (or
 * given up on it), so that abort is passed on to `fetchFn` and ends the timer.
 * It reaches `fetchFn` as `init.signal`, the only signal Tauri's HTTP plugin
 * listens to; the one on the `Request` itself it never saw.
 */
export function withTimeout(fetchFn: typeof fetch, ms = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = (): void => {
      clearTimeout(timer);
      controller.abort(caller?.reason);
    };
    if (caller?.aborted) finished();
    else caller?.addEventListener("abort", finished, { once: true });

    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        caller?.removeEventListener("abort", finished);
        controller.abort(REQWEST_TIMED_OUT);
        // The bare string, not an Error: reqwest matches this exact value.
        reject(REQWEST_TIMED_OUT);
      }, ms);
    });
    return Promise.race([fetchFn(input, { ...init, signal: controller.signal }), timedOut]);
  };
}

/** Whether `url` leaves this page's origin, as every chain request does. */
function leavesThisOrigin(url: string): boolean {
  try {
    const target = new URL(url, globalThis.location.href);
    return (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.origin !== globalThis.location.origin
    );
  } catch {
    return false;
  }
}

/**
 * Bound every request that leaves this origin, sending it through `route` when
 * one is given (the native shell hands such requests to Rust). Anything else —
 * app assets, the dev server — keeps the page's own `fetch`, untimed.
 */
export function installChainFetch(route?: typeof fetch): void {
  const webFetch = globalThis.fetch.bind(globalThis);
  const chain = withTimeout(route ?? webFetch);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    return leavesThisOrigin(url) ? chain(input, init) : webFetch(input, init);
  };
}
