import { platform } from "../platform";
import { button, setButtonLabel } from "./dom";

/** What a Paste button read: the clipboard's text, or whether access was refused. */
export type ClipboardRead = { text: string } | { refused: boolean };

/**
 * The clipboard's text, for a Paste button. It fails two ways: access
 * refused, which the user can change, and a build or browser that cannot
 * read it at all, where pasting into the field by hand still works.
 */
export async function readClipboard(): Promise<ClipboardRead> {
  try {
    return { text: await navigator.clipboard.readText() };
  } catch (e) {
    console.error("could not read the clipboard:", e);
    return { refused: e instanceof DOMException && e.name === "NotAllowedError" };
  }
}

/** "Copy" button with a copy icon that briefly confirms success. */
export function copyButton(
  getText: () => string,
  label = "Copy",
  size: "md" | "sm" = "md",
): HTMLButtonElement {
  const btn = button(
    label,
    async () => {
      try {
        await platform().writeClipboard(getText());
        setButtonLabel(btn, "Copied");
      } catch (e) {
        // The label says it failed; the log says why.
        console.error("could not write the clipboard:", e);
        setButtonLabel(btn, "Failed");
      }
      window.setTimeout(() => {
        setButtonLabel(btn, label);
      }, 1200);
    },
    "default",
    size,
    { name: "copy" },
  );
  return btn;
}
