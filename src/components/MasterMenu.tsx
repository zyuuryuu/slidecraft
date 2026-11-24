/**
 * MasterMenu.tsx — #612: the master pull-down's CONTENTS, grouped into four sections so every template
 * operation has one home:
 *   選ぶ     — the masters (✓ = active; 🗑 only on imported ones)
 *   取り込む — import a .pptx as-is / keep its design (Re-make)
 *   加工する — adjust fonts/sizes · augment (add missing layouts) · ⓘ the latest intake result
 *   新規     — create a template
 * A section shows only when it has an item, so the Draft header (select + import only) gets just the
 * first two. Stateless (open/close lives in MasterPicker). #724: rendered inside the shadcn DropdownMenu (Base UI) —
 * an item closes the menu itself; on its own (tests) it needs a `DropdownMenu` root around it.
 * 「テンプレを強化」 is offered for ANY active master (not only right after an intake); when the plan adds
 * nothing it is disabled with the reason (`planAugmentation`'s `reason`, or "nothing missing").
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BarMenuItem, BarMenuSection } from "./BarMenu";
import type { MasterEntry } from "./useMasterRegistry";
import type { AugmentPlan } from "../engine/layout-augment-plan";
import { augmentWhat } from "./augment-offer";

export interface MasterMenuProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onImport?: () => void;
  onRemake?: () => void;
  onAdjust?: () => void;
  /** 「テンプレを強化」: the ACTIVE template's plan (null = not loaded yet) and the action. Omit → hidden. */
  augment?: { plan: AugmentPlan | null; onAugment: (plan: AugmentPlan) => void };
  onShowInfo?: () => void;
  onCreate?: () => void;
  onRemove?: (id: string) => void;
}

function Section({ id, label, first, children }: { id: string; label: string; first: boolean; children: ReactNode }) {
  return (
    <BarMenuSection label={label} first={first} heading headingTestId={`master-section-${id}`} headingClassName="uppercase tracking-wide text-muted">
      {children}
    </BarMenuSection>
  );
}

function Item({ icon, label, title, testId, onClick, disabled, note }: {
  icon: string; label: string; title?: string; testId?: string; onClick: () => void; disabled?: boolean; note?: string;
}) {
  return (
    <BarMenuItem data-testid={testId} onClick={() => onClick()} title={title} disabled={disabled} className="gap-2 text-fg2">
      <span className="w-3 shrink-0 text-center self-start">{icon}</span>
      <span className="min-w-0 flex flex-col">
        <span>{label}</span>
        {note && <span className="text-[11px] text-muted whitespace-normal">{note}</span>}
      </span>
    </BarMenuItem>
  );
}

export function MasterMenu({ masters, activeId, onSelect, onImport, onRemake, onAdjust, augment, onShowInfo, onCreate, onRemove }: MasterMenuProps) {
  const { t } = useTranslation();
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
              // #724: the row highlights while either of its items (select / 🗑) has the menu's focus.
              <div key={m.id} className={`group flex items-center rounded hover:bg-edge has-[:focus]:bg-edge ${isActive ? "bg-accent/15" : ""}`}>
                <BarMenuItem
                  onClick={() => onSelect(m.id)}
                  className={`flex-1 min-w-0 pr-1 gap-2 focus:bg-transparent ${isActive ? "text-accent-soft font-medium" : "text-fg2"}`}
                >
                  <span className="w-3 shrink-0 text-center">{isActive ? "✓" : ""}</span>
                  <span className="truncate">{m.name}{m.builtin ? t("masterPicker.builtinSuffix") : ""}</span>
                </BarMenuItem>
                {onRemove && !m.builtin && (
                  // An item too (arrow keys reach it); deleting keeps the menu open, as before.
                  <BarMenuItem
                    closeOnClick={false}
                    onClick={() => onRemove(m.id)}
                    title={t("masterPicker.removeTitle")}
                    className="shrink-0 w-7 h-7 mr-1 p-0 justify-center text-xs text-muted hover:text-red-400 focus:text-red-400 focus:bg-void opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    🗑
                  </BarMenuItem>
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
        onImport && <Item key="import" icon="📥" label={t("masterPicker.importLabel")} title={t("masterPicker.importTitle")} onClick={onImport} />,
        onRemake && <Item key="remake" icon="🔁" label={t("masterPicker.remakeLabel")} title={t("masterPicker.remakeTitle")} onClick={onRemake} />,
      ].filter(Boolean),
    },
    {
      id: "modify",
      label: t("masterPicker.section.modify"),
      items: [
        onAdjust && <Item key="adjust" icon="🔤" label={t("menu.opensDialog", { title: t("masterPicker.adjustLabel") })} title={t("masterPicker.adjustTitle")} onClick={onAdjust} />,
        augment && (
          <Item
            key="augment"
            testId="master-augment"
            icon="🧩"
            label={canAugment ? t("menu.opensDialog", { title: t("masterPicker.augmentLabel", { what: augmentWhat(plan!) }) }) : t("masterPicker.augmentLabelPlain")}
            title={t("masterPicker.augmentTitle")}
            note={augmentNote}
            disabled={!canAugment}
            onClick={() => { if (canAugment) augment.onAugment(plan!); }}
          />
        ),
        onShowInfo && <Item key="info" testId="master-show-info" icon="ⓘ" label={t("masterPicker.showInfoLabel")} title={t("masterPicker.showInfoTitle")} onClick={onShowInfo} />,
      ].filter(Boolean),
    },
    {
      id: "create",
      label: t("masterPicker.section.create"),
      items: [onCreate && <Item key="create" icon="＋" label={t("menu.opensDialog", { title: t("masterPicker.createLabel") })} title={t("masterPicker.createTitle")} onClick={onCreate} />].filter(Boolean),
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
