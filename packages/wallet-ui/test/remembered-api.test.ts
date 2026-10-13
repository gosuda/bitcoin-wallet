/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { platform, setPlatform } from "../src/platform";
import { session } from "../src/session";
import { fake } from "./fakes";
import { useScreenHarness } from "./harness";

useScreenHarness();

describe("atomic remembered-wallet platform lifecycle", () => {
  it("uses the atomic browser operation, never the split key and metadata writes", async () => {
    const save = vi.fn(async () => undefined);
    const forget = vi.fn(async () => undefined);
    const rememberSecret = vi.fn(async () => undefined);
    const setRemembered = vi.fn(async () => undefined);
    setPlatform({
      ...platform(),
      rememberedWalletStore: { save, forget },
      rememberSecret,
      setRemembered,
    });

    await api.openWallet(fake.PHRASE, "p2wpkh", true, undefined, "password");

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_id: fake.SAVED.wallet_id }),
      fake.PHRASE,
      undefined,
      "password",
    );
    expect(rememberSecret).not.toHaveBeenCalled();
    expect(setRemembered).not.toHaveBeenCalled();

    await api.forgetWallet();
    expect(forget).toHaveBeenCalledOnce();
    expect(session.wallet).toBeNull();
  });

  it("clears the browser keystore even when no pointer can be read", async () => {
    const forget = vi.fn(async () => undefined);
    setPlatform({
      ...platform(),
      rememberedWalletStore: { save: async () => undefined, forget },
      getRemembered: async () => null,
    });

    await api.forgetWallet();

    expect(forget).toHaveBeenCalledOnce();
  });

  it("does not let a delayed save recreate a forgotten wallet", async () => {
    let finish = (): void => undefined;
    const saving = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi.fn(async () => saving);
    const forget = vi.fn(async () => undefined);
    setPlatform({ ...platform(), rememberedWalletStore: { save, forget } });

    const opening = api.openWallet(fake.PHRASE, "p2wpkh", true, undefined, "password");
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

    const forgetting = api.forgetWallet();
    finish();

    await expect(opening).rejects.toMatchObject({ code: "superseded" });
    await forgetting;

    // A stale save cleans itself; the queued Forget clears everything again.
    expect(forget).toHaveBeenCalledTimes(2);
    expect(session.wallet).toBeNull();
  });
});
