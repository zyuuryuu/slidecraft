/**
 * deck-sections.ts — 章構造の導出（#151 / ADR-0032 D2）。Pure logic（R2）。
 *
 * `<!-- section -->` タグ付きスライド（章扉）から章番号（出現順）と章名（タイトル見出し）を
 * **毎回スキャンで**導出する。`<!-- toc -->` 派生スライドの内容・章扉の全章リスト再掲（#167）は
 * ここで materialize され、DeckIR には章構造の複製状態を一切持たない（R8 — stale 目次/再掲が
 * 構造的に発生しない）。
 *
 * 呼び出し規約: materializeDerivedSlides は**消費点**（PPTX export / HTML export / preview）で
 * 呼ぶ。編集状態の DeckIR は未 materialize のまま保ち、シリアライザは derived スライドを
 * `<!-- toc -->` の 1 行にのみ畳み・章扉は `<!-- section -->` タグ＋著者コンテンツのみ書き戻す
 * （md-serializer 側で保証・再掲は materialize 後にしか生まれないので漏れない）。
 */

import type { DeckIR, Paragraph, SlideIR } from "./slide-schema";
import { getPlaceholderText } from "./md-serializer-shared";
import { TITLE_NS, CONTENT_NS } from "./slide-roles";

/** 章扉の全章リスト再掲（#167）を表示する専用レイアウト（idx15=タイトル/16=補足/1=章リスト）。 */
export const SECTION_NAV_LIST_LAYOUT = "SectionNav.1TitleList.Single";

export interface SectionEntry {
  slideIndex: number; // 章扉スライドの位置（deck.slides 内）
  number: number; // 出現順の自動採番（1 始まり）
  title: string; // 章名 = 章扉のタイトル見出し（無題なら ""）
}

/** section タグ付きスライドを出現順にスキャンして採番する。 */
export function scanSections(deck: DeckIR): SectionEntry[] {
  const out: SectionEntry[] = [];
  deck.slides.forEach((slide, i) => {
    if (!slide.sectionBreak) return;
    const raw =
      getPlaceholderText(slide, TITLE_NS.title) ?? getPlaceholderText(slide, CONTENT_NS.title) ?? "";
    const title = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    out.push({ slideIndex: i, number: out.length + 1, title });
  });
  return out;
}

/**
 * スライド `slideIndex` が属する章名（フッタ自動注入用・#168・案A/chrome 経路）。
 * `scanSections` の中で `slideIndex` 以下の最後のエントリ＝所属章（章扉スライド自身を含む）。
 * 該当エントリが無い＝最初の章扉より前 → null（注入なし）。section タグ無しデッキは常に null。
 * DeckIR に複製状態を持たず、呼ぶたび再導出する（materializeDerivedSlides と同型・R8）。
 */
export function sectionFooterFor(deck: DeckIR, slideIndex: number): string | null {
  let current: SectionEntry | null = null;
  for (const s of scanSections(deck)) {
    if (s.slideIndex > slideIndex) break;
    current = s;
  }
  return current ? current.title : null;
}

/** 章一覧 → 目次の本文段落（`1. 章名` の箇条書き）。 */
export function tocParagraphs(sections: SectionEntry[]): Paragraph[] {
  return sections.map((s) => ({
    segments: [{ text: `${s.number}. ${s.title}` }],
    bullet: true,
  }));
}

/** 目次スライドの派生タイトル。導出専用スライドの見出しで、md へは書き戻されない。 */
export const TOC_TITLE = "目次";

/** 章一覧 → 章扉の再掲用段落（`1. 章名` の箇条書き・現在章のみ bold で強調）。 */
export function sectionNavParagraphs(sections: SectionEntry[], currentNumber: number): Paragraph[] {
  return sections.map((s) => ({
    segments: [{ text: `${s.number}. ${s.title}`, bold: s.number === currentNumber }],
    bullet: true,
  }));
}

/** このスライドの本文（idx "1"）が既に何かで占有されているか — テキスト／図／表／コード／画像。
 *  占有済みなら再掲リストは注入しない（no-silent-drop: 著者コンテンツを上書きしない、ADR-0030）。 */
function usesBodyIdx1(slide: SlideIR): boolean {
  if (slide.placeholders.some((p) => p.idx === "1")) return true;
  return [slide.diagram, slide.mermaidBlock, slide.table, slide.code, slide.image].some(
    (b) => b && (b.placeholderIdx ?? "1") === "1",
  );
}

/**
 * derived スライド（"toc"）の導出内容 ＋ 章扉（sectionBreak）の全章リスト再掲（#167）を埋めた
 * 新しい DeckIR を返す。対象スライドが無ければ**同一参照**を返す＝宣言なしデッキは新コードパスに
 * 入らない。章扉の再掲は `layout: "auto"` かつ本文（idx 1）が空のスライドにのみ注入する — 著者が
 * レイアウトをピンした、または既に本文を書いている章扉は変更しない（安全側に倒す）。
 */
export function materializeDerivedSlides(deck: DeckIR): DeckIR {
  const hasToc = deck.slides.some((s) => s.derived === "toc");
  const hasSections = deck.slides.some((s) => s.sectionBreak);
  if (!hasToc && !hasSections) return deck;
  const sections = scanSections(deck);
  return {
    ...deck,
    slides: deck.slides.map((slide, i) => {
      if (slide.derived === "toc") {
        return {
          ...slide,
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: TOC_TITLE }] }] },
            ...(sections.length > 0 ? [{ idx: "1", paragraphs: tocParagraphs(sections) }] : []),
          ],
        };
      }
      if (slide.sectionBreak && slide.layout === "auto" && !usesBodyIdx1(slide)) {
        const current = sections.find((s) => s.slideIndex === i);
        if (current) {
          return {
            ...slide,
            layout: SECTION_NAV_LIST_LAYOUT,
            placeholders: [...slide.placeholders, { idx: "1", paragraphs: sectionNavParagraphs(sections, current.number) }],
          };
        }
      }
      return slide;
    }),
  };
}
