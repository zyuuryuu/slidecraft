/**
 * MasterPicker.tsx — a single pull-down button for the slide master. The button shows the current master;
 * clicking opens MasterMenu (#612: 選ぶ／取り込む／加工する／新規 — every template operation lives here).
 * Used on the top bar (all operations) and in the Draft header (select + import/Re-make/delete only: the
 * adjust panel, the augment flow's banner and the creator dialog all render behind the Draft modal).
 * Applying is gated by the caller (collab lock / template adjust → `disabled`).
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MasterEntry } from "./useMasterRegistry";
import type { TemplateData } from "../engine/template-loader";
import type { AugmentPlan } from "../engine/layout-augment-plan";
import { MasterMenu } from "./MasterMenu";
import { planTemplateAugmentation } from "./augment-offer";
import BarTip from "./BarTip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BarMenuContent } from "./BarMenu";
import { BAR_HOVER } from "./bar-button";

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
  const active = masters.find((m) => m.id === activeId);
  // Planned lazily (only while open) — the plan builds the template's catalog.
  const augmentPlan = useMemo(() => (open && onAugment && template ? planTemplateAugmentation(template) : null), [open, onAugment, template]);

  return (
    // #724: the shadcn DropdownMenu (Base UI) — Portal, arrow keys, Esc / outside click, an item closes the menu itself.
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <BarTip label={t("masterPicker.buttonTitle")}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            // #692: `shrink` (not the Button's shrink-0) + min-w-0 let the name truncate on a narrow window.
            className={`px-3 font-normal ${BAR_HOVER} disabled:opacity-40 shrink min-w-0 max-w-[380px] justify-start`}
          />
        }
        disabled={disabled}
        aria-expanded={open}
      >
        <span className="shrink-0">🎨</span>
        {/* #692: say what the button is before the name. When space is short the NAME truncates first (far larger
            flex-shrink); the prefix gives way only on a very narrow window, so the AI and ⚙ buttons stay on screen. */}
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{t("masterPicker.buttonPrefix")}</span>
        <span className="min-w-0 truncate shrink-[1000]">{active ? active.name : t("masterPicker.selectMaster")}</span>
        <span className="shrink-0 text-muted text-xs">▾</span>
      </DropdownMenuTrigger>
      </BarTip>
      {/* Opens below the trigger, right-aligned (as before). */}
      <BarMenuContent align="end" className="w-auto min-w-[300px] max-w-[360px]">
        <MasterMenu
          masters={masters}
          activeId={activeId}
          onSelect={onSelect}
          onImport={onImport}
          onRemake={onRemake}
          onAdjust={onAdjust}
          augment={onAugment ? { plan: augmentPlan, onAugment } : undefined}
          onShowInfo={onShowInfo}
          onCreate={onCreate}
          onRemove={onRemove}
        />
      </BarMenuContent>
    </DropdownMenu>
  );
}
