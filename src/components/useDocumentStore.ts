/**
 * useDocumentStore — the multi-document State core (P0 of the AI-integration arch).
 *
 * Holds a COLLECTION of documents (`docs[]` + `activeId`) instead of one in-memory
 * deck. Each document owns its full per-doc state INCLUDING its own undo/redo history,
 * so opening a second project no longer destroys the first and undo no longer bleeds
 * across documents. useDeckController binds to the ACTIVE document and re-exposes the
 * exact same flat API it always had — downstream UI is untouched (deck = the single
 * source of truth for the active document).
 *
 * Undo semantics are NOT duplicated: each doc's history runs through historyReducer
 * (the same pure reducer that powers useHistoryState).
 *
 * Pure-ish: the reducer (documentReducer) is pure and unit-tested directly; the hook is
 * the thin React binding. No DOM/Tauri here.
 */
import { useReducer, useCallback, useMemo } from "react";
import {
  historyReducer,
  type HState,
  type HAction,
  type HistoryMode,
} from "./useHistoryState";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";

export type MarkdownSubMode = "import" | "edit";

const COALESCE_MS = 600; // match useHistoryState's default typing-coalesce window

/** Everything that belongs to ONE document. templateData is per-doc because a
 *  .slidecraft is self-contained (its own template), so two open projects can use
 *  different templates. */
export interface DocState {
  id: string;
  title: string;
  history: HState<DeckIR | null>;
  mdText: string;
  templateData: TemplateData | null;
  templateName: string;
  parseError: string | null;
  activeSlide: number;
  selected: Set<number>;
  gotoLine?: { line: number; ts: number };
  subMode: MarkdownSubMode;
  filePath: string | null;
}

export interface Store {
  docs: DocState[];
  activeId: string;
}

type Action =
  | { type: "history"; action: HAction<DeckIR | null> }
  | { type: "patchActiveFn"; fn: (d: DocState) => Partial<DocState> }
  | { type: "newDoc"; doc: DocState; activate: boolean }
  | { type: "switchDoc"; id: string }
  | { type: "closeDoc"; id: string };

let seq = 0;
function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `doc-${++seq}`;
}

/** Build a document with sane defaults; callers override what they know. */
export function makeDoc(init: Partial<DocState> = {}): DocState {
  return {
    id: init.id ?? newId(),
    title: init.title ?? "Untitled",
    history: init.history ?? { past: [], present: null, future: [], lastTs: 0 },
    mdText: init.mdText ?? "",
    templateData: init.templateData ?? null,
    templateName: init.templateName ?? "",
    parseError: init.parseError ?? null,
    activeSlide: init.activeSlide ?? 0,
    selected: init.selected ?? new Set([0]),
    gotoLine: init.gotoLine,
    subMode: init.subMode ?? "edit",
    filePath: init.filePath ?? null,
  };
}

function mapActive(s: Store, fn: (d: DocState) => DocState): Store {
  return { ...s, docs: s.docs.map((d) => (d.id === s.activeId ? fn(d) : d)) };
}

export function documentReducer(s: Store, a: Action): Store {
  switch (a.type) {
    case "history":
      return mapActive(s, (d) => ({ ...d, history: historyReducer(d.history, a.action) }));
    case "patchActiveFn":
      return mapActive(s, (d) => ({ ...d, ...a.fn(d) }));
    case "newDoc": {
      const docs = [...s.docs, a.doc];
      return { docs, activeId: a.activate ? a.doc.id : s.activeId };
    }
    case "switchDoc":
      return s.docs.some((d) => d.id === a.id) ? { ...s, activeId: a.id } : s;
    case "closeDoc": {
      if (s.docs.length <= 1) return s; // never close the last document
      const idx = s.docs.findIndex((d) => d.id === a.id);
      if (idx < 0) return s;
      const docs = s.docs.filter((d) => d.id !== a.id);
      const activeId = s.activeId === a.id ? docs[Math.max(0, idx - 1)].id : s.activeId;
      return { docs, activeId };
    }
    default:
      return s;
  }
}

export function useDocumentStore(initialDoc: Partial<DocState> = {}) {
  const [store, dispatch] = useReducer(documentReducer, undefined, () => {
    const doc = makeDoc(initialDoc);
    return { docs: [doc], activeId: doc.id };
  });
  const active = store.docs.find((d) => d.id === store.activeId) ?? store.docs[0];

  // ── deck history (active doc) ──
  const setDeck = useCallback(
    (next: DeckIR | null, mode: HistoryMode = "commit") =>
      dispatch({ type: "history", action: { type: "set", next, mode, ts: Date.now(), coalesceMs: COALESCE_MS } }),
    [],
  );
  const resetDeck = useCallback(
    (next: DeckIR | null) => dispatch({ type: "history", action: { type: "reset", next } }),
    [],
  );
  const undoDeck = useCallback(() => dispatch({ type: "history", action: { type: "undo" } }), []);
  const redoDeck = useCallback(() => dispatch({ type: "history", action: { type: "redo" } }), []);

  // ── per-doc field setters (mirror useState's value|updater signature; stable) ──
  const setters = useMemo(() => {
    const mk =
      <K extends keyof DocState>(key: K) =>
      (v: DocState[K] | ((prev: DocState[K]) => DocState[K])) =>
        dispatch({
          type: "patchActiveFn",
          fn: (d) =>
            ({ [key]: typeof v === "function" ? (v as (p: DocState[K]) => DocState[K])(d[key]) : v }) as Partial<DocState>,
        });
    return {
      setMdText: mk("mdText"),
      setTemplateData: mk("templateData"),
      setTemplateName: mk("templateName"),
      setParseError: mk("parseError"),
      setActiveSlide: mk("activeSlide"),
      setSelected: mk("selected"),
      setGotoLine: mk("gotoLine"),
      setSubMode: mk("subMode"),
      setFilePath: mk("filePath"),
    };
  }, []);

  // ── document collection ops (used from P0.2: open → new doc, tab switching) ──
  const createDoc = useCallback((init: Partial<DocState> = {}) => {
    const doc = makeDoc(init);
    dispatch({ type: "newDoc", doc, activate: true });
    return doc.id;
  }, []);
  const switchDoc = useCallback((id: string) => dispatch({ type: "switchDoc", id }), []);
  const closeDoc = useCallback((id: string) => dispatch({ type: "closeDoc", id }), []);

  return {
    // active-document flat API (names match the old useDeckController state exactly)
    deck: active.history.present,
    setDeck,
    resetDeck,
    undoDeck,
    redoDeck,
    canUndo: active.history.past.length > 0,
    canRedo: active.history.future.length > 0,
    mdText: active.mdText,
    templateData: active.templateData,
    templateName: active.templateName,
    parseError: active.parseError,
    activeSlide: active.activeSlide,
    selected: active.selected,
    gotoLine: active.gotoLine,
    subMode: active.subMode,
    filePath: active.filePath,
    ...setters,
    // document collection (for tabs / multi-project addressing)
    docs: store.docs,
    activeId: store.activeId,
    createDoc,
    switchDoc,
    closeDoc,
  };
}
