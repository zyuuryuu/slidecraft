/**
 * i18next.d.ts — make `t("…")` type-safe: keys are checked against ja.json at compile time, and a
 * missing/renamed key is a build error (not a silent raw-key render). ja is the source of truth for
 * the key SET; en mirrors it (a missing en key falls back to ja at runtime via fallbackLng).
 */
import "i18next";
import type ja from "./locales/ja.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof ja };
  }
}
