/**
 * MasterMenu.tsx — #612: the master pull-down's CONTENTS, grouped into four sections so every template
 * operation has one home:
 *   選ぶ     — the masters (✓ = active; 🗑 only on imported ones)
 *   取り込む — import a .pptx as-is / keep its design (Re-make)
 *   加工する — adjust fonts/sizes · augment (add missing layouts) · ⓘ the latest intake result
 *   新規     — create a template
 * A section shows only when it has an item, so the Draft header (select + import only) gets just the
 * first two. Stateless (open/close lives in MasterPicker) — every item calls its handler then `onClose`.
 * 「テンプレを強化」 is offered for ANY active master (not only right after an intake); when the plan adds
 * nothing it is disabled with the reason (`planAugmentation`'s `reason`, or "nothing missing").
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MasterEntry } from "./useMasterRegistry";
import type { AugmentPlan } from "../engine/layout-augment-plan";
import { augmentWhat } from "./augment-offer";

export interface MasterMenuProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onImport?: () => void;
  onRemake?: () => void;
  onAdjust?: () => void;
  /** 「テンプレを強化」: the ACTIVE template's plan (null = not loaded yet) and the action. Omit → hidden. */
  augment?: { plan: AugmentPlan | null; onAugment: (plan: AugmentPlan) => void };
  onShowInfo?: () => void;
  onCreate?: () => void;
  onRemove?: (id: string) => void;
}

const ITEM = "w-full text-left px-3 py-1.5 flex items-center gap-2 text-fg2 hover:bg-edge disabled:opacity-50 disabled:hover:bg-transparent";

function Section({ id, label, first, children }: { id: string; label: string; first: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      {!first && <div className="my-1 h-px bg-edge" />}
      <div data-testid={`master-section-${id}`} className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}

function Item({ icon, label, title, testId, onClick, disabled, note }: {
  icon: string; label: string; title?: string; testId?: string; onClick: () => void; disabled?: boolean; note?: string;
}) {
  return (
    <button data-testid={testId} onClick={onClick} title={title} disabled={disabled} className={ITEM}>
      <span className="w-3 shrink-0 text-center self-start">{icon}</span>
      <span className="min-w-0 flex flex-col">
        <span>{label}</span>
        {note && <span className="text-[11px] text-muted whitespace-normal">{note}</span>}
      </span>
    </button>
  );
}

export function MasterMenu({ masters, activeId, onSelect, onClose, onImport, onRemake, onAdjust, augment, onShowInfo, onCreate, onRemove }: MasterMenuProps) {
  const { t } = useTranslation();
  const run = (fn: () => void) => () => { fn(); onClose(); };
  const plan = augment?.plan ?? null;
  const canAugment = !!plan && plan.add.length > 0;
  const augmentNote = !plan || canAugment ? undefined
    : plan.reason ? t("intake.augmentUnavailable", { reason: plan.reason }) : t("masterPicker.augmentNothing");

  const sections: Array<{ id: string; label: string; items: ReactNode[] }> = [
    {
      id: "select",
      label: t("masterPicker.section.select"),
      items: [
        <div key="list" className="max-h-[45vh] overflow-y-auto">
          {masters.map((m) => {
            const isActive = m.id === activeId;
            return (
              <div key={m.id} className={`group flex items-center hover:bg-edge ${isActive ? "bg-accent/15" : ""}`}>
                <button
                  onClick={run(() => onSelect(m.id))}
                  className={`flex-1 min-w-0 text-left pl-3 pr-1 py-1.5 flex items-center gap-2 ${isActive ? "text-accent-soft font-medium" : "text-fg2"}`}
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
        </div>,
      ],
    },
    {
      id: "intake",
      label: t("masterPicker.section.intake"),
      items: [
        onImport && <Item key="import" icon="📥" label={t("masterPicker.importLabel")} title={t("masterPicker.importTitle")} onClick={run(onImport)} />,
        onRemake && <Item key="remake" icon="🔁" label={t("masterPicker.remakeLabel")} title={t("masterPicker.remakeTitle")} onClick={run(onRemake)} />,
      ].filter(Boolean),
    },
    {
      id: "modify",
      label: t("masterPicker.section.modify"),
      items: [
        onAdjust && <Item key="adjust" icon="🔤" label={t("masterPicker.adjustLabel")} title={t("masterPicker.adjustTitle")} onClick={run(onAdjust)} />,
        augment && (
          <Item
            key="augment"
            testId="master-augment"
            icon="🧩"
            label={canAugment ? t("masterPicker.augmentLabel", { what: augmentWhat(plan!) }) : t("masterPicker.augmentLabelPlain")}
            title={augmentNote ?? t("masterPicker.augmentTitle")}
            note={augmentNote}
            disabled={!canAugment}
            onClick={run(() => { if (canAugment) augment.onAugment(plan!); })}
          />
        ),
        onShowInfo && <Item key="info" testId="master-show-info" icon="ⓘ" label={t("masterPicker.showInfoLabel")} title={t("masterPicker.showInfoTitle")} onClick={run(onShowInfo)} />,
      ].filter(Boolean),
    },
    {
      id: "create",
      label: t("masterPicker.section.create"),
      items: [onCreate && <Item key="create" icon="＋" label={t("masterPicker.createLabel")} title={t("masterPicker.createTitle")} onClick={run(onCreate)} />].filter(Boolean),
    },
  ].filter((s) => s.items.length > 0);

  return (
    <>
      {sections.map((s, i) => (
        <Section key={s.id} id={s.id} label={s.label} first={i === 0}>{s.items}</Section>
      ))}
    </>
  );
}
