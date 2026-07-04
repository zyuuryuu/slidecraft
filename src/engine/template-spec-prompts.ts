/**
 * template-spec-prompts.ts — 自然言語の雰囲気/用途 → `TemplateSpec` の AI 提案（テーマ2 S5・純粋ロジック R2）。
 *
 * ADR-0005（ハーネス over モデル）: AI は配色/フォントの JSON を「提案」するだけ。検証・正規化・
 * フォールバック・コントラスト修正・PPTX 生成はすべてこちらの決定論コードが行うので、小さな
 * ローカルモデルの雑な応答でも常に使えるスペックに落ちる（使えない時だけ ok:false）。
 * 設計: docs/design/template-authoring.md S5。
 */
import { parseJsonLoose } from "./json-salvage";
import { PALETTE_KEYS, type PaletteKey } from "./template-layout-library";
import { MIDNIGHT_PALETTE, type TemplateSpec } from "./template-writer";

// ── プロンプト ──

const KEY_MEANING: Record<PaletteKey, string> = {
  background: "cover-slide background AND the header bar on content slides (usually dark or rich)",
  canvas: "content-slide background (usually white or near-white)",
  titleText: "title text, sits ON background — must contrast strongly with background",
  bodyText: "body text, sits ON canvas — must contrast strongly with canvas",
  subtle: "secondary text on background (subtitles, metadata on covers)",
  muted: "weak text on canvas (sources, page numbers)",
  accent: "primary accent (category labels, option A highlights)",
  accent2: "secondary accent (option B highlights)",
  emphasis: "big KPI numbers on canvas — must be readable on canvas",
};

/** システムプロンプト: 説明（雰囲気・用途・原稿の抜粋など）→ TemplateSpec JSON。 */
export function templateSpecSystemPrompt(): string {
  const keys = PALETTE_KEYS.map((k) => `  - "${k}": ${KEY_MEANING[k]}`).join("\n");
  return `You are a presentation design assistant. From the user's description of the desired mood, purpose, or content, propose a slide-template color scheme and fonts.

Output ONLY a single JSON object — no prose, no code fence, no explanation:

{
  "name": "template name in the user's language",
  "fonts": { "major": "heading font", "minor": "body font" },
  "palette": { "<key>": "#RRGGBB", ... all 9 keys below ... }
}

## Palette keys (all 9 required)

${keys}

## Rules

- Colors are 6-digit hex. Ensure strong contrast for the text pairs noted above (titleText vs background, bodyText vs canvas).
- Prefer widely available fonts (e.g. Georgia, Calibri, Arial, Times New Roman, Segoe UI, Meiryo, Yu Gothic, Noto Sans JP).
- Keep the palette cohesive: one hue family plus at most two accents.
- "name" should be short and evocative, in the same language as the user's request.`;
}

// ── 防御的パース ──

export type TemplateSpecParse =
  | { ok: true; spec: TemplateSpec; notices: string[] }
  | { ok: false; error: string };

/** "#1a2B3c" / "1A2B3C" → "1A2B3C"。それ以外（3桁・色名など）は null。 */
function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? m[1].toUpperCase() : null;
}

/** WCAG 相対輝度（0=黒 〜 1=白）。コントラスト・ガードの判定に使う。 */
function luminance(hex: string): number {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

/** 文字色が背景に沈んでいたら決定論修正: 暗背景→白 / 明背景→canonical の本文色。 */
function guardContrast(
  palette: Record<PaletteKey, string>,
  textKey: PaletteKey,
  bgKey: PaletteKey,
  notices: string[],
): void {
  const bg = luminance(palette[bgKey]);
  const tx = luminance(palette[textKey]);
  const ratio = (Math.max(bg, tx) + 0.05) / (Math.min(bg, tx) + 0.05);
  if (ratio >= 3) return; // 十分読める（WCAG large-text 基準）
  palette[textKey] = bg < 0.5 ? "FFFFFF" : "1E293B";
  notices.push(`${textKey} が ${bgKey} に沈むため読める色へ修正しました。`);
}

function cleanFont(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

/**
 * AI 応答 → 検証済み TemplateSpec。JSON がどこかに含まれていれば必ず使えるスペックを返す
 * （欠落/不正はフォールバック＋告知、低コントラストは決定論修正＋告知）。
 * JSON が全く見つからない時だけ ok:false。
 */
export function parseTemplateSpecResponse(raw: string): TemplateSpecParse {
  const r = parseJsonLoose(raw);
  if (!r.ok || typeof r.value !== "object" || r.value === null || Array.isArray(r.value))
    return { ok: false, error: "応答から提案 JSON を読み取れませんでした。" };
  const v = r.value as Record<string, unknown>;
  const notices: string[] = [];

  const name =
    typeof v.name === "string" && v.name.trim().length > 0 ? v.name.trim() : "AI テンプレート";
  if (name === "AI テンプレート" && v.name !== undefined) notices.push("name を既定名に置き換えました。");

  const fontsIn = (typeof v.fonts === "object" && v.fonts !== null ? v.fonts : {}) as Record<string, unknown>;
  const fonts = {
    major: cleanFont(fontsIn.major, "Georgia"),
    minor: cleanFont(fontsIn.minor, "Calibri"),
  };

  const paletteIn = (typeof v.palette === "object" && v.palette !== null ? v.palette : {}) as Record<string, unknown>;
  const palette = { ...MIDNIGHT_PALETTE };
  for (const key of PALETTE_KEYS) {
    const hex = normalizeHex(paletteIn[key]);
    if (hex) palette[key] = hex;
    else notices.push(`${key} が不正/欠落のため既定色を使います。`);
  }

  guardContrast(palette, "titleText", "background", notices);
  guardContrast(palette, "bodyText", "canvas", notices);

  return { ok: true, spec: { name, fonts, palette }, notices };
}
