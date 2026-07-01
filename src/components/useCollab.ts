/**
 * useCollab.ts — the P2.4 React binding for GUI-hosted collaboration. On 開始 it asks Rust to spawn
 * the collab sidecar (start_collab → {url,token}), connects a gui-role CollabProjection over the
 * Tauri plugin-http fetch, and mirrors the host's truth into the active deck via setDeck(next,
 * 'commit') on every change. It also SEEDS the current deck (as exact .slidecraft bytes) so a
 * connecting AI has something to edit without a lossy markdown round-trip.
 *
 * Desktop-only: collaboration needs the spawned sidecar, so `available` is false in a plain browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runningInTauri } from "../ipc/commands";
import { CollabProjection, type CollabStatus, type DocSummary } from "../ipc/collab-projection";
import { bundleProject } from "../engine/project-io";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";

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
  /** Apply a host deck into the active document. App wires this to setDeck(deck, isInitial ?
   *  'silent' : 'commit') — a freshly-adopted/seeded doc replaces the view WITHOUT an undo step;
   *  subsequent AI edits are undoable. */
  applyDeck: (deck: DeckIR | null, isInitial: boolean) => void;
  /** The current local deck + its template — seeded (as exact .slidecraft bytes) to the host on
   *  開始 so an AI has something to edit, without a lossy markdown round-trip. */
  deck: DeckIR | null;
  templateData: TemplateData | null;
  templateName: string;
}

export function useCollab({ applyDeck, deck, templateData, templateName }: UseCollabArgs) {
  const available = runningInTauri();
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [info, setInfo] = useState<CollabInfo | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [docCount, setDocCount] = useState(0);

  // Refs so start/stop keep a stable identity yet always read the latest deck / template / apply fn.
  const projRef = useRef<CollabProjection | null>(null);
  const deckRef = useRef(deck);
  const templateRef = useRef(templateData);
  const nameRef = useRef(templateName);
  const applyRef = useRef(applyDeck);
  // Sync the latest values into the refs from an EFFECT (not during render → satisfies
  // react-hooks/refs). start()/seed/onDeck all run after commit, so an effect is timely enough.
  useEffect(() => {
    deckRef.current = deck;
    templateRef.current = templateData;
    nameRef.current = templateName;
    applyRef.current = applyDeck;
  });

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
        onDeck: (p) => applyRef.current(p.deck, p.isInitial),
        onStatus: (s, detail) => {
          setStatus(s);
          if (s === "error") {
            setError(detail);
            projRef.current = null; // the projection tore itself down → 開始 can re-establish
          }
        },
        onDocs: (docs: DocSummary[]) => setDocCount(docs.length),
      });
      projRef.current = proj;
      await proj.start();
      // Best-effort: SHARE the current deck as exact .slidecraft bytes (no markdown round-trip → no
      // title-slide mangling) so a connecting AI has something to edit. The projection mirrors it
      // back as the INITIAL ('silent') apply = no visible change / no undo step. If there's no deck/
      // template or the seed fails, collaboration still works (the AI can open its own doc).
      const curDeck = deckRef.current;
      const curTemplate = templateRef.current;
      if (curDeck && curTemplate) {
        try {
          const bytes = await bundleProject(curDeck, curTemplate, { templateName: nameRef.current, savedAt: new Date().toISOString() });
          await proj.callTool("open_project", { dataBase64: bytesToBase64(bytes) });
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

  // P2.5 round-trip: per-slide human edits + Undo/Redo go through the projection to the host (the
  // single truth). Stable identities (projRef is read at call time); no-op shape when disconnected.
  const sendSlideMarkdown = useCallback(
    (index: number, markdown: string) => projRef.current?.sendSlideMarkdown(index, markdown) ?? Promise.resolve({ ok: false as const, message: "未接続" }),
    [],
  );
  const serverUndo = useCallback(() => projRef.current?.serverUndo() ?? Promise.resolve({ ok: false as const, reason: "未接続" }), []);
  const serverRedo = useCallback(() => projRef.current?.serverRedo() ?? Promise.resolve({ ok: false as const, reason: "未接続" }), []);

  // Tear down the projection (poll interval + MCP client) on unmount / Vite HMR so dev reloads don't
  // accumulate zombie pollers. (Production App never unmounts; this is dev-loop hygiene.)
  useEffect(() => () => {
    void projRef.current?.stop();
    projRef.current = null;
  }, []);

  return {
    available,
    status,
    url: info?.url,
    token: info?.token,
    hostJsonPath: info?.hostJsonPath,
    error,
    docCount,
    start,
    stop,
    sendSlideMarkdown,
    serverUndo,
    serverRedo,
  };
}
