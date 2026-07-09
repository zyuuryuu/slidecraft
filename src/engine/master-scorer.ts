/**
 * master-scorer.ts — F1-① 決定論スコアラー（master-intake.md §2 部品1・P3/P5）。
 *
 * レイアウトのテキスト保持要素（placeholders ∪ staticTexts）を、固定の Title/Body ラベル照合でなく
 * 「同一レイアウト内での相対属性（面積・フォント・位置）＋読み順」で機能推定し、confidence を付す。
 * プロトタイプは敵対 fixture で title+primary body+chrome 除外 5/5 を実証済（本モジュールはその正式化）。
 *
 * 北極星（do-no-harm）: 「重要な所（title・最大 body）は自信を持って当てる／chrome には content を
 * 入れない」。よって chrome/accent/figure を content role から分離する。閾値はスライド寸法に相対化
 * （非16:9 でも効く）。純粋（R2）。まだ binding には配線しない（②b で chrome 硬除外に使う）ため
 * 既存挙動は不変。
 */
import type { LayoutInfo } from "./template-loader";

export type ElementFunction =
  | "title"
  | "primaryBody"
  | "body"
  | "subtitle"
  | "chrome" // footer/header/date/番号 帯 — content を絶対入れない
  | "accent" // 章番号など極大フォント×極小面積の装飾
  | "figure" // 図/ヒーロー枠（巨大面積 or 視覚型）
  | "unknown";

export interface ScoredElement {
  source: "placeholder" | "static";
  idx?: string; // placeholder の idx（binding 用）
  text: string; // staticText の文言（placeholder は空のことが多い）
  fn: ElementFunction;
  confidence: number; // 0..1
  reading: number; // 読み順ランク（0=最初）
  fontSize: number;
  box: { x: number; y: number; w: number; h: number };
}

const CANON = { w: 13.333, h: 7.5 };
const VISUAL_TYPES = new Set(["pic", "chart", "tbl"]);

interface El {
  source: "placeholder" | "static";
  idx?: string;
  text: string;
  fs: number;
  x: number;
  y: number;
  w: number;
  h: number;
  visual: boolean;
}

const firstText = (xml: string): string => xml.match(/<a:t>([^<]*)</)?.[1] ?? "";
const area = (e: { w: number; h: number }) => Math.max(0, e.w) * Math.max(0, e.h);

/**
 * レイアウトの各テキスト要素に機能＋confidence を付ける。読み順（左上→右下）でソートして返す。
 * slideSize は非16:9 マスターの相対化に使う（既定＝canonical 16:9）。
 */
export function inferFunction(layout: LayoutInfo, slideSize: { w: number; h: number } = CANON): ScoredElement[] {
  const SW = slideSize.w, SH = slideSize.h, SA = SW * SH;
  const els: El[] = [
    ...layout.placeholders.map((p) => ({
      source: "placeholder" as const, idx: p.idx, text: firstText(p.shapeXml),
      fs: p.style.fontSize, x: p.style.x, y: p.style.y, w: p.style.w, h: p.style.h,
      visual: VISUAL_TYPES.has(p.type),
    })),
    ...layout.staticTexts.map((s) => ({
      source: "static" as const, text: s.text,
      fs: s.style.fontSize, x: s.style.x, y: s.style.y, w: s.style.w, h: s.style.h, visual: false,
    })),
  ].filter((e) => e.w > 0 && e.h > 0); // 幾何が無いと相対判定できない

  if (els.length === 0) return [];
  const maxFs = Math.max(1, ...els.map((e) => e.fs));

  // ── 除外規則（content role から分離）──
  const isChrome = (e: El) => e.fs <= 12 && e.h <= 0.12 * SH && (e.y <= 0.08 * SH || e.y + e.h >= 0.92 * SH);
  const isAccent = (e: El) => !isChrome(e) && e.fs >= 0.8 * maxFs && area(e) <= 0.05 * SA;
  // 図枠＝視覚型、または「巨大面積 かつ 大フォント」（通常の1カラム本文は面積大でも fs 小ゆえ除外）
  const isFigure = (e: El) => !isChrome(e) && !isAccent(e) && (e.visual || (area(e) >= 0.3 * SA && e.fs >= 20));

  // ── 読み順（y バンド → x）──
  const bandH = 0.12 * SH;
  const reading = new Map<El, number>();
  [...els]
    .sort((a, b) => Math.round(a.y / bandH) - Math.round(b.y / bandH) || a.x - b.x)
    .forEach((e, i) => reading.set(e, i));

  // ── title / primary body（相対で1つ選ぶ）──
  const titleCands = els.filter((e) => !isChrome(e) && !isAccent(e) && !isFigure(e));
  const title = titleCands.slice().sort((a, b) => b.fs - a.fs || a.y - b.y)[0]; // 最大フォント→最上段
  const bodyCands = els.filter((e) => e !== title && !isChrome(e) && !isAccent(e) && area(e) >= 0.08 * SA);
  const primary = bodyCands.slice().sort((a, b) => area(b) - area(a))[0]; // 最大面積

  const titleConfidence = (t: El): number => {
    const second = Math.max(0, ...titleCands.filter((c) => c !== t).map((c) => c.fs));
    let c = 0.5;
    if (t.fs > second) c += 0.25; // フォントが単独最大
    if (t.y <= 0.35 * SH) c += 0.15; // 上段
    return Math.min(0.95, c);
  };

  const scored: ScoredElement[] = els.map((e) => {
    let fn: ElementFunction, confidence: number;
    if (isChrome(e)) { fn = "chrome"; confidence = 0.85; }
    else if (isAccent(e)) { fn = "accent"; confidence = 0.8; }
    else if (e === title) { fn = "title"; confidence = titleConfidence(e); }
    else if (e === primary) { fn = isFigure(e) ? "figure" : "primaryBody"; confidence = 0.8; }
    else if (isFigure(e)) { fn = "figure"; confidence = 0.75; }
    else if (area(e) >= 0.08 * SA) { fn = "body"; confidence = 0.6; }
    else if (title && e.y < 0.4 * SH && e.fs < title.fs) { fn = "subtitle"; confidence = 0.5; }
    else { fn = "unknown"; confidence = 0.3; }
    return {
      source: e.source, idx: e.idx, text: e.text, fn, confidence,
      reading: reading.get(e)!, fontSize: e.fs, box: { x: e.x, y: e.y, w: e.w, h: e.h },
    };
  });

  return scored.sort((a, b) => a.reading - b.reading);
}

/** 便宜アクセサ: chrome と判定された placeholder の idx 集合（②b の硬除外で使う）。 */
export function chromePlaceholderIdxs(scored: ScoredElement[]): Set<string> {
  return new Set(scored.filter((s) => s.fn === "chrome" && s.source === "placeholder" && s.idx).map((s) => s.idx!));
}
