import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { button } from "./dom";

/** Small "Copy" button that briefly confirms success. */
export function copyButton(getText: () => string, label = "Copy"): HTMLButtonElement {
  const btn = button(
    label,
    async () => {
      try {
        await writeText(getText());
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Failed";
      }
      window.setTimeout(() => {
        btn.textContent = label;
      }, 1200);
    },
    "default",
    "sm",
  );
  return btn;
}
