/**
 * MasterPicker.tsx — a single pull-down button for the slide master. The button shows the current master;
 * clicking opens MasterMenu (#612: 選ぶ／取り込む／加工する／新規 — every template operation lives here).
 * Used on the top bar (all operations) and in the Draft header (select + import/Re-make/delete only: the
 * adjust panel, the augment flow's banner and the creator dialog all render behind the Draft modal).
 * Applying is gated by the caller (collab lock / template adjust → `disabled`).
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MasterEntry } from "./useMasterRegistry";
import type { TemplateData } from "../engine/template-loader";
import type { AugmentPlan } from "../engine/layout-augment-plan";
import { MasterMenu } from "./MasterMenu";
import { planTemplateAugmentation } from "./augment-offer";

interface MasterPickerProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Import a new master (.pptx) FAITHFULLY — keep its own layouts/placeholders. Omit → SELECT only. */
  onImport?: () => void;
  /** Re-make (ADR-0027): import a .pptx keeping the source's DESIGN (decorations/layouts) and normalising
   *  only the fonts. Omit → SELECT only. */
  onRemake?: () => void;
  /** テンプレ調整 (#570): adjust the ACTIVE master's fonts / sizes into a derived master. Omit → hidden. */
  onAdjust?: () => void;
  /** テンプレを強化 (#568/#612): add the layouts the ACTIVE template lacks. Omit → hidden. */
  onAugment?: (plan: AugmentPlan) => void;
  /** The active template — what 「テンプレを強化」 plans against (planned only while the menu is open). */
  template?: TemplateData | null;
  /** Create a new template from scratch (テーマ2 S4). Omit to hide the create item. */
  onCreate?: () => void;
  /** Re-show the last intake result summary (the transparency bar). Omit → no ⓘ item (nothing imported yet). */
  onShowInfo?: () => void;
  /** Delete an imported master (built-ins are never deletable). Omit → no delete affordance. */
  onRemove?: (id: string) => void;
  disabled?: boolean;
}

export default function MasterPicker({ masters, activeId, onSelect, onImport, onRemake, onAdjust, onAugment, template, onCreate, onShowInfo, onRemove, disabled }: MasterPickerProps) {
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
  // Planned lazily (only while open) — the plan builds the template's catalog.
  const augmentPlan = useMemo(() => (open && onAugment && template ? planTemplateAugmentation(template) : null), [open, onAugment, template]);

  return (
    <div className="relative inline-flex min-w-0 items-center gap-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("masterPicker.buttonTitle")}
        className="px-3 py-1.5 text-sm rounded bg-edge hover:bg-accent/40 text-fg transition-colors disabled:opacity-40 disabled:hover:bg-edge inline-flex min-w-0 items-center gap-1.5 max-w-[380px]"
      >
        <span className="shrink-0">🎨</span>
        {/* #692: say what the button is before the name. When space is short the NAME truncates first (far larger
            flex-shrink); the prefix gives way only on a very narrow window, so the AI and ⚙ buttons stay on screen. */}
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{t("masterPicker.buttonPrefix")}</span>
        <span className="min-w-0 truncate shrink-[1000]">{active ? active.name : t("masterPicker.selectMaster")}</span>
        <span className="shrink-0 text-muted text-xs">▾</span>
      </button>
      {open && (
        // `top-full` anchors the menu to the BOTTOM of the trigger (opens below it, never over it): the root
        // is inline-flex, so without an explicit top an absolute child would sit at the flex line's TOP.
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[300px] max-w-[360px] bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
          <MasterMenu
            masters={masters}
            activeId={activeId}
            onSelect={onSelect}
            onClose={() => setOpen(false)}
            onImport={onImport}
            onRemake={onRemake}
            onAdjust={onAdjust}
            augment={onAugment ? { plan: augmentPlan, onAugment } : undefined}
            onShowInfo={onShowInfo}
            onCreate={onCreate}
            onRemove={onRemove}
          />
        </div>
      )}
    </div>
  );
}
