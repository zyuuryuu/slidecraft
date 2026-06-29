/**
 * useCollab.ts — the P2.4 React binding for GUI-hosted collaboration. On 開始 it asks Rust to spawn
 * the collab sidecar (start_collab → {url,token}), connects a gui-role CollabProjection over the
 * Tauri plugin-http fetch, and mirrors the host's truth into the active deck via setDeck(next,
 * 'commit') on every change. It also SEEDS the current deck (so a connecting AI has something to
 * edit) and offers a self-contained "AI 編集をシミュレート" — a real second ai-role connection that
 * drives the same host path an upstream AI would, so "AI 編集 → GUI ライブ更新" is verifiable without
 * any external AI configured.
 *
 * Desktop-only: collaboration needs the spawned sidecar, so `available` is false in a plain browser.
 */
import { useCallback, useRef, useState } from "react";
import { runningInTauri } from "../ipc/commands";
import { CollabProjection, type CollabStatus, type DocSummary } from "../ipc/collab-projection";
import { CollabClient } from "../ipc/collab-client";
import { serializeMd } from "../engine/md-serializer";
import type { DeckIR } from "../engine/slide-schema";

const DEFAULT_TEMPLATE_URL = "/templates/slide/Midnight_Executive_30_TemplateOnly.pptx";

export interface CollabInfo {
  url: string;
  token: string;
  hostJsonPath?: string;
}

async function tauriHttpFetch(): Promise<typeof fetch> {
  const mod = await import("@tauri-apps/plugin-http");
  return mod.fetch as unknown as typeof fetch;
}

/** btoa can't take a huge spread; chunk the bytes so a few-hundred-KB template encodes safely. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export interface UseCollabArgs {
  /** Apply a host deck into the active document (App wires this to setDeck(deck, 'commit')). */
  applyDeck: (deck: DeckIR | null) => void;
  /** The current local deck — seeded to the host on 開始 so an AI has something to edit. */
  deck: DeckIR | null;
}

export function useCollab({ applyDeck, deck }: UseCollabArgs) {
  const available = runningInTauri();
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [info, setInfo] = useState<CollabInfo | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [docCount, setDocCount] = useState(0);
  const [simulating, setSimulating] = useState(false);

  // Refs so start/stop keep a stable identity yet always read the latest deck / apply fn.
  const projRef = useRef<CollabProjection | null>(null);
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const applyRef = useRef(applyDeck);
  applyRef.current = applyDeck;
  const simCounterRef = useRef(0);

  const start = useCallback(async () => {
    if (!available || projRef.current) return;
    setError(undefined);
    setStatus("connecting");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ci = await invoke<CollabInfo>("start_collab");
      setInfo(ci);
      const fetch = await tauriHttpFetch();
      const proj = new CollabProjection({
        url: ci.url,
        token: ci.token,
        fetch,
        // pollMs defaults on → the reliable floor if the SSE push stream doesn't deliver over plugin-http.
        onDeck: (p) => applyRef.current(p.deck),
        onStatus: (s, detail) => {
          setStatus(s);
          if (s === "error") setError(detail);
        },
        onDocs: (docs: DocSummary[]) => setDocCount(docs.length),
      });
      projRef.current = proj;
      await proj.start();
      // Best-effort: share the current deck so a connecting AI has something to edit. If there is no
      // deck or the seed fails, collaboration still works (the AI can open its own doc).
      const cur = deckRef.current;
      if (cur) {
        try {
          const res = await fetch(DEFAULT_TEMPLATE_URL);
          const templateBytes = new Uint8Array(await res.arrayBuffer());
          await proj.callTool("new_project", { templateBase64: bytesToBase64(templateBytes), markdown: serializeMd(cur) });
        } catch {
          /* seed is best-effort */
        }
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      try {
        await projRef.current?.stop();
      } catch {
        /* ignore */
      }
      projRef.current = null;
    }
  }, [available]);

  const stop = useCallback(async () => {
    const proj = projRef.current;
    projRef.current = null;
    try {
      await proj?.stop();
    } catch {
      /* ignore */
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_collab");
    } catch {
      /* ignore */
    }
    setStatus("idle");
    setInfo(undefined);
    setDocCount(0);
  }, []);

  // A REAL second (ai-role) connection: open a doc if none exists, then edit slide 0. Exercises the
  // exact host path an upstream AI drives, so the live-update loop is verifiable in one click.
  const simulateAiEdit = useCallback(async () => {
    const ci = info;
    if (!ci || simulating) return;
    setSimulating(true);
    let ai: CollabClient | undefined;
    try {
      const fetch = await tauriHttpFetch();
      ai = new CollabClient({ url: ci.url, token: ci.token, role: "ai", fetch });
      await ai.connect();
      const listed = await ai.callTool<{ documents: DocSummary[] }>("list_documents");
      let docId = listed.documents[0]?.docId;
      if (!docId) {
        const res = await fetch(DEFAULT_TEMPLATE_URL);
        const templateBytes = new Uint8Array(await res.arrayBuffer());
        const made = await ai.callTool<{ docId: string }>("new_project", {
          templateBase64: bytesToBase64(templateBytes),
          markdown: "# AI が作成したスライド\n\n- 1 つ目\n\n---\n\n# 2 枚目\n\n- a\n- b",
        });
        docId = made.docId;
      }
      const n = ++simCounterRef.current;
      await ai.callTool("set_slide_markdown", {
        index: 0,
        markdown: `# AI 編集 #${n}\n\n- ライブ更新の確認 (${n})\n- これが GUI に即反映されれば成功`,
        docId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await ai?.close();
      } catch {
        /* ignore */
      }
      setSimulating(false);
    }
  }, [info, simulating]);

  return {
    available,
    status,
    url: info?.url,
    token: info?.token,
    hostJsonPath: info?.hostJsonPath,
    error,
    docCount,
    simulating,
    start,
    stop,
    simulateAiEdit,
  };
}
