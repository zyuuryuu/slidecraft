/**
 * ThemeToggle — a compact 3-way segmented control (Dark / Light / Modern) for the toolbar.
 * Paints with theme tokens so it restyles itself. See useTheme / index.css.
 */
import { useTheme, THEMES, type Theme } from "./useTheme";

const META: Record<Theme, { icon: string; label: string }> = {
  dark: { icon: "🌙", label: "Dark" },
  light: { icon: "☀", label: "Light" },
  modern: { icon: "◐", label: "Modern（Slate）" },
};

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center rounded-md border border-edge bg-field p-0.5" role="group" aria-label="配色モード">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          title={META[t].label}
          aria-pressed={theme === t}
          className={`px-1.5 py-0.5 rounded text-sm leading-none transition-colors ${
            theme === t ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
          }`}
        >
          {META[t].icon}
        </button>
      ))}
    </div>
  );
}
