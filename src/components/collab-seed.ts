/**
 * collab-seed.ts — what the GUI loads onto the collab host so an AI has something to work with: the master
 * registry (register_templates — the AI picks by id, bytes stay host-side) and the current deck as exact .scft
 * bytes (open_project — no lossy markdown round-trip). #727 (ADR-0040 D1): this now runs when an ALLOWED AI makes
 * its first call (the host's aiActive), not when the host starts; the host holds that call until the GUI reports
 * the outcome (report_seed done / failed → never an empty host, never silent).
 */
import { bundleProject } from "../engine/project-io";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import type { MasterEntry } from "./useMasterRegistry";

/** btoa can't take a huge spread; chunk the bytes so a few-hundred-KB template encodes safely. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export interface SeedInput {
  callTool: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>;
  masters: MasterEntry[];
  getMasterBytes: (id: string) => Promise<Uint8Array>;
  deck: DeckIR | null;
  template: TemplateData | null;
  templateName: string;
}

/** Upload templates (best-effort, per master) then the deck. `docId` = the seeded host doc; `error` = the deck
 *  could not be loaded (the host passes calls through with a note). No deck/template = nothing to seed (ok). */
export async function seedHost(i: SeedInput): Promise<{ docId?: string; error?: string }> {
  try {
    const items = (
      await Promise.all(
        i.masters.map(async (m) => {
          // ONE bad master drops only itself (register_templates is full-replace: a rejected Promise.all would
          // empty the AI picker) — matches App.tsx handleSelectMaster.
          const bytes = await i.getMasterBytes(m.id).catch(() => null);
          return bytes ? { id: m.id, name: m.name, builtin: m.builtin, bytesBase64: bytesToBase64(bytes) } : null;
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length) await i.callTool("register_templates", { templates: items });
  } catch {
    /* template upload is best-effort — collaboration still works without it */
  }
  if (!i.deck || !i.template) return {};
  try {
    const bytes = await bundleProject(i.deck, i.template, { templateName: i.templateName, savedAt: new Date().toISOString() });
    const r = await i.callTool<{ docId?: string; ok?: boolean; error?: string }>("open_project", { dataBase64: bytesToBase64(bytes) });
    return r?.docId ? { docId: r.docId } : { error: r?.error ?? "open_project returned no docId" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
