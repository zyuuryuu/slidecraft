/**
 * MasterPicker.tsx — a single pull-down button for choosing / importing the slide master.
 * The button shows the current master; clicking opens a menu of masters (the active one is highlighted),
 * with an "＋ 取り込む" item last (when importing is allowed). Used on the top bar (select + import) and
 * in the Draft header (select-only — omit onImport). Applying is gated by the caller (collab lock).
 */
import { useState, useRef, useEffect } from "react";
import type { MasterEntry } from "./useMasterRegistry";

interface MasterPickerProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Import a new master (.pptx). Omit to render the SELECT only (no import item). */
  onImport?: () => void;
  disabled?: boolean;
}

export default function MasterPicker({ masters, activeId, onSelect, onImport, disabled }: MasterPickerProps) {
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
        title="このデッキで使うスライドマスター"
        className="px-3 py-1.5 text-sm rounded bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white transition-colors disabled:opacity-40 disabled:hover:bg-[#2D3A6E] inline-flex items-center gap-1.5 max-w-[220px]"
      >
        <span className="shrink-0">🎨</span>
        <span className="truncate">{active ? active.name : "マスター選択"}</span>
        <span className="shrink-0 text-gray-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-[220px] max-w-[320px] bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl py-1 text-sm">
          {masters.map((m) => {
            const isActive = m.id === activeId;
            return (
              <button
                key={m.id}
                onClick={() => { onSelect(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[#2D3A6E] ${
                  isActive ? "text-[#93C5FD] bg-[#3B82F6]/15 font-medium" : "text-gray-200"
                }`}
              >
                <span className="w-3 shrink-0 text-center">{isActive ? "✓" : ""}</span>
                <span className="truncate">{m.name}{m.builtin ? "（内蔵）" : ""}</span>
              </button>
            );
          })}
          {onImport && (
            <>
              <div className="my-1 h-px bg-[#2D3A6E]" />
              <button
                onClick={() => { onImport(); setOpen(false); }}
                title=".pptx をスライドマスターとして取り込む"
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-gray-300 hover:bg-[#2D3A6E]"
              >
                <span className="w-3 shrink-0 text-center">＋</span>
                <span>マスターを取り込む（.pptx）</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
