/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { wipeOnLeave } from "../src/ui/words";

const navigateTo = (hash: string): void => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

describe("wipeOnLeave", () => {
  // The defect this guards: a typed private key, passphrase or pasted
  // descriptor survived a route change because nothing zeroed it before the
  // node was detached — only removal from view, not from memory.
  it("clears every field's value on the next route change", () => {
    const key = document.createElement("input");
    const descriptor = document.createElement("textarea");
    key.value = "L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ";
    descriptor.value = "wpkh([fingerprint/84h/1h/0h]tpub…/0/*)";

    wipeOnLeave(() => [key, descriptor]);
    expect(key.value).not.toBe("");

    navigateTo("#/dashboard");
    expect(key.value).toBe("");
    expect(descriptor.value).toBe("");
  });

  it("runs the extra cleanup alongside the field wipe", () => {
    const input = document.createElement("input");
    input.value = "abandon abandon abandon";
    let detached = false;

    wipeOnLeave(
      () => [input],
      () => {
        detached = true;
      },
    );
    navigateTo("#/dashboard");

    expect(input.value).toBe("");
    expect(detached).toBe(true);
  });

  // `inputs` is a function, not a snapshot, so a screen that rebuilds its
  // grid (e.g. 12 words become 24) after arming this is still covered.
  it("reads the field list lazily, so a field added after arming is still wiped", () => {
    let fields: HTMLInputElement[] = [];
    wipeOnLeave(() => fields);

    const addedLater = document.createElement("input");
    addedLater.value = "typed after the wipe was armed";
    fields = [addedLater];

    navigateTo("#/dashboard");
    expect(addedLater.value).toBe("");
  });

  it("fires once and leaves later typing alone", () => {
    const input = document.createElement("input");
    wipeOnLeave(() => [input]);

    navigateTo("#/dashboard");
    input.value = "typed on the next screen";
    navigateTo("#/settings");

    expect(input.value).toBe("typed on the next screen");
  });
});
