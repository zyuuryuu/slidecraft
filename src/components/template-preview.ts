/**
 * template-preview.ts — the data path behind the TemplateCreator's in-modal LIVE preview (テーマ2 後続).
 *
 * buildTemplatePreview(spec) round-trips a TemplateSpec through the REAL engine (writeTemplate →
 * loadTemplate → distill a small sample deck) so the modal preview is WYSIWYG with the template that
 * "生成して適用" will actually produce. No DOM/Tauri here — just engine composition; the React hook
 * (useTemplatePreview) debounces regeneration so it doesn't rebuild the PPTX on every keystroke.
 */
import { useEffect, useRef, useState } from "react";
import { writeTemplate, type TemplateSpec } from "../engine/template-writer";
import { loadTemplate, type TemplateData } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { distillDeck } from "../engine/distill";
import { parseMd } from "../engine/md-parser";
import type { DeckIR } from "../engine/slide-schema";
import type { LayoutDef } from "../engine/template-layout-library";

/** Merge custom layouts onto the chosen built-ins, guaranteeing every layout name is NON-EMPTY and
 *  UNIQUE. A blank or built-in-colliding custom name would otherwise emit a duplicate/garbage-named
 *  `<p:cSld>` that the loader mis-resolves (findLayout returns the FIRST match) — so the showcase pin
 *  would render the wrong layout and the applied template would carry a name-corrupted layout. Returns
 *  the combined list plus the FINAL (disambiguated) custom names to pin showcase slides to. */
export function combineLayouts(builtins: LayoutDef[], customs: LayoutDef[]): { layouts: LayoutDef[]; customNames: string[] } {
  const taken = new Set(builtins.map((l) => l.name));
  const layouts = [...builtins];
  const customNames: string[] = [];
  customs.forEach((l, i) => {
    const base = l.name.trim() || `カスタム${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    taken.add(name);
    layouts.push({ ...l, name });
    customNames.push(name);
  });
  return { layouts, customNames };
}

/** A tiny sample that exercises a dark cover, a light content slide, and a KPI/key-value slide, so
 *  the preview shows title/body/subtle text + accents + emphasis on both family backgrounds. */
export const PREVIEW_SAMPLE_MD = [
  "# サンプルテンプレート",
  "## 配色とフォントのプレビュー",
  "",
  "---",
  "",
  "# 主要ポイント",
  "",
  "- 見出しと本文の視認性",
  "- **強調**テキストとアクセント色",
  "- 箇条書きの3行目",
  "",
  "---",
  "",
  "# 主要指標",
  "",
  "- 速度: 0.8秒",
  "- 精度: 99.2%",
  "- 稼働率: 99.9%",
].join("\n");

/** Generate the {deck, template} pair a SlidePreview renders, from a draft TemplateSpec. Pure engine
 *  composition (async because writeTemplate/loadTemplate are). Throws if the spec is unusable.
 *  `showcaseLayouts` = custom layout names to force into the preview as extra slides pinned to them
 *  (autoSelectLayout honors a pin the template actually has) — so a custom layout the sample deck's
 *  role-based selection wouldn't otherwise reach is still visible while it's being edited. */
export async function buildTemplatePreview(spec: TemplateSpec, showcaseLayouts: string[] = []): Promise<{ deck: DeckIR; template: TemplateData }> {
  const template = await loadTemplate(await writeTemplate(spec));
  const catalog = buildCatalog(template);
  const deck = distillDeck(parseMd(PREVIEW_SAMPLE_MD), catalog);
  const have = new Set(template.layouts.map((l) => l.name));
  for (const name of showcaseLayouts) {
    if (!have.has(name)) continue; // a not-yet-generated / renamed layout: skip rather than degrade
    const slide = distillDeck(parseMd(`# ${name}\n\n- 見出しと本文のサンプル\n- 箇条書き項目\n- 3行目`), catalog).slides[0];
    if (slide) deck.slides.push({ ...slide, layout: name }); // pin to the custom layout
  }
  return { deck, template };
}

export interface PreviewState {
  deck: DeckIR | null;
  template: TemplateData | null;
  error: string | null;
  busy: boolean;
}

interface Applied {
  deck: DeckIR | null;
  template: TemplateData | null;
  error: string | null;
  /** The spec `key` this result was built from — `busy` is derived by comparing it to the live key
   *  (no setState in the effect body → no cascading renders / react-hooks/set-state-in-effect). */
  appliedKey: string | null;
}

/** Debounced live preview of a draft spec. Rebuilds only when the RENDER-affecting parts change
 *  (fonts / palette / chosen layouts — the name is metadata) and only while `enabled`; a monotonic
 *  generation guard drops any stale in-flight build so the newest spec always wins. */
export function useTemplatePreview(spec: TemplateSpec, enabled: boolean, showcaseLayouts: string[] = [], debounceMs = 300): PreviewState {
  const [applied, setApplied] = useState<Applied>({ deck: null, template: null, error: null, appliedKey: null });
  // Read the latest spec at build time via a ref (synced in an effect, not during render) so the
  // build effect can key on a cheap string without re-running every render (the parent rebuilds the
  // spec object each render). The ref is always current by the time the debounced build fires.
  const specRef = useRef(spec);
  const showcaseRef = useRef(showcaseLayouts);
  useEffect(() => { specRef.current = spec; showcaseRef.current = showcaseLayouts; });
  const key = JSON.stringify({ fonts: spec.fonts, palette: spec.palette, layouts: spec.layouts ?? null, showcase: showcaseLayouts });
  const genRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const gen = ++genRef.current;
    const t = setTimeout(() => {
      buildTemplatePreview(specRef.current, showcaseRef.current)
        .then(({ deck, template }) => { if (genRef.current === gen) setApplied({ deck, template, error: null, appliedKey: key }); })
        .catch((e) => { if (genRef.current === gen) setApplied({ deck: null, template: null, error: e instanceof Error ? e.message : String(e), appliedKey: key }); });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [key, enabled, debounceMs]);

  return { deck: applied.deck, template: applied.template, error: applied.error, busy: enabled && applied.appliedKey !== key };
}
