/**
 * i18n/index.ts — react-i18next setup for the ja⇄en UI toggle. Bundled (no CDN → CSP-safe). The
 * chosen language persists in localStorage; Japanese is the default (initial release is JP-first).
 * Import this ONCE at the app entry (main.tsx) for its init side-effect before <App/> mounts.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ja from "./locales/ja.json";
import en from "./locales/en.json";

export type Lang = "ja" | "en";
const LANG_KEY = "slidecraft_lang";

function savedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "en" || v === "ja" ? v : "ja";
  } catch {
    return "ja";
  }
}

void i18n.use(initReactI18next).init({
  resources: { ja: { translation: ja }, en: { translation: en } },
  lng: savedLang(),
  fallbackLng: "ja", // a missing en key falls back to the Japanese string, never a raw key
  interpolation: { escapeValue: false }, // React already escapes; our strings aren't HTML
});

/** Switch the UI language and remember it. */
export function setLanguage(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode / no storage — the change still applies for this session */
  }
  void i18n.changeLanguage(lang);
}

export default i18n;
