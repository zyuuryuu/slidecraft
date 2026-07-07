/**
 * ThemeToggle — a compact 3-way segmented control (Dark / Light / Modern) for the toolbar.
 * Paints with theme tokens so it restyles itself. See useTheme / index.css.
 */
import { useTranslation } from "react-i18next";
import { useTheme, THEMES, type Theme } from "./useTheme";

const META: Record<Theme, { icon: string }> = {
  dark: { icon: "🌙" },
  light: { icon: "☀" },
  modern: { icon: "◐" },
};

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center rounded-md border border-edge bg-field p-0.5" role="group" aria-label={t("themeToggle.groupLabel")}>
      {THEMES.map((th) => (
        <button
          key={th}
          type="button"
          onClick={() => setTheme(th)}
          title={t(`themeToggle.${th}`)}
          aria-pressed={theme === th}
          className={`px-1.5 py-0.5 rounded text-sm leading-none transition-colors ${
            theme === th ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
          }`}
        >
          {META[th].icon}
        </button>
      ))}
    </div>
  );
}
