/**
 * slide-markers.ts — `<!-- statement -->` / `<!-- quote -->` のスライド属性マーカー（#593・#403 合流）。
 *
 * 統括裁定（PR #607）で、マーカーは SlideIR.groupKind の enum 値として載せる（compare #396・
 * beforeAfter #402 と同じ optional の enum 追加）。ただし statement / quote は「グループ」ではない:
 * 本文を `<!-- … -->` で区切る区切り記号ではなく、スライド全体に付く属性（`<!-- section -->` と同類）。
 * よって groupKind を「グループかどうか」に使う箇所は isGroupedSlide で判定する（区切り記号の書き戻し・
 * plan 読み出しの除外など）。グループ専用の束縛（expandGroups）はレイアウトがグループ型のときだけ動き、
 * Statement / Quote レイアウトはグループ型ではないので、通常の束縛（resolveBinding）で入る。
 *
 * Pure（R2）。
 */
import type { SlideIR } from "./slide-schema";

export type SlideMarkerKind = "statement" | "quote";
const MARKER_KINDS: ReadonlySet<string> = new Set<SlideMarkerKind>(["statement", "quote"]);

/** The marker line: `<!-- statement -->` / `<!-- quote -->` (whole trimmed line, nothing else). */
const MARKER_RE = /^<!--\s*(statement|quote)\s*-->$/;

/** An attribution line of a quote: starts with an em dash `—`, a horizontal bar `―`, or `--`. */
const ATTRIBUTION_RE = /^(?:—|―|--)/;

/** The marker kind a slide carries (statement / quote), else undefined. */
export function slideMarker(slide: Pick<SlideIR, "groupKind">): SlideMarkerKind | undefined {
  const k = slide.groupKind;
  return k && MARKER_KINDS.has(k) ? (k as SlideMarkerKind) : undefined;
}

/** True iff the slide is a real repeated GROUP (card/step/kpi/compare/beforeAfter) — groupKind set and
 *  NOT a statement/quote marker. Callers that treat groupKind as "columns split by separators" use this. */
export function isGroupedSlide(slide: Pick<SlideIR, "groupKind">): boolean {
  return !!slide.groupKind && !slideMarker(slide);
}

/** The line the serializer writes back for a marker slide (the parser's inverse). */
export function markerLine(kind: SlideMarkerKind): string {
  return `<!-- ${kind} -->`;
}

/**
 * Remove fence-external marker lines (anywhere in the block — like `<!-- section -->`) and report the
 * FIRST marker's kind. Fence-aware so a marker-looking line inside ``` stays code.
 */
export function extractSlideMarker(lines: string[]): { content: string[]; marker?: SlideMarkerKind } {
  let marker: SlideMarkerKind | undefined;
  let inFence = false;
  const content = lines.filter((ln) => {
    const t = ln.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      return true;
    }
    const m = inFence ? null : t.match(MARKER_RE);
    if (!m) return true;
    marker ??= m[1] as SlideMarkerKind;
    return false;
  });
  return { content, marker };
}

/** A quote's attribution (統括裁定): the LAST non-blank line, when it starts with —/―/-- and is not
 *  inside a ``` fence. Returned verbatim (dash kept — it is how the line reads on the slide, and keeps
 *  the round-trip trivial); `content` is the block without it. No such line → content unchanged. */
export function splitQuoteAttribution(lines: string[]): { content: string[]; attribution?: string } {
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  if (last < 0 || !ATTRIBUTION_RE.test(lines[last].trim())) return { content: lines };
  const fences = lines.slice(0, last).filter((l) => l.trim().startsWith("```")).length;
  if (fences % 2 === 1) return { content: lines }; // the line is inside an (unclosed) fence → code
  return { content: lines.slice(0, last), attribution: lines[last].trim() };
}
