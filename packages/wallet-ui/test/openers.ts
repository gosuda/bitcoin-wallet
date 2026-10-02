/*
 * The screens that open a wallet, one per way in, each rendered at its route
 * and filled in, ready for the press that opens it. `reset.test.ts` makes
 * every one of them fail to open; `late-open.test.ts` holds some of them open
 * until the user has left.
 */

import { renderCreate as renderPhoneCreate } from "../src/mobile/screens/create";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderUnlock as renderPhoneUnlock } from "../src/mobile/screens/unlock";
import { renderCreate } from "../src/screens/create";
import { renderKey } from "../src/screens/key";
import { renderRestore } from "../src/screens/restore";
import { renderUnlock } from "../src/screens/unlock";
import { find, mountAt, settle, showAt, type } from "./harness";

export const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WORDS = PHRASE.split(" ");

/** Types the phrase's word into every word box there is, by the position its label names. */
export function typeWords(screen: HTMLElement): void {
  for (const box of screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')) {
    const position = Number(box.getAttribute("aria-label")?.slice("Word ".length));
    type(box, WORDS[position - 1] ?? "");
  }
}

/** A screen that opens a wallet, by one of its ways in. */
export interface Opener {
  name: string;
  /** It opens the remembered wallet, with the key from the key store. */
  remembered: boolean;
  /** Renders the screen at its route and fills it in, ready for `press`. */
  render(): Promise<HTMLElement>;
  /** The button that opens the wallet. */
  press: string;
}

export const OPENERS: readonly Opener[] = [
  {
    name: "desktop Unlock",
    remembered: true,
    press: "Unlock",
    render: async () => mountAt("unlock", renderUnlock),
  },
  {
    name: "desktop Key, private key",
    remembered: false,
    press: "Open wallet",
    render: async () => {
      const screen = mountAt("key", renderKey);
      type(find(screen, "input[name=secret]"), "11".repeat(32));
      return screen;
    },
  },
  {
    name: "desktop Key, watch-only",
    remembered: false,
    press: "Follow this wallet",
    render: async () => {
      const screen = mountAt("key", renderKey);
      type(find(screen, "textarea[name=descriptor]"), "wpkh(tpubD6NzVbkrYhZ4X/0/*)");
      return screen;
    },
  },
  {
    name: "desktop Restore",
    remembered: false,
    press: "Restore wallet",
    render: async () => {
      const screen = mountAt("restore", renderRestore);
      typeWords(screen);
      // Leaving a box checks the phrase at once instead of after a pause in typing.
      find(screen, 'input[aria-label="Word 12"]').dispatchEvent(new Event("blur"));
      await settle();
      return screen;
    },
  },
  {
    name: "desktop Create",
    remembered: false,
    press: "Create wallet",
    render: async () => {
      const screen = await showAt("create", renderCreate);
      typeWords(screen);
      return screen;
    },
  },
  {
    name: "phone Unlock",
    remembered: true,
    press: "Unlock",
    render: async () => mountAt("unlock", renderPhoneUnlock),
  },
  {
    name: "phone Restore, recovery phrase",
    remembered: false,
    press: "Restore wallet",
    render: async () => {
      setRestoreMode("phrase");
      const screen = mountAt("restore", renderPhoneRestore);
      typeWords(screen);
      return screen;
    },
  },
  {
    name: "phone Restore, single key",
    remembered: false,
    press: "Open wallet",
    render: async () => {
      setRestoreMode("key");
      const screen = mountAt("restore", renderPhoneRestore);
      type(find(screen, "input[name=secret]"), "11".repeat(32));
      return screen;
    },
  },
  {
    name: "phone Restore, watch-only",
    remembered: false,
    press: "Follow this wallet",
    render: async () => {
      setRestoreMode("watch");
      const screen = mountAt("restore", renderPhoneRestore);
      type(find(screen, "textarea[name=descriptor]"), "wpkh(tpubD6NzVbkrYhZ4X/0/*)");
      return screen;
    },
  },
  {
    name: "phone Create",
    remembered: false,
    press: "Create wallet",
    render: async () => {
      const screen = await showAt("create", renderPhoneCreate);
      typeWords(screen);
      return screen;
    },
  },
];
