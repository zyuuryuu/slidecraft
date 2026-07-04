/**
 * key-store.test.ts — the BYOK config store's routing (ADR-0016 F3). Verifies the security-
 * critical guarantee: when an OS keychain is available the config does NOT stay in localStorage;
 * with no keychain (browser / no backend) it falls back to localStorage; a legacy localStorage
 * blob is migrated up. invoke + runningInTauri + localStorage are mocked (node env).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../src/ipc/commands", () => ({ runningInTauri: vi.fn() }));

import { runningInTauri } from "../src/ipc/commands";
import { saveAiConfig, loadAiConfig, clearAiConfig, AI_CONFIG_STORAGE } from "../src/ipc/key-store";

const onDesktop = (yes: boolean) => vi.mocked(runningInTauri).mockReturnValue(yes);

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(runningInTauri).mockReset();
  const store = new Map<string, string>();
  // Minimal in-memory localStorage shim for the node test env.
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("key-store — desktop with a working keychain", () => {
  it("saves to the keychain and NOT to localStorage", async () => {
    onDesktop(true);
    invoke.mockResolvedValue(undefined); // secret_set ok
    await saveAiConfig('{"k":1}');
    expect(invoke).toHaveBeenCalledWith("secret_set", { account: "ai_config", value: '{"k":1}' });
    expect(localStorage.getItem(AI_CONFIG_STORAGE)).toBeNull(); // no plaintext copy left behind
  });

  it("loads from the keychain", async () => {
    onDesktop(true);
    invoke.mockResolvedValue('{"k":2}'); // secret_get returns the stored blob
    expect(await loadAiConfig()).toBe('{"k":2}');
    expect(invoke).toHaveBeenCalledWith("secret_get", { account: "ai_config" });
  });

  it("migrates a legacy localStorage blob up into the keychain, clearing localStorage", async () => {
    onDesktop(true);
    localStorage.setItem(AI_CONFIG_STORAGE, '{"legacy":true}');
    invoke.mockImplementation((cmd: string) => (cmd === "secret_get" ? Promise.resolve(null) : Promise.resolve(undefined)));
    expect(await loadAiConfig()).toBe('{"legacy":true}');
    expect(invoke).toHaveBeenCalledWith("secret_set", { account: "ai_config", value: '{"legacy":true}' });
    expect(localStorage.getItem(AI_CONFIG_STORAGE)).toBeNull(); // migrated → no longer in localStorage
  });
});

describe("key-store — no keychain backend (browser or unavailable)", () => {
  it("browser: uses localStorage, never invokes the keychain", async () => {
    onDesktop(false);
    await saveAiConfig('{"b":1}');
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_CONFIG_STORAGE)).toBe('{"b":1}');
    expect(await loadAiConfig()).toBe('{"b":1}');
  });

  it("desktop but keychain throws: falls back to localStorage", async () => {
    onDesktop(true);
    invoke.mockRejectedValue(new Error("no Secret Service"));
    await saveAiConfig('{"f":1}');
    expect(localStorage.getItem(AI_CONFIG_STORAGE)).toBe('{"f":1}'); // fell back, key still remembered
    expect(await loadAiConfig()).toBe('{"f":1}');
  });
});

describe("key-store — clear", () => {
  it("removes from both stores", async () => {
    onDesktop(true);
    localStorage.setItem(AI_CONFIG_STORAGE, "x");
    invoke.mockResolvedValue(undefined);
    await clearAiConfig();
    expect(localStorage.getItem(AI_CONFIG_STORAGE)).toBeNull();
    expect(invoke).toHaveBeenCalledWith("secret_delete", { account: "ai_config" });
  });
});
