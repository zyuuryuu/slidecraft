/**
 * SettingsMenu.tsx — the ⚙ button at the right end of the top bar (#614). The top bar holds only the
 * DOCUMENT's operations (undo/redo · file · draft · master · AI); the APP's settings live here:
 * language (JA/EN), color theme (Dark/Light/Modern), help (the docs site) and the AI connection settings
 * (the same popover the AI dock's status pill opens). The toggles are the existing LanguageToggle /
 * ThemeToggle, re-homed unchanged — behaviour and persistence are theirs.
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "./LanguageToggle";
import ThemeToggle from "./ThemeToggle";

interface SettingsPanelProps {
  /** Close the menu (called after an entry that navigates away — help / AI connection settings). */
  onClose: () => void;
  /** Help → docs site (issue #114). Omit → no help entry. */
  onHelp?: () => void;
  /** Open the AI dock with its connection settings. Omit → no AI entry. */
  onAiSettings?: () => void;
}

/** The menu body — stateless (open/close is SettingsMenu's), so it renders on its own for tests. */
export function SettingsPanel({ onClose, onHelp, onAiSettings }: SettingsPanelProps) {
  const { t } = useTranslation();
  const row = "flex items-center justify-between gap-3 px-3 py-1.5";
  const item = "w-full px-3 py-1.5 text-left text-fg hover:bg-edge";
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div>
      {/* #674: each section is a role="group" (as in the master menu) so the UX budget counts it (≤ 7 items).
          A toggle is a segment row (one choice = one item), not a section of its own. */}
      <div role="group" aria-label={t("settings.displaySection")}>
        <div className={row}>
          <span className="text-xs text-muted">{t("settings.language")}</span>
          <LanguageToggle />
        </div>
        <div className={row}>
          <span className="text-xs text-muted">{t("settings.theme")}</span>
          <ThemeToggle />
        </div>
      </div>
      {(onHelp || onAiSettings) && (
        <div role="group" aria-label={t("settings.aiHelpSection")}>
          <div className="my-1 border-t border-edge" />
          {onAiSettings && (
            <button type="button" onClick={run(onAiSettings)} className={item}>
              ✨ {t("menu.opensDialog", { title: t("aiSettings.title") })}
            </button>
          )}
          {onHelp && (
            <button type="button" onClick={run(onHelp)} title={t("toolbar.help")} className={item}>
              ? {t("settings.help")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsMenu(props: Omit<SettingsPanelProps, "onClose">) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape (same as MasterPicker).
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

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        data-testid="settings-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("settings.title")}
        aria-haspopup="true"
        aria-expanded={open}
        title={t("settings.buttonTitle")}
        className="px-2.5 py-1.5 text-sm bg-edge hover:bg-accent/40 text-fg rounded transition-colors"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[240px] bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
          <SettingsPanel {...props} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
