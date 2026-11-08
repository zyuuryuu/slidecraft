/**
 * HtmlTransitionPicker — the HTML export's slide-transition choice, as one compact segmented row placed right
 * under 🌐 HTML inside the File menu (#650). It used to be a hover flyout (File ▾ → 🌐 HTML ▸ → transition =
 * 3 levels), over the UX budget's nesting ≤ 2 (docs/design/ux-principles.md §3). Stateless: the File menu owns
 * the chosen value and exports with it. Same shape as ThemeToggle (role="group" + aria-pressed buttons).
 */
import { useTranslation } from "react-i18next";
import type { Transition } from "../engine/html-shell";
import { HTML_TRANSITIONS } from "./html-transitions";

interface Props {
  value: Transition;
  onChange: (v: Transition) => void;
  /** Nothing to export → the choice is inert too. */
  disabled?: boolean;
}

export default function HtmlTransitionPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 pl-8 pr-3 pb-1">
      <span className="text-faint text-xs whitespace-nowrap">{t("toolbar.transition")}</span>
      <div className="flex items-center rounded-md border border-edge bg-field p-0.5" role="group" aria-label={t("toolbar.transitionGroup")}>
        {HTML_TRANSITIONS.map(({ v, labelKey }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            disabled={disabled}
            aria-pressed={value === v}
            className={`px-1.5 py-0.5 rounded text-xs leading-none whitespace-nowrap transition-colors disabled:opacity-40 ${
              value === v ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
