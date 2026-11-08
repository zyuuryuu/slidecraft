/**
 * html-transitions.ts — the HTML export's transition choices (#650), in display order (slide = default).
 * `labelKey` is a toolbar-namespace i18n key resolved at render time (`as const` keeps it a valid t() key).
 * Used by HtmlTransitionPicker (the File menu row); kept apart so that component file exports only a component.
 */
import type { Transition } from "../engine/html-shell";

export const HTML_TRANSITIONS = [
  { v: "slide", labelKey: "toolbar.transitionSlide" },
  { v: "fade", labelKey: "toolbar.transitionFade" },
  { v: "zoom", labelKey: "toolbar.transitionZoom" },
  { v: "push", labelKey: "toolbar.transitionPush" },
] as const satisfies ReadonlyArray<{ v: Transition; labelKey: string }>;
