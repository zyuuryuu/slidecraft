/**
 * AiPanel.tsx — In-Edit AI dock.
 *
 * An immersive, always-at-hand AI surface for Edit mode: describe a deck →
 * generate (streamed) → apply, without leaving the editor. Shares all
 * generation logic with the AI dialog via useAiGeneration (no divergence).
 */

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import AiSettingsPopover from "./AiSettingsPopover";
import type { AiGeneration } from "./useAiGeneration";
import DiffView from "./DiffView";
import AiTasksPanel from "./AiTasksPanel";

const AIPANEL_HEIGHT_KEY = "slidecraft_aipanel_h";

interface AiPanelProps {
  onClose: () => void;
  /** Markdown of the FOCUSED slide — the AI edits this one (scope = slide-list selection). */
  currentSlideMd?: string;
  /** Apply the edited slide back to the focused slide. */
  onApplySlide?: (markdown: string, instruction?: string) => void;
  /** Reconcile+validate an edit AS IT WILL APPLY, for the review (diff = real result + warnings).
   *  `beforeMd` overrides the diff's LEFT side (a figure edit diffs the figure source, not the slide). */
  onPreviewSlideEdit?: (raw: string, instruction?: string) => { afterMd: string; warnings: string[]; beforeMd?: string } | null;
  /** Focused slide number (1-based) + how many are selected, for the scope indicator. */
  activeSlideNum?: number;
  selectedCount?: number;
  /** Apply ONE instruction to all selected slides (multi-select batch) → review proposal. */
  onBatchEdit?: (instruction: string) => void;
  batchRunning?: boolean;
  /** Pre-fill the instruction box (ReviewBar "✨直す" handoff). `ts` re-seeds on repeat. */
  seed?: { prompt: string; ts: number };
  /** Shared AI instance (lifted to App) so config never diverges across surfaces. */
  ai: AiGeneration;
  /** The 協働 (live-collab) surface, folded into this hub as a second tab. Omit → no 協働 tab. */
  collabTab?: ReactNode;
  /** Whether a collab session is live (drives the 協働 tab's pulse + the initial tab). */
  collabConnected?: boolean;
}

export default function AiPanel({
  onClose,
  currentSlideMd,
  onApplySlide,
  onPreviewSlideEdit,
  activeSlideNum,
  selectedCount = 1,
  onBatchEdit,
  batchRunning,
  seed,
  ai,
  collabTab,
  collabConnected,
}: AiPanelProps) {
  const [userRequest, setUserRequest] = useState("");
  // Collapse the instruction box (keep scope + a truncated echo) so the 変更プレビュー below gets the room.
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<"gen" | "tasks">("gen");
  // Hub-level tab: this dock now houses both the AI assistant and the 協働 (live-collab) surface.
  const [hubTab, setHubTab] = useState<"assist" | "collab">(collabConnected ? "collab" : "assist");
  const runningCount = ai.tasks.filter((t) => t.status === "running").length;

  // Pre-fill the instruction when handed off from the ReviewBar ("✨直す"). Keyed on
  // seed.ts so re-clicking the same issue re-seeds; switches to the gen tab.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: sync the ReviewBar handoff (seed) into the editable instruction + tab */
  useEffect(() => {
    if (seed) {
      setUserRequest(seed.prompt);
      setTab("gen");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.ts]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Resizable height: drag the top edge to grow the dock upward (persisted). The dock
  // is bottom-anchored, so height = viewport bottom − pointer Y.
  const [panelH, setPanelH] = useState(() => {
    const saved = Number(localStorage.getItem(AIPANEL_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= 220 ? saved : 340;
  });
  const draggingH = useRef(false);
  useEffect(() => localStorage.setItem(AIPANEL_HEIGHT_KEY, String(Math.round(panelH))), [panelH]);
  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingH.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingH.current) return;
      setPanelH(Math.min(window.innerHeight - 120, Math.max(220, window.innerHeight - e.clientY)));
    };
    const onUp = () => {
      if (!draggingH.current) return;
      draggingH.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Scope = the slide-list selection. 1 selected → edit the FOCUSED slide here (in-panel
  // diff + 採用). >1 selected → apply the instruction to EACH selected slide (batch) →
  // a review proposal. Whole-deck GENERATION moved to Initialize (📄 → ✨AI生成).
  const batch = selectedCount > 1 && !!onBatchEdit;
  const canSlide = !!currentSlideMd && !!onApplySlide;
  const slideScope = canSlide;

  // !generating && !bestOfRunning = single-flight: a run in progress (incl. best-of-N fan-out) must NOT
  // start a second generation (via ⌘/Ctrl+Enter or the button) — that orphaned the first batch and let
  // a stale candidate be adopted (adversarial review). 停止 (cancel) is the only mid-run action.
  const ready = ai.canGenerate(userRequest) && !batchRunning && !ai.generating && !ai.bestOfRunning && (batch || canSlide);

  // Reconcile+validate the AI result the way it WILL be applied, so the review shows the REAL
  // result (not raw output) + any advisory — the reviewer decides 採用/却下 informed, and an
  // adopted slide always renders. Only the content-edit path reconciles (else null → raw diff).
  // Best-of-N (ADR-0019 Option B): the review works over CANDIDATES — a single generate → [ai.result],
  // best-of-N → ai.candidates. Each is scored via the adoption gate (fewer warnings = better; a
  // full-Markdown drift is worst) so the best is preselected; a picker lets you compare/choose. The
  // instruction (userRequest) feeds the delete-intent cross-check + the score.
  const busy = ai.generating || ai.bestOfRunning;
  const cands = useMemo(
    () => (ai.bestOfRunning ? [] : ai.candidates.length ? ai.candidates : ai.result ? [ai.result] : []),
    [ai.bestOfRunning, ai.candidates, ai.result],
  );
  const [selIdx, setSelIdx] = useState(0);
  const scored = useMemo(
    () => (slideScope && currentSlideMd && !busy
      ? cands.map((c) => {
          const p = onPreviewSlideEdit?.(c, userRequest) ?? null;
          // A null preview = not a previewable content edit (design-intent/deck-gen) → score it WORST so
          // it never beats a clean content candidate; a full-Markdown drift is next-worst.
          const score = p ? (p.shouldRetry ? 100 : 0) + p.warnings.length : Number.POSITIVE_INFINITY;
          return { preview: p, score };
        })
      : []),
    [cands, slideScope, currentSlideMd, busy, userRequest, onPreviewSlideEdit],
  );
  const bestIdx = useMemo(() => {
    let b = 0;
    for (let i = 1; i < scored.length; i++) if (scored[i].score < scored[b].score) b = i;
    return b;
  }, [scored]);
  // Preselect the best candidate when a NEW candidate set arrives — the sanctioned "adjust state on a
  // prop change" pattern (setState during render, NOT an effect) so there's no cascading re-render. A
  // manual pick within the same set is preserved (ai.candidates identity is unchanged until the next run).
  const [prevCandidates, setPrevCandidates] = useState(ai.candidates);
  if (ai.candidates !== prevCandidates) {
    setPrevCandidates(ai.candidates);
    setSelIdx(ai.candidates.length > 1 && !busy ? bestIdx : 0);
  }
  const selectedIdx = cands.length ? Math.min(selIdx, cands.length - 1) : 0;
  const currentResult = cands[selectedIdx] ?? ai.result;
  const editPreview = scored[selectedIdx]?.preview ?? null;

  // ① Self-repair, Option A (ADR-0019): when a figure edit drifted to full-Markdown (editPreview
  // .shouldRetry), auto-fire ONE ops-bias retry with the harness-authored nudge. Ref-guarded so it
  // runs at most once per user generate (reset in doGenerate) → never loops; a 2nd drift just shows the
  // [opsフォールバック]-tagged result for the human to reject/edit. Adoption gate unchanged.
  const autoRetriedRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  // 採用 = commit, then FREEZE the review as an "adopted" snapshot. Recomputing editPreview against the
  // now-updated slide would re-apply the edit (e.g. a dup addNode → "既に存在" skip) and show a spurious
  // error while the bar stays as if nothing happened. The snapshot keeps the preview visible (you may
  // want to keep looking) but in an explicit adopted state until 閉じる. null = pending (not yet adopted).
  const [adopted, setAdopted] = useState<{ beforeMd?: string; afterMd: string; warnings: string[] } | null>(null);
  const preview = adopted ?? editPreview; // what the review pane renders: frozen snapshot once adopted
  const aiGenerating = ai.generating;
  const aiRetry = ai.retry;
  const bestOfN = ai.bestOfN;
  useEffect(() => {
    if (adopted) return; // never auto-retry a committed edit
    // In best-of-N mode the fan-out IS the quality lever → disarm the one-shot. DISARM (set the ref),
    // don't just early-return: else lowering 候補数 to 1 mid-review would let a stale drifted editPreview
    // re-arm and fire a generation the user never asked for (adversarial review).
    if (bestOfN > 1) { autoRetriedRef.current = true; return; }
    if (!editPreview?.shouldRetry || !editPreview.retryInstruction || !currentSlideMd) return;
    if (autoRetriedRef.current || aiGenerating) return;
    autoRetriedRef.current = true;
    setRetrying(true);
    aiRetry(`Current slide:\n${currentSlideMd}\n\nInstruction: ${editPreview.retryInstruction}`);
  }, [editPreview, aiGenerating, aiRetry, currentSlideMd, adopted, bestOfN]);

  // 却下 / 閉じる — discard the foreground result and re-arm the one-shot self-repair.
  const closePreview = useCallback(() => {
    setAdopted(null);
    autoRetriedRef.current = false;
    setRetrying(false);
    ai.reset();
  }, [ai]);

  // Switching the focused slide (or selection scope) invalidates a pending AI review — it was generated
  // for the OLD slide, so 採用 must not commit it onto a different one. Clear LOCAL review state during
  // render (the sanctioned "reset on identity change" pattern), and reset the PARENT hook (candidates +
  // result) in an effect (parent state can't be set during render).
  const slideKey = `${activeSlideNum ?? ""}/${selectedCount}`;
  const [prevSlideKey, setPrevSlideKey] = useState(slideKey);
  if (slideKey !== prevSlideKey) {
    setPrevSlideKey(slideKey);
    setAdopted(null);
    setRetrying(false);
  }
  const aiReset = ai.reset;
  useEffect(() => { autoRetriedRef.current = false; aiReset(); }, [slideKey, aiReset]);

  const doGenerate = () => {
    if (batch) { onBatchEdit(userRequest); return; } // one instruction → every selected slide
    if (!currentSlideMd) return;
    autoRetriedRef.current = false; // a fresh user generate re-arms the one-shot self-repair
    setRetrying(false);
    setAdopted(null); // leaving the adopted snapshot behind for a new proposal
    setSelIdx(0);
    // One slide in, one slide out (text + any figure) — far fewer tokens than the deck. best-of-N (>1)
    // fans out N candidates and lets the adoption gate pick the best; N=1 is the plain single generate.
    const prompt = `Current slide:\n${currentSlideMd}\n\nInstruction: ${userRequest}`;
    if (bestOfN > 1) ai.generateBest(prompt, "slide", bestOfN);
    else ai.generate(prompt, "slide");
  };

  // Diagnostics-driven per-slide fixing lives in the ReviewBar ("まとめて整える") now —
  // this dock is just freeform edit of the focused slide + the task list, kept simple.

  const doApply = () => {
    if (!onApplySlide || !currentResult.trim()) return;
    onApplySlide(currentResult, userRequest); // adopt the SELECTED candidate
    // Freeze the pre-adopt review (slide edits only — deck-gen "適用 → 編集へ" navigates away).
    if (slideScope) {
      const snap = editPreview ?? { afterMd: currentResult, warnings: [] as string[] };
      setAdopted({ beforeMd: snap.beforeMd, afterMd: snap.afterMd, warnings: snap.warnings });
    }
  };

  const toneColor =
    ai.connection.tone === "ok" ? "text-green-400"
    : ai.connection.tone === "err" ? "text-red-400"
    : ai.connection.tone === "checking" ? "text-muted"
    : "text-amber-400";

  return (
    <div className="relative border-t border-accent/40 bg-void flex flex-col shrink-0" style={{ height: panelH }}>
      {/* Drag the top edge to resize the dock (double-click resets) */}
      <div
        onMouseDown={onResizeDown}
        onDoubleClick={() => setPanelH(340)}
        title="ドラッグで高さ変更（ダブルクリックでリセット）"
        className="h-1.5 shrink-0 cursor-row-resize bg-edge hover:bg-accent transition-colors"
      />
      {/* Header — hub tabs (アシスト / 協働); gear (config) shows only on the assist tab */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-edge">
        <button
          onClick={() => setHubTab("assist")}
          className={`px-2 py-0.5 rounded text-sm ${hubTab === "assist" ? "bg-edge text-accent-soft font-medium" : "text-muted hover:text-fg"}`}
        >
          ✨ アシスト
        </button>
        {collabTab && (
          <button
            onClick={() => setHubTab("collab")}
            className={`px-2 py-0.5 rounded text-sm inline-flex items-center gap-1 ${hubTab === "collab" ? "bg-edge text-fg font-medium" : "text-muted hover:text-fg"}`}
          >
            🔗 協働{collabConnected && <span className="text-emerald-400 leading-none animate-pulse">●</span>}
          </button>
        )}
        <div className="flex-1" />
        {hubTab === "assist" && (
          // One compact status pill = the only always-visible AI control. Shows readiness + model
          // (or DL%/error) at a glance and opens the settings popover; everything else lives there.
          <button
            onClick={() => setShowSettings((v) => !v)}
            title={`${ai.connection.label}${ai.connection.hint ? " — " + ai.connection.hint : ""}（クリックで AI 設定）`}
            className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-edge hover:bg-edge max-w-[230px] ${showSettings ? "bg-edge text-fg" : "bg-field text-fg2"}`}
          >
            <span className={`${toneColor} leading-none`}>●</span>
            <span className="truncate">{ai.connection.label}</span>
            <span className="text-muted leading-none">⚙</span>
          </button>
        )}
        <button onClick={onClose} className="text-muted hover:text-fg text-lg leading-none" title="閉じる">
          ×
        </button>
      </div>

      {/* Plain-language description of the active tab — so it's obvious what each does (non-IT friendly) */}
      <div className="px-3 py-1.5 text-[11px] text-muted border-b border-edge bg-canvas leading-relaxed shrink-0">
        {hubTab === "assist"
          ? "🖊️ AI にお願いして、このアプリの中でスライドを作る・直します。"
          : "🤝 あなたが使っている別の AI（例：Claude Code）をこの画面につなぎ、同じ資料を一緒に編集します。（上級者向け）"}
      </div>

      {hubTab === "collab" ? collabTab : (
      <>
      {/* AI settings popover — anchored below the header pill; a transparent backdrop closes it. */}
      {showSettings && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
          <div className="absolute right-2 top-12 z-50 w-[min(30rem,92vw)] rounded-lg border border-edge bg-canvas shadow-xl shadow-black/50">
            <AiSettingsPopover ai={ai} />
          </div>
        </>
      )}

      {/* Tabs: generate/edit vs the AI task list (in-flight + history) */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-edge">
        <button
          onClick={() => setTab("gen")}
          className={`px-2 py-0.5 rounded text-[11px] ${tab === "gen" ? "bg-accent text-on-accent" : "bg-field text-muted hover:text-on-accent"}`}
        >
          生成・編集
        </button>
        <button
          onClick={() => setTab("tasks")}
          className={`px-2 py-0.5 rounded text-[11px] ${tab === "tasks" ? "bg-accent text-on-accent" : "bg-field text-muted hover:text-on-accent"}`}
        >
          タスク{ai.tasks.length > 0 ? ` ${ai.tasks.length}` : ""}
        </button>
        {runningCount > 0 && <span className="text-[10px] text-accent-soft animate-pulse ml-1">● {runningCount} 実行中</span>}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
      {tab === "tasks" ? (
        <AiTasksPanel tasks={ai.tasks} onCancel={ai.cancelTask} onClear={ai.clearTasks} />
      ) : (
      <>
      {/* Scope + Prompt — content-height (NOT flex-1) so the instruction box stays compact and the
          freed space goes to the result/preview below; the box is user-resizable (resize-y) AND
          collapsible (chevron) so reviewing the 変更プレビュー can reclaim the whole area. */}
      <div className="px-3 py-2 flex flex-col gap-2">
        {/* Scope = the slide-list selection (no toggle). 1 = focused slide, >1 = batch.
            Leading chevron folds/unfolds the instruction box below. */}
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <button
            type="button"
            onClick={() => setPromptCollapsed((v) => !v)}
            title={promptCollapsed ? "指示欄を開く" : "指示欄をたたむ（プレビューを広く）"}
            aria-expanded={!promptCollapsed}
            className="w-4 h-4 flex items-center justify-center leading-none text-muted hover:text-fg shrink-0"
          >
            {promptCollapsed ? "▸" : "▾"}
          </button>
          <span>編集対象:</span>
          {batch ? (
            <span className="px-2 py-0.5 rounded bg-accent/20 text-accent-soft">選択 {selectedCount} 枚を一括編集</span>
          ) : canSlide ? (
            <span className="px-2 py-0.5 rounded bg-field text-accent-soft">スライド {activeSlideNum}</span>
          ) : (
            <span className="text-faint">スライドを選択してください</span>
          )}
          {batch && !promptCollapsed && <span className="text-faint">— 1つの指示を各スライドに適用 → 確認して採用</span>}
          {/* Collapsed: echo the current instruction (truncated) so folding doesn't hide what you asked. */}
          {promptCollapsed && (
            <span className="flex-1 min-w-0 truncate text-faint">
              {userRequest.trim() ? `— ${userRequest.trim()}` : "— 指示欄はたたまれています（▸ で開く）"}
            </span>
          )}
        </div>
        {/* Compact by default (~3 rows); resize-y lets you drag it a little taller, clamped so it can't swallow the panel. */}
        {!promptCollapsed && (
        <div className="flex gap-2">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={
              slideScope
                ? "このスライドへの指示（例: 箇条書きを3つに / もっと簡潔に / 図を追加 / DBノードを足す / 英語にする）"
                : "作りたいデッキを指示（例: SaaS の営業提案を5枚で。課題→解決→価格→導入事例→次のステップ）"
            }
            className="flex-1 h-[4.5rem] min-h-[2.75rem] max-h-56 px-2 py-1.5 bg-field border border-edge rounded text-sm text-fg resize-y"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready) doGenerate();
            }}
          />
          {busy ? (
            <button onClick={ai.cancel} className="self-start px-4 py-2 text-sm bg-edge hover:bg-accent/40 text-fg rounded shrink-0">
              停止
            </button>
          ) : (
            <button
              onClick={doGenerate}
              disabled={!ready}
              className="self-start px-4 py-2 text-sm bg-accent hover:bg-accent-hi disabled:bg-accent/30 disabled:text-on-accent/40 text-on-accent font-medium rounded shrink-0"
            >
              {batchRunning ? "一括編集中…" : batch ? `${selectedCount}枚を編集` : bestOfN > 1 ? `生成 ×${bestOfN}` : "生成"}
            </button>
          )}
        </div>
        )}
      </div>

      {/* Error — suppressed while best-of-N has surviving candidates: the foreground task is pinned to
          batch[0], so if only that one failed we must not flash a global error over valid candidates. */}
      {ai.error && cands.length === 0 && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-red-900/30 border border-red-500/40 rounded text-xs text-red-300">
          {ai.error}
        </div>
      )}

      {/* 告知 — deterministic repair dropped a corrupt unit (non-blocking) */}
      {ai.notice && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-amber-900/30 border border-amber-500/40 rounded text-xs text-amber-200">
          {ai.notice}
        </div>
      )}

      {/* ① Self-repair (Option A): the first attempt drifted to full-Markdown → auto re-asking for ops.
          Transparent (not silent) even though it fires automatically. */}
      {retrying && ai.generating && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-accent/15 border border-accent/40 rounded text-xs text-accent-soft">
          🔁 図の部分編集（ops）として受け取れなかったため、opsで自動的に再生成しています…
        </div>
      )}

      {/* Best-of-N (Option B): fanning out N candidates; the adoption gate picks the best when they land. */}
      {ai.bestOfRunning && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-accent/15 border border-accent/40 rounded text-xs text-accent-soft">
          🎲 {bestOfN} 候補を生成中…（採用ゲートで最良を提示します）
        </div>
      )}

      {/* Result — for a slide edit show before→after diff so it's never applied
          blind (you see what changed/was dropped) → 採用/却下. Deck gen keeps raw. */}
      {currentResult && !ai.bestOfRunning && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-edge">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-muted">
              {ai.generating ? "生成中…" : adopted ? "適用済み（プレビュー）" : slideScope && currentSlideMd ? "変更プレビュー（採用前に確認）" : "プレビュー（Markdown）"}
            </span>
            {/* Best-of-N candidate picker: cycle candidates, ✓ = clean (no warnings), ⚠k = k advisories.
                The best is preselected; ★ marks it. */}
            {cands.length > 1 && !adopted && (
              <div className="flex items-center gap-1 text-[11px] text-muted">
                <button onClick={() => setSelIdx((i) => (i - 1 + cands.length) % cands.length)} title="前の候補" className="px-1.5 py-0.5 bg-field hover:bg-edge rounded leading-none">◀</button>
                <span className="tabular-nums">候補 {selectedIdx + 1}/{cands.length}</span>
                <span className={(scored[selectedIdx]?.score ?? 1) === 0 ? "text-green-400" : "text-amber-300"}>
                  {/* — = no content preview (design-intent); ⟳ = full-Markdown drift (score≥100, worse
                      than any warning count); ✓ = clean; ⚠k = k advisories. */}
                  {scored[selectedIdx]?.preview == null ? "—"
                    : scored[selectedIdx].preview.shouldRetry ? "⟳"
                    : scored[selectedIdx].score === 0 ? "✓"
                    : `⚠${scored[selectedIdx].preview.warnings.length}`}
                </span>
                <button onClick={() => setSelIdx((i) => (i + 1) % cands.length)} title="次の候補" className="px-1.5 py-0.5 bg-field hover:bg-edge rounded leading-none">▶</button>
              </div>
            )}
            <div className="flex items-center gap-1">
              {adopted ? (
                // Adopted: the edit is committed; the review is a frozen record until you close it.
                <>
                  <span className="text-xs text-green-300">✓ 適用しました</span>
                  <button onClick={closePreview} className="px-2.5 py-1 text-xs bg-field hover:bg-edge text-fg2 rounded">
                    閉じる
                  </button>
                </>
              ) : (
                <>
                  {slideScope && currentSlideMd && (
                    <button
                      onClick={closePreview}
                      disabled={busy}
                      className="px-2.5 py-1 text-xs bg-field hover:bg-edge disabled:opacity-40 text-fg2 rounded"
                    >
                      却下
                    </button>
                  )}
                  <button
                    onClick={doApply}
                    disabled={busy || !currentResult.trim()}
                    className="px-3 py-1 text-xs bg-cyan hover:bg-cyan-hi disabled:opacity-40 text-on-accent font-medium rounded"
                  >
                    {slideScope ? "採用 → このスライド" : "適用 → 編集へ"}
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Validation advisories for THIS edit — shown at the review so 採用/却下 is informed
              (numbers/language changed, structure restored, a broken figure kept). Frozen once adopted. */}
          {preview && preview.warnings.length > 0 && (
            <div className="mx-3 mb-1 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-950/40 text-[11px] text-amber-200">
              {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}
          {slideScope && currentSlideMd && !busy ? (
            // Diff the REAL applied result (reconciled) when available, else the raw output. Once adopted
            // this is the frozen pre-adopt before→after, NOT a recompute against the updated slide.
            <DiffView before={preview?.beforeMd ?? currentSlideMd} after={preview?.afterMd ?? currentResult} fill />
          ) : (
            <pre className="flex-1 min-h-0 overflow-auto px-3 pb-2 text-[11px] text-green-200 font-mono whitespace-pre-wrap">
              {currentResult}
            </pre>
          )}
        </div>
      )}
      </>
      )}
      </div>
      </>
      )}
    </div>
  );
}
