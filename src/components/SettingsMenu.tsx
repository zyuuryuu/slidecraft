/**
 * SettingsMenu.tsx — the ⚙ button at the right end of the top bar (#614). The top bar holds only the
 * DOCUMENT's operations (undo/redo · file · draft · master · AI); the APP's settings live here:
 * language (JA/EN), color theme (Dark/Light/Modern), help (the docs site) and the AI connection settings
 * (the same popover the AI dock's status pill opens). The toggles are the existing LanguageToggle /
 * ThemeToggle, re-homed unchanged — behaviour and persistence are theirs.
 * #724: the menu is the shadcn DropdownMenu (Base UI). An item closes the menu itself; the two toggle rows are
 * not items (arrow keys skip them, Tab reaches them) — choosing a language / theme keeps the menu open.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "./LanguageToggle";
import ThemeToggle from "./ThemeToggle";
import BarTip from "./BarTip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BarMenuContent, BarMenuItem, BarMenuSection } from "./BarMenu";
import { BAR_HOVER } from "./bar-button";

interface SettingsPanelProps {
  /** Help → docs site (issue #114). Omit → no help entry. */
  onHelp?: () => void;
  /** Open the AI dock with its connection settings. Omit → no AI entry. */
  onAiSettings?: () => void;
}

/** The menu body (rendered inside the DropdownMenu; on its own it needs a `DropdownMenu` root around it). */
export function SettingsPanel({ onHelp, onAiSettings }: SettingsPanelProps) {
  const { t } = useTranslation();
  const row = "flex items-center justify-between gap-3 px-2.5 py-1.5";
  return (
    <>
      {/* #674: each section is a role="group" (as in the master menu) so the UX budget counts it (≤ 7 items).
          A toggle is a segment row (one choice = one item), not a section of its own. */}
      <BarMenuSection label={t("settings.displaySection")} first>
        <div className={row}>
          <span className="text-xs text-muted">{t("settings.language")}</span>
          <LanguageToggle />
        </div>
        <div className={row}>
          <span className="text-xs text-muted">{t("settings.theme")}</span>
          <ThemeToggle />
        </div>
      </BarMenuSection>
      {(onHelp || onAiSettings) && (
        <BarMenuSection label={t("settings.aiHelpSection")} first={false}>
          {onAiSettings && (
            <BarMenuItem onClick={() => onAiSettings()}>
              ✨ {t("menu.opensDialog", { title: t("aiSettings.title") })}
            </BarMenuItem>
          )}
          {onHelp && (
            <BarMenuItem onClick={() => onHelp()} title={t("toolbar.help")}>
              ? {t("settings.help")}
            </BarMenuItem>
          )}
        </BarMenuSection>
      )}
    </>
  );
}

export default function SettingsMenu(props: SettingsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <BarTip label={t("settings.buttonTitle")}>
        <DropdownMenuTrigger
          render={<Button variant="secondary" size="icon" className={`font-normal ${BAR_HOVER}`} />}
          data-testid="settings-button"
          aria-label={t("settings.title")}
          aria-expanded={open}
        >
          ⚙
        </DropdownMenuTrigger>
      </BarTip>
      <BarMenuContent align="end" className="w-auto min-w-[240px]">
        <SettingsPanel {...props} />
      </BarMenuContent>
    </DropdownMenu>
  );
}
