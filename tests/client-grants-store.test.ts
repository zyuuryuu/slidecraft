/**
 * client-grants-store.test.ts — #727 (ADR-0040 D3-4): the AI clients the human allowed (pair + per-pair secret)
 * are kept like the BYOK key (ADR-0016 F3): OS keychain on desktop, localStorage only where no keychain exists.
 * Same routing as key-store.ts (one implementation — R8); invoke / runningInTauri / localStorage are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../src/ipc/commands", () => ({ runningInTauri: vi.fn() }));

import { runningInTauri } from "../src/ipc/commands";
import { loadClientGrants, addClientGrant, removeClientGrant, CLIENT_GRANTS_STORAGE } from "../src/ipc/client-grants-store";

const g1 = { name: "Claude Desktop", version: "1", clientId: "cid-aaaaaaaa", secret: "s1" };
const g2 = { name: "Claude Code", version: "2", clientId: "cid-bbbbbbbb", secret: "s2" };

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(runningInTauri).mockReset();
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("client grants — desktop keychain", () => {
  it("adds into the keychain (account collab_client_grants) and never into localStorage", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    let kept: string | null = null;
    invoke.mockImplementation(async (cmd: string, a: { value?: string }) => {
      if (cmd === "secret_get") return kept;
      if (cmd === "secret_set") kept = a.value ?? null;
      return undefined;
    });
    await addClientGrant(g1);
    await addClientGrant(g2);
    expect(invoke).toHaveBeenCalledWith("secret_set", expect.objectContaining({ account: "collab_client_grants" }));
    expect(await loadClientGrants()).toEqual([g1, g2]);
    expect(localStorage.getItem(CLIENT_GRANTS_STORAGE)).toBeNull();
  });

  it("re-allowing the same pair replaces its secret (one entry per pair)", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    let kept: string | null = null;
    invoke.mockImplementation(async (cmd: string, a: { value?: string }) => (cmd === "secret_get" ? kept : cmd === "secret_set" ? void (kept = a.value ?? null) : undefined));
    await addClientGrant(g1);
    await addClientGrant({ ...g1, secret: "s1-new" });
    expect(await loadClientGrants()).toEqual([{ ...g1, secret: "s1-new" }]);
  });

  it("removes exactly the revoked pair", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    let kept: string | null = null;
    invoke.mockImplementation(async (cmd: string, a: { value?: string }) => (cmd === "secret_get" ? kept : cmd === "secret_set" ? void (kept = a.value ?? null) : undefined));
    await addClientGrant(g1);
    await addClientGrant(g2);
    await removeClientGrant({ name: g1.name, version: g1.version, clientId: g1.clientId });
    expect(await loadClientGrants()).toEqual([g2]);
  });
});

describe("client grants — no keychain", () => {
  it("falls back to localStorage (ADR-0016 F3 / ADR-0040 D3-4)", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    invoke.mockRejectedValue(new Error("no secret service"));
    await addClientGrant(g1);
    expect(JSON.parse(localStorage.getItem(CLIENT_GRANTS_STORAGE)!)).toEqual([g1]);
    expect(await loadClientGrants()).toEqual([g1]);
  });

  it("a corrupt blob reads as no grants (asks again) instead of throwing", async () => {
    vi.mocked(runningInTauri).mockReturnValue(false);
    localStorage.setItem(CLIENT_GRANTS_STORAGE, "{not json");
    expect(await loadClientGrants()).toEqual([]);
    localStorage.setItem(CLIENT_GRANTS_STORAGE, JSON.stringify([{ name: "x" }, g1]));
    expect(await loadClientGrants()).toEqual([g1]); // malformed rows are dropped, valid ones kept
  });
});
