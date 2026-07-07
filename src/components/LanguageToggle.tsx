/**
 * LanguageToggle — a compact JA / EN segmented control for the toolbar (mirrors ThemeToggle).
 * Switches the react-i18next language and persists it (see src/i18n).
 */
import { useTranslation } from "react-i18next";
import { setLanguage, type Lang } from "../i18n";

const LANGS: { code: Lang; label: string }[] = [
  { code: "ja", label: "JA" },
  { code: "en", label: "EN" },
];

export default function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const cur: Lang = i18n.language === "en" ? "en" : "ja";
  return (
    <div className="flex items-center rounded-md border border-edge bg-field p-0.5" role="group" aria-label={t("lang.aria")}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          aria-pressed={cur === l.code}
          className={`px-1.5 py-0.5 rounded text-xs font-medium leading-none transition-colors ${
            cur === l.code ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
