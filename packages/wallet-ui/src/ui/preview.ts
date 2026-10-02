/**
 * The preview a screen holds while it offers Speed up or Cancel, the same on
 * both shells. Each shows a built preview before anything is signed, and a
 * screen offers one or the other, so it holds at most one. Every drop moves a
 * generation on, so a build still running then is discarded when it lands
 * instead of being offered.
 */

import { api } from "../api";
import { type BroadcastResult, errorMessage, type TxPreview } from "../types";
import type { Banner } from "./dom";

export interface HeldPreview {
  /** Discards the preview held, and any build still running once it lands. */
  drop(): void;
  /**
   * Builds the preview the screen offers, in place of any held before. `null`
   * when `counts` stops holding or a newer build moved on first; a failure is
   * thrown only while this build is still the one that counts.
   */
  hold(build: () => Promise<TxPreview>, counts: () => boolean): Promise<TxPreview | null>;
  /**
   * Hands the held preview over to be signed and sent, and the result to
   * `done`. With nothing held — the last build failed, or is still running —
   * it runs `again` instead. Signing uses the preview up whether or not it
   * went out, so a failure is said in the banner and `again` runs too, while
   * `counts` holds.
   */
  send(
    counts: () => boolean,
    done: (result: BroadcastResult) => void,
    again: () => void | Promise<void>,
  ): Promise<void>;
}

/** Call once, while the screen is being built: it drops what it holds when the screen goes. */
export function heldPreview(alert: Banner): HeldPreview {
  let held: TxPreview | null = null;
  let gen = 0;

  const drop = (): void => {
    gen += 1;
    if (held) void api.discardTx(held.psbt_id);
    held = null;
  };
  // Screens are rebuilt on every navigation, so a preview still held when
  // its screen goes away is unreachable, stranded in the core's pending map.
  window.addEventListener("hashchange", drop, { once: true });

  return {
    drop,
    async hold(build, counts) {
      drop();
      const mine = gen;
      const current = () => mine === gen && counts();
      let preview: TxPreview;
      try {
        preview = await build();
      } catch (e) {
        if (current()) throw e;
        return null;
      }
      if (!current()) {
        void api.discardTx(preview.psbt_id);
        return null;
      }
      held = preview;
      return preview;
    },
    async send(counts, done, again) {
      const preview = held;
      held = null;
      if (!preview) {
        await again();
        return;
      }
      alert.hide();
      try {
        done(await api.signAndBroadcast(preview.psbt_id));
      } catch (e) {
        if (!counts()) return;
        alert.show("error", errorMessage(e));
        await again();
      }
    },
  };
}
