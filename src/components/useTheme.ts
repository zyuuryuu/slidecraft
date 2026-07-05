/**
 * useTheme — the app color theme (Dark / Light / Modern). The active theme is a `data-theme`
 * attribute on <html> that swaps the CSS-variable palette (see index.css); this hook reads/sets it
 * and persists to localStorage. main.tsx applies the saved theme before first paint (no flash), so
 * the hook just mirrors + updates it — no mount effect needed.
 */
import { useState, useCallback } from "react";

export type Theme = "dark" | "light" | "modern";
export const THEMES: Theme[] = ["dark", "light", "modern"];
const KEY = "slidecraft_theme";

function current(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "modern" ? t : "dark";
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState<Theme>(current);
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    set(t);
  }, []);
  return [theme, setTheme];
}
