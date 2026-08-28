import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
        await writeText(getText());
        setButtonLabel(btn, "Copied");
      } catch {
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
