import { api } from "../../api";
import { navigate } from "../../router";
import { redirect, routeGuard } from "../../screen";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, sectionLabel, textInput } from "../../ui/dom";
import { rememberCheckbox } from "../../ui/remember";
import { MISSING_WORDS, PASSPHRASE_HINT, WORDS_KEEP, WORDS_SPEND } from "../../ui/text";
import { wipeOnLeave, wordCell, wordGrid, wordInput, wordText } from "../../ui/words";
import { body, button, card, header, historyReset, labelled, lede, spacer, withBusy } from "../ui";

/** How many words the user has to type back before the wallet is created. */
const CHECKS = 3;

/** CSPRNG, not Math.random: the check should not be predictable from the page. */
function pickPositions(total: number, count: number): number[] {
  const chosen = new Set<number>();
  const buf = new Uint32Array(1);
  while (chosen.size < count) {
    crypto.getRandomValues(buf);
    chosen.add((buf[0] ?? 0) % total);
  }
  return [...chosen].sort((a, b) => a - b);
}

export function renderCreate(): HTMLElement {
  // `routeGuard`, not `screenGuard`: creating the wallet sets `session.wallet`,
  // and an error after that, such as the key store refusing the key, must
  // still be shown here.
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const cfg = session.config;
  if (!cfg) return redirect("setup");
  const host = el("main");

  // Named as the desktop names it, after the button that leads here.
  host.appendChild(header("New wallet", { back: "key" }));
  const content = body(alert.node, lede("Generating…"));
  host.appendChild(content);

  void (async () => {
    // Generation is async and the user can leave before it lands; painting a
    // recovery phrase into a screen that is gone leaves it in a detached DOM.
    try {
      const generated = await api.generateMnemonic(cfg.network, cfg.address_type, 12);
      if (!onScreen()) return;
      const words = generated.words.split(" ");
      const blanks = pickPositions(words.length, CHECKS);
      const answers = new Map<number, HTMLInputElement>();

      const shown = wordGrid(words.map((w, i) => wordCell(i + 1, wordText(w))));
      const confirm = wordGrid(
        words.map((w, i) => {
          if (!blanks.includes(i)) return wordCell(i + 1, wordText(w));
          const input = wordInput(i + 1, true);
          input.setAttribute("autocapitalize", "none");
          input.setAttribute("autocorrect", "off");
          input.addEventListener("input", refresh);
          answers.set(i, input);
          return wordCell(i + 1, input);
        }),
      );

      const remember = rememberCheckbox();
      const passphrase = textInput({
        type: "password",
        placeholder: "Leave empty for none",
        name: "passphrase",
      });

      const createWallet = async (reset = false): Promise<void> => {
        alert.hide();
        try {
          const open = reset ? api.resetHistoryAndOpen : api.openWallet;
          await open(
            generated.words,
            cfg.address_type,
            remember.checked(),
            passphrase.value || undefined,
          );
          session.remembered = await api.getRemembered();
          if (onScreen()) navigate("dashboard");
        } catch (e) {
          if (onScreen()) offer.report(e, () => createWallet(true));
        }
      };
      const create = button("Create wallet", () => withBusy(create, createWallet), {
        variant: "primary",
        block: true,
        disabled: true,
      });

      function refresh(): void {
        const ok = [...answers.entries()].every(
          ([i, input]) => input.value.trim().toLowerCase() === words[i],
        );
        create.disabled = !ok;
      }

      content.replaceChildren(
        alert.node,
        card(
          sectionLabel("Recovery phrase — shown once"),
          lede(`${WORDS_SPEND} ${WORDS_KEEP}`),
          shown,
          copyButton(() => generated.words),
        ),
        card(sectionLabel("Confirm your backup"), lede(MISSING_WORDS), confirm),
        card(
          labelled("Passphrase", passphrase, "(optional)"),
          passphrase,
          lede(PASSPHRASE_HINT),
          remember.node,
        ),
        spacer(),
        offer.node,
        create,
      );

      // The phrase, the passphrase and every confirm-grid word the user
      // typed back are secret; zero each one before detaching the subtree
      // that held them, rather than trust nothing still references it.
      wipeOnLeave(
        () => [passphrase, ...answers.values()],
        () => content.replaceChildren(),
      );
    } catch (e) {
      // Same reason as the success path: a rejection after the user has left
      // would put an error into a screen nobody is looking at.
      if (!onScreen()) return;
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
