/**
 * MasterPicker.tsx — a single pull-down button for choosing / importing the slide master.
 * The button shows the current master; clicking opens a menu of masters (the active one is highlighted),
 * with an "＋ 取り込む" item last (when importing is allowed). Used on the top bar (select + import) and
 * in the Draft header (select-only — omit onImport). Applying is gated by the caller (collab lock).
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { MasterEntry } from "./useMasterRegistry";

interface MasterPickerProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Import a new master (.pptx) FAITHFULLY — keep its own layouts/placeholders. Omit → SELECT only. */
  onImport?: () => void;
  /** Re-make: import a .pptx but keep only its THEME (fonts/colors) and use SlideCraft's own layouts. */
  onRemake?: () => void;
  onRemakeAI?: () => void; // ADR-0026: AI Re-make (structure mapping); falls back to deterministic when AI isn't ready
  /** Create a new template from scratch (テーマ2 S4). Omit to hide the create item. */
  onCreate?: () => void;
  /** Re-show the last intake result summary (the transparency bar). Omit → no ⓘ (nothing imported yet). */
  onShowInfo?: () => void;
  /** Delete an imported master (built-ins are never deletable). Omit → no delete affordance. */
  onRemove?: (id: string) => void;
  /** Whether an AI provider is connected. When false, the "AI で作り直す" item is disabled (it would
   *  otherwise silently fall back to the deterministic Re-make, which reads as "did nothing"). Default true. */
  aiReady?: boolean;
  disabled?: boolean;
}

export default function MasterPicker({ masters, activeId, onSelect, onImport, onRemake, onRemakeAI, onCreate, onShowInfo, onRemove, aiReady = true, disabled }: MasterPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = masters.find((m) => m.id === activeId);

  return (
    <div className="relative inline-flex items-center gap-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("masterPicker.buttonTitle")}
        className="px-3 py-1.5 text-sm rounded bg-edge hover:bg-accent/40 text-fg transition-colors disabled:opacity-40 disabled:hover:bg-edge inline-flex items-center gap-1.5 max-w-[220px]"
      >
        <span className="shrink-0">🎨</span>
        <span className="truncate">{active ? active.name : t("masterPicker.selectMaster")}</span>
        <span className="shrink-0 text-muted text-xs">▾</span>
      </button>
      {onShowInfo && (
        <button
          onClick={onShowInfo}
          title={t("masterPicker.showInfoTitle")}
          className="shrink-0 w-6 h-6 rounded-full text-muted hover:text-accent-soft hover:bg-edge inline-flex items-center justify-center text-xs"
        >
          ⓘ
        </button>
      )}

      {open && (
        // `top-full` anchors the menu to the BOTTOM of the trigger row (opens below it, never over it).
        // Needed because the root is inline-flex (button + ⓘ side by side): without an explicit top an
        // absolute child would take its static position at the flex line's TOP and overlap the toolbar.
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[220px] max-w-[320px] bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
          <div className="max-h-[45vh] overflow-y-auto">
            {masters.map((m) => {
              const isActive = m.id === activeId;
              return (
                <div key={m.id} className={`group flex items-center hover:bg-edge ${isActive ? "bg-accent/15" : ""}`}>
                  <button
                    onClick={() => { onSelect(m.id); setOpen(false); }}
                    className={`flex-1 min-w-0 text-left pl-3 pr-1 py-1.5 flex items-center gap-2 ${
                      isActive ? "text-accent-soft font-medium" : "text-fg2"
                    }`}
                  >
                    <span className="w-3 shrink-0 text-center">{isActive ? "✓" : ""}</span>
                    <span className="truncate">{m.name}{m.builtin ? t("masterPicker.builtinSuffix") : ""}</span>
                  </button>
                  {onRemove && !m.builtin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(m.id); }}
                      title={t("masterPicker.removeTitle")}
                      className="shrink-0 w-7 h-7 mr-1 rounded text-muted hover:text-red-400 hover:bg-void inline-flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      🗑
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {(onImport || onRemake || onRemakeAI || onCreate) && <div className="my-1 h-px bg-edge" />}
          {onImport && (
            <button
              onClick={() => { onImport(); setOpen(false); }}
              title={t("masterPicker.importTitle")}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-fg2 hover:bg-edge"
            >
              <span className="w-3 shrink-0 text-center">＋</span>
              <span>{t("masterPicker.importLabel")}</span>
            </button>
          )}
          {onRemake && (
            <button
              onClick={() => { onRemake(); setOpen(false); }}
              title={t("masterPicker.remakeTitle")}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-fg2 hover:bg-edge"
            >
              <span className="w-3 shrink-0 text-center">＋</span>
              <span>{t("masterPicker.remakeLabel")}</span>
            </button>
          )}
          {onRemakeAI && (
            <button
              onClick={() => { if (aiReady) { onRemakeAI(); setOpen(false); } }}
              disabled={!aiReady}
              title={aiReady ? t("masterPicker.remakeAITitle") : t("masterPicker.remakeAINotReady")}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-fg2 hover:bg-edge disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <span className="w-3 shrink-0 text-center">✨</span>
              <span>{t("masterPicker.remakeAILabel")}{!aiReady ? t("masterPicker.aiOfflineSuffix") : ""}</span>
            </button>
          )}
          {onCreate && (
            <button
              onClick={() => { onCreate(); setOpen(false); }}
              title={t("masterPicker.createTitle")}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-fg2 hover:bg-edge"
            >
              <span className="w-3 shrink-0 text-center">＋</span>
              <span>{t("masterPicker.createLabel")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
