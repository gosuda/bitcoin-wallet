import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { backendHost, errorMessage, NETWORK_LABELS } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, checkbox, el, field, sectionLabel, textInput, withBusy } from "../ui/dom";
import { wordCell, wordGrid, wordInput, wordText } from "../ui/words";
import { showKeyAdvanced } from "./key";

const KEYCHAIN_NAME = navigator.platform.startsWith("Mac") ? "macOS Keychain" : "OS keychain";

const WORD_COUNT = 12;

/** How many words the user has to type back before the wallet is created. */
const CONFIRM_BLANKS = 3;

/**
 * The generated phrase, alive only while this screen is. It is deliberately a
 * module-local: it never reaches `session`, the config store or IndexedDB, and
 * the cleanup below drops it as soon as the route changes.
 */
let phrase: string | null = null;

/**
 * Bumped on every render. A screen only clears `phrase` when it is still the
 * one that generated it, so navigating create → create cannot wipe the phrase
 * the new render just produced.
 */
let generation = 0;

/** Uniform integer in `[0, limit)` from the platform CSPRNG. */
function randomBelow(limit: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return Math.floor(((buf[0] ?? 0) / 2 ** 32) * limit);
}

/** `count` distinct 0-based positions out of `total`, in ascending order. */
function pickPositions(count: number, total: number): number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  const picked: number[] = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(...pool.splice(randomBelow(pool.length), 1));
  }
  return picked.sort((a, b) => a - b);
}

export function renderCreate(): HTMLElement {
  const cfg = session.config;
  if (!cfg) {
    navigate("setup");
    return el("main");
  }

  const mine = ++generation;
  phrase = null;
  window.addEventListener(
    "hashchange",
    () => {
      if (generation === mine) phrase = null;
    },
    { once: true },
  );

  const alert = banner();
  const phraseBox = el("div", {}, [el("p", { className: "empty", text: "Generating…" })]);
  const confirmBox = el("div", {}, [el("p", { className: "empty", text: "Generating…" })]);
  const remember = checkbox(
    "Remember on this device",
    `· stored in the ${KEYCHAIN_NAME}, unlocked with your login`,
    "remember",
  );

  // Optional and not shown again: the phrase above is only half the backup when
  // one is set, so the hint says what losing it costs. Left empty it means no
  // passphrase at all.
  const passphrase = textInput({
    type: "password",
    placeholder: "Leave empty for none",
    name: "passphrase",
  });
  // Secret, like the phrase itself: out of the DOM the moment the route changes.
  window.addEventListener(
    "hashchange",
    () => {
      passphrase.value = "";
    },
    { once: true },
  );

  const copyBtn = copyButton(() => phrase ?? "", "Copy", "sm");
  copyBtn.disabled = true;

  /** The generated words, and the positions blanked out in the confirm grid. */
  let words: string[] = [];
  let blanks: number[] = [];
  let answers: HTMLInputElement[] = [];

  const confirmed = (): boolean =>
    answers.length === blanks.length &&
    blanks.length > 0 &&
    blanks.every((position, i) => {
      const want = words[position];
      const answer = answers[i];
      return want !== undefined && answer?.value.trim().toLowerCase() === want;
    });

  const refresh = () => {
    createBtn.disabled = phrase === null || !confirmed();
  };

  const submit = async () => {
    alert.hide();
    const secret = phrase;
    if (!secret) {
      alert.show("error", "No recovery phrase yet — go back and try again.");
      return;
    }
    if (!confirmed()) {
      alert.show("error", "The words you typed do not match the phrase.");
      return;
    }
    try {
      const info = await api.openWallet(
        secret,
        cfg.address_type,
        remember.input.checked,
        passphrase.value || undefined,
      );
      phrase = null;
      passphrase.value = "";
      session.wallet = info;
      if (remember.input.checked) session.remembered = info;
      session.lastSyncedAt = null;
      navigate("dashboard");
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  };

  // `withBusy` restores the button it disabled, so the confirm gate is re-applied
  // once the attempt settles.
  const createBtn = button(
    "Create wallet",
    () => void withBusy(createBtn, submit).finally(refresh),
    "primary",
    "md",
    { name: "arrow", trailing: true },
  );
  createBtn.disabled = true;

  const showPhrase = (generatedWords: string) => {
    words = generatedWords.split(" ");
    blanks = pickPositions(CONFIRM_BLANKS, words.length);
    answers = [];
    phraseBox.replaceChildren(wordGrid(words.map((w, i) => wordCell(i + 1, wordText(w)))));
    confirmBox.replaceChildren(
      wordGrid(
        words.map((w, i) => {
          if (!blanks.includes(i)) return wordCell(i + 1, wordText(w));
          const input = wordInput(i + 1, true);
          input.addEventListener("input", refresh);
          answers.push(input);
          return wordCell(i + 1, input);
        }),
      ),
    );
    copyBtn.disabled = false;
    refresh();
  };

  // One phrase per visit. A late arrival for a screen the user already left is
  // dropped rather than stashed.
  void (async () => {
    try {
      const generated = await api.generateMnemonic(cfg.network, cfg.address_type, WORD_COUNT);
      if (generation !== mine) return;
      phrase = generated.words;
      showPhrase(generated.words);
    } catch (e) {
      if (generation !== mine) return;
      const failed = el("p", { className: "empty", text: "No recovery phrase was generated." });
      phraseBox.replaceChildren(failed.cloneNode(true));
      confirmBox.replaceChildren(failed);
      alert.show("error", errorMessage(e));
    }
  })();

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "New wallet" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card secret-box" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Recovery phrase — shown once"),
        el("span", {
          className: "secret-note",
          text: "Anyone with these words can spend your bitcoin.",
        }),
      ]),
      phraseBox,
      el("div", { className: "actions" }, [
        copyBtn,
        el("span", {
          className: "hint",
          text: "Write them down in order. This wallet cannot show them again.",
        }),
      ]),
    ]),
    el("section", { className: "card" }, [
      sectionLabel("Confirm your backup"),
      el("span", { className: "hint", text: "Fill in the missing words to continue." }),
      confirmBox,
      field(
        "Passphrase (optional)",
        passphrase,
        "A passphrase creates a different wallet from the same words. It is stored with them if you choose to remember this device. Write it down too — without it the words alone cannot recover this wallet.",
      ),
      remember.node,
    ]),
    el("div", { className: "actions actions-split" }, [
      button("Back", () => navigate("key"), "quiet"),
      el("div", { className: "actions" }, [
        button("Advanced: use a single key", () => {
          showKeyAdvanced();
          navigate("key");
        }),
        createBtn,
      ]),
    ]),
  ]);
}
