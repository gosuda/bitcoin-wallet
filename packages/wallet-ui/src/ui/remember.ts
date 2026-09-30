import { platform } from "../platform";
import { checkbox, el, textInput } from "./dom";
import { icon } from "./icons";
import { wipeOnLeave } from "./words";

/** What this platform calls the thing a remembered key is kept in. */
function keychainName(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android Keystore";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS Keychain";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS Keychain";
  if (/Windows/.test(ua)) return "Windows Credential Manager";
  return "OS keychain";
}

/** The OS keystore's name. The browser keeps no key there, and says so in its own words. */
export const KEYCHAIN_NAME = keychainName();

/** Where a remembered key is kept, as Settings puts it after "Yes · ". */
export function rememberedWhere(): string {
  return platform().needsAppPassword
    ? "in this browser, encrypted with your app password"
    : `in the ${KEYCHAIN_NAME}`;
}

/**
 * Copy for shells that cannot keep a key past the session.
 *
 * Two different situations end up here: a browser page served from anywhere
 * but https or localhost, which has no WebCrypto to seal a key with, and a
 * native build whose key store exists but is unusable — an unsigned iOS build,
 * where the keychain needs an entitlement it lacks.
 */
export const NO_KEYSTORE_HINT =
  "No key store is available here; the key is kept for this session only.";

/** The canvas's words (2f), under the two app password fields. */
const APP_PASSWORD_WARNING =
  "Anyone with this browser's files and this password can spend. It cannot be recovered.";
/** Not on the canvas, which draws the two fields matching. */
const MISMATCH = "The passwords do not match.";

export interface AppPasswordField {
  /** The labelled field: its input, the eye that shows it, and a line for an error. */
  readonly node: HTMLElement;
  readonly input: HTMLInputElement;
  /** Says `message` under the field and marks the input invalid; `null` clears both. */
  setError(message: string | null): void;
}

/**
 * A field for the app password, which locks a key remembered in the browser.
 * It is not the BIP39 passphrase, hence the name. Masked until its eye is
 * pressed, and cleared the moment the route changes: it is as secret as the
 * key it opens, and is kept nowhere but here.
 */
export function appPasswordField(label: string, name: string): AppPasswordField {
  const input = textInput({ type: "password", name });
  input.id = `f-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const error = el("p", {
    className: "field-error",
    attrs: { id: `${input.id}-error`, role: "status" },
  });
  input.setAttribute("aria-describedby", error.id);

  // One name for both states, as a toggle has; `aria-pressed` says which.
  const eye = el(
    "button",
    {
      className: "password-eye",
      attrs: {
        type: "button",
        "aria-label": "Show password",
        title: "Show password",
        "aria-pressed": "false",
      },
    },
    [icon("eye", 16)],
  );
  eye.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-pressed", String(show));
  });
  wipeOnLeave(() => [input]);

  const text = el("label", { className: "field-label", text: label });
  text.htmlFor = input.id;
  return {
    node: el("div", { className: "field" }, [
      text,
      el("div", { className: "password-box" }, [input, eye]),
      error,
    ]),
    input,
    setError(message) {
      error.textContent = message ?? "";
      input.classList.toggle("input-invalid", message !== null);
      if (message === null) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", "true");
    },
  };
}

export interface RememberControl {
  /**
   * The checkbox, with the app password fields under it where the key store
   * takes one, or an empty node where the shell has no key store.
   */
  readonly node: HTMLElement;
  /** Whether the user asked to remember. Always false without a key store. */
  checked(): boolean;
  /**
   * False only while a ticked box waits on its app password, missing or not
   * yet confirmed: the screen's open button stays off until then.
   */
  ready(): boolean;
  /** The confirmed app password to seal the key under; none when not remembering, or not asked for. */
  appPassword(): string | undefined;
}

/**
 * "Remember on this device", offered only where a key store exists.
 *
 * Where it does not, the control renders nothing rather than a box that would
 * be silently ignored — `checked()` is then false and no key is ever saved.
 * Where the key store takes an app password (the browser), ticking the box
 * reveals the password twice; `onChange` hears every change to either, so the
 * screen can gate its button on `ready()`.
 */
export function rememberCheckbox(onChange?: () => void): RememberControl {
  if (!platform().canRememberWallet) {
    return {
      node: el("div", { className: "hidden" }),
      checked: () => false,
      ready: () => true,
      appPassword: () => undefined,
    };
  }
  if (platform().needsAppPassword) return appPasswordRemember(onChange);
  const box = checkbox(
    "Remember on this device",
    `· stored in the ${KEYCHAIN_NAME}, unlocked with your login`,
    "remember",
  );
  return {
    node: box.node,
    checked: () => box.input.checked,
    ready: () => true,
    appPassword: () => undefined,
  };
}

/** The browser's box (2f): the app password and its confirmation hang under it once ticked. */
function appPasswordRemember(onChange?: () => void): RememberControl {
  const box = checkbox(
    "Remember on this device",
    "· encrypted with an app password and kept in this browser",
    "remember",
  );
  const password = appPasswordField("App password", "app_password");
  const confirm = appPasswordField("Confirm app password", "app_password_confirm");
  const panel = el("div", { className: "remember-password" }, [
    el("div", { className: "remember-password-pair" }, [password.node, confirm.node]),
    el("p", { className: "remember-warning", text: APP_PASSWORD_WARNING }),
  ]);
  panel.hidden = true;

  const confirmed = (): boolean =>
    password.input.value !== "" && confirm.input.value === password.input.value;
  const update = () => {
    panel.hidden = !box.input.checked;
    // A confirmation still being typed is not wrong yet: only one that has
    // gone off the password says so.
    const typed = confirm.input.value;
    confirm.setError(typed !== "" && !password.input.value.startsWith(typed) ? MISMATCH : null);
    onChange?.();
  };
  box.input.addEventListener("change", update);
  password.input.addEventListener("input", update);
  confirm.input.addEventListener("input", update);

  return {
    node: el("div", { className: "remember" }, [box.node, panel]),
    checked: () => box.input.checked,
    ready: () => !box.input.checked || confirmed(),
    appPassword: () => (box.input.checked && confirmed() ? password.input.value : undefined),
  };
}
