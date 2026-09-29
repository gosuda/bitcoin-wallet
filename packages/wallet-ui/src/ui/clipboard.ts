import { platform } from "../platform";
import { button, setButtonLabel } from "./dom";

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
