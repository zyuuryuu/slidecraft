/**
 * docs.ts — Help/? → docs site (issue #114). Dual-mode IPC (ADR-0001): desktop opens the docs
 * site via the Tauri opener plugin, scoped to the docs host only in capabilities/default.json
 * (ADR-0010 — no broad external-URL grant). Browser/dev falls back to window.open.
 *
 * Never-silent: a blocked popup or a rejected opener call still resolves with the docs URL
 * (opened: false) instead of throwing, so the caller can show it to the user rather than
 * failing quietly.
 */
import { runningInTauri } from "./commands";

export const DOCS_URL = "https://zyuuryuu.github.io/slidecraft/";

export interface OpenDocsResult {
  opened: boolean;
  url: string;
}

/** Open the docs site. Always resolves — never throws — so callers can never-silent fallback. */
export async function openDocs(): Promise<OpenDocsResult> {
  if (runningInTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(DOCS_URL);
      return { opened: true, url: DOCS_URL };
    } catch {
      return { opened: false, url: DOCS_URL };
    }
  }
  if (typeof window !== "undefined" && typeof window.open === "function") {
    const w = window.open(DOCS_URL, "_blank", "noopener,noreferrer");
    if (w) return { opened: true, url: DOCS_URL };
  }
  return { opened: false, url: DOCS_URL };
}
