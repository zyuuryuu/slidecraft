/**
 * client-grants-store.ts — #727 (ADR-0040 D3-4): the AI clients the human allowed — each pair (clientInfo
 * name+version, client id) with its per-pair secret — kept at rest like the BYOK key (ADR-0016 F3): the OS
 * keychain on desktop, localStorage only where no keychain backend exists (then the same OS user can read it;
 * a hijacked webview could do anything with the GUI token anyway, so nothing new is exposed). The GUI hands the
 * list to the host over its own port at every connect (load_client_grants) — never via argv (D3-8).
 */
import type { StoredGrant } from "../mcp/host-approval";
import { secretBlobStore } from "./key-store";

export const CLIENT_GRANTS_STORAGE = "slidecraft_collab_client_grants";
const store = secretBlobStore("collab_client_grants", CLIENT_GRANTS_STORAGE);

type Pair = Pick<StoredGrant, "name" | "version" | "clientId">;
const samePair = (a: Pair, b: Pair): boolean => a.name === b.name && a.version === b.version && a.clientId === b.clientId;
const isGrant = (v: unknown): v is StoredGrant => {
  const g = v as Partial<StoredGrant> | null;
  return !!g && typeof g.name === "string" && typeof g.version === "string" && typeof g.clientId === "string" && typeof g.secret === "string";
};

/** The stored grants; a missing or corrupt blob reads as none (the client is simply asked again). */
export async function loadClientGrants(): Promise<StoredGrant[]> {
  const raw = await store.load();
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isGrant) : [];
  } catch {
    return [];
  }
}

/** Add (or replace — one entry per pair) a grant the human just allowed. */
export async function addClientGrant(g: StoredGrant): Promise<void> {
  const rest = (await loadClientGrants()).filter((x) => !samePair(x, g));
  await store.save(JSON.stringify([...rest, g]));
}

/** Forget a revoked pair. */
export async function removeClientGrant(p: Pair): Promise<void> {
  await store.save(JSON.stringify((await loadClientGrants()).filter((x) => !samePair(x, p))));
}
