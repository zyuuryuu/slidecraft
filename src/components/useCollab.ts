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
import type { MasterEntry } from "./useMasterRegistry";

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
  /** The master registry (useMasterRegistry) — uploaded to the host on 開始 (register_templates) so a
   *  connecting AI can list_templates / use_template. The bytes stay host-side; the AI selects by id. */
  masters: MasterEntry[];
  getMasterBytes: (id: string) => Promise<Uint8Array>;
  /** The SEEDED doc's host id (from open_project). App links the tab that was active on 開始 to it, so
   *  switching back to that tab re-targets the projection at the seed. */
  onSeedDoc?: (docId: string) => void;
  /** A NEW host doc appeared (the AI ran new_project). App opens it as a BACKGROUND tab — mode (b):
   *  a tab shows up but the view doesn't switch. `dataBase64` is the full .slidecraft (deck+template). */
  onNewHostDoc?: (docId: string, title: string, dataBase64: string) => void;
}

export function useCollab({ applyDeck, deck, templateData, templateName, masters, getMasterBytes, onSeedDoc, onNewHostDoc }: UseCollabArgs) {
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
  const mastersRef = useRef(masters);
  const getBytesRef = useRef(getMasterBytes);
  const onSeedDocRef = useRef(onSeedDoc);
  const onNewHostDocRef = useRef(onNewHostDoc);
  // Collab multi-doc bookkeeping: which host docs we've already surfaced as tabs, the seeded doc, and
  // whether the seed is resolved (until then we don't classify docs — avoids a duplicate seed tab).
  const knownDocsRef = useRef<Set<string>>(new Set());
  const seedDocIdRef = useRef<string | undefined>(undefined);
  const seedReadyRef = useRef(false);
  // Sync the latest values into the refs from an EFFECT (not during render → satisfies
  // react-hooks/refs). start()/seed/onDeck all run after commit, so an effect is timely enough.
  useEffect(() => {
    deckRef.current = deck;
    templateRef.current = templateData;
    nameRef.current = templateName;
    applyRef.current = applyDeck;
    mastersRef.current = masters;
    getBytesRef.current = getMasterBytes;
    onSeedDocRef.current = onSeedDoc;
    onNewHostDocRef.current = onNewHostDoc;
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
        onDocs: (docs: DocSummary[]) => {
          setDocCount(docs.length);
          // Surface AI-created docs as tabs (mode b: background — no view switch). Wait until the
          // seed is resolved so the seeded doc isn't mistaken for a new one. Mark known BEFORE the
          // async save_project so a burst of onDocs doesn't open the same doc twice.
          if (!seedReadyRef.current) return;
          for (const d of docs) {
            if (d.docId === seedDocIdRef.current || knownDocsRef.current.has(d.docId)) continue;
            knownDocsRef.current.add(d.docId);
            projRef.current
              ?.callTool<{ dataBase64: string }>("save_project", { docId: d.docId })
              .then((r) => onNewHostDocRef.current?.(d.docId, d.title, r.dataBase64))
              .catch(() => {
                /* best-effort: the doc still exists host-side; a later reconnect can pick it up */
              });
          }
        },
      });
      projRef.current = proj;
      await proj.start();
      // Best-effort: UPLOAD the master registry so a connecting AI can list_templates / use_template.
      // The bytes live host-side (Node sidecar has no Tauri fs); the AI selects by id. Full-replace, so
      // this connect-time push is the truth for the session (re-import while connected = a follow-up).
      try {
        const items = (
          await Promise.all(
            mastersRef.current.map(async (m) => {
              // Guard each master's fetch per-item (matches App.tsx handleSelectMaster) so ONE bad
              // master (e.g. a transient builtin fetch failure) drops only itself, not the whole set —
              // register_templates is full-replace, so a rejected Promise.all would empty the AI picker.
              const bytes = await getBytesRef.current(m.id).catch(() => null);
              return bytes ? { id: m.id, name: m.name, builtin: m.builtin, bytesBase64: bytesToBase64(bytes) } : null;
            }),
          )
        ).filter((x): x is NonNullable<typeof x> => x !== null);
        if (items.length) await proj.callTool("register_templates", { templates: items });
      } catch {
        /* template upload is best-effort — collaboration still works without it */
      }
      // Best-effort: SHARE the current deck as exact .slidecraft bytes (no markdown round-trip → no
      // title-slide mangling) so a connecting AI has something to edit. The projection mirrors it
      // back as the INITIAL ('silent') apply = no visible change / no undo step. If there's no deck/
      // template or the seed fails, collaboration still works (the AI can open its own doc).
      const curDeck = deckRef.current;
      const curTemplate = templateRef.current;
      if (curDeck && curTemplate) {
        try {
          const bytes = await bundleProject(curDeck, curTemplate, { templateName: nameRef.current, savedAt: new Date().toISOString() });
          const r = await proj.callTool<{ docId?: string }>("open_project", { dataBase64: bytesToBase64(bytes) });
          // Link the tab that was active on 開始 to the seed's host doc, so switching back to it
          // re-targets the projection here (rather than stranding it on an AI doc).
          if (r?.docId) {
            seedDocIdRef.current = r.docId;
            onSeedDocRef.current?.(r.docId);
          }
        } catch {
          /* seed is best-effort */
        }
      }
      seedReadyRef.current = true; // seed resolved (or none) → onDocs may now surface AI docs as tabs
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
    knownDocsRef.current.clear();
    seedDocIdRef.current = undefined;
    seedReadyRef.current = false;
  }, []);

  // P2.5 round-trip: per-slide human edits + Undo/Redo go through the projection to the host (the
  // single truth). Stable identities (projRef is read at call time); no-op shape when disconnected.
  const sendSlideMarkdown = useCallback(
    (index: number, markdown: string) => projRef.current?.sendSlideMarkdown(index, markdown) ?? Promise.resolve({ ok: false as const, message: "未接続" }),
    [],
  );
  const serverUndo = useCallback(() => projRef.current?.serverUndo() ?? Promise.resolve({ ok: false as const, reason: "未接続" }), []);
  const serverRedo = useCallback(() => projRef.current?.serverRedo() ?? Promise.resolve({ ok: false as const, reason: "未接続" }), []);
  // Point the projection's mirror at a specific host doc — called when the user switches tabs so the
  // GUI live-mirrors THAT doc. `null` = the active tab is local (no host doc) → the projection pauses
  // (never clobbers the local tab). No-op when disconnected (projRef is null).
  const setActiveHostDoc = useCallback((docId: string | null) => projRef.current?.setTargetDoc(docId), []);

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
    setActiveHostDoc,
  };
}
