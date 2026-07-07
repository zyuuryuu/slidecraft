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
  /** Create a new template from scratch (テーマ2 S4). Omit to hide the create item. */
  onCreate?: () => void;
  disabled?: boolean;
}

export default function MasterPicker({ masters, activeId, onSelect, onImport, onRemake, onCreate, disabled }: MasterPickerProps) {
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
    <div className="relative" ref={ref}>
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

      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-[220px] max-w-[320px] bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
          {masters.map((m) => {
            const isActive = m.id === activeId;
            return (
              <button
                key={m.id}
                onClick={() => { onSelect(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-edge ${
                  isActive ? "text-accent-soft bg-accent/15 font-medium" : "text-fg2"
                }`}
              >
                <span className="w-3 shrink-0 text-center">{isActive ? "✓" : ""}</span>
                <span className="truncate">{m.name}{m.builtin ? t("masterPicker.builtinSuffix") : ""}</span>
              </button>
            );
          })}
          {(onImport || onRemake || onCreate) && <div className="my-1 h-px bg-edge" />}
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
