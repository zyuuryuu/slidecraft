/**
 * deck-sections.ts — 章構造の導出（#151 / ADR-0032 D2）。Pure logic（R2）。
 *
 * `<!-- section -->` タグ付きスライド（章扉）から章番号（出現順）と章名（タイトル見出し）を
 * **毎回スキャンで**導出する。`<!-- toc -->` 派生スライドの内容はここで materialize され、
 * DeckIR には章構造の複製状態を一切持たない（R8 — stale 目次が構造的に発生しない）。
 *
 * 呼び出し規約: materializeDerivedSlides は**消費点**（PPTX export / HTML export / preview）で
 * 呼ぶ。編集状態の DeckIR は未 materialize のまま保ち、シリアライザは derived スライドを
 * `<!-- toc -->` の 1 行にのみ畳む（md-serializer 側で保証）ので、導出内容はどこにも永続しない。
 */

import type { DeckIR, Paragraph } from "./slide-schema";
import { getPlaceholderText } from "./md-serializer-shared";
import { TITLE_NS, CONTENT_NS } from "./slide-roles";

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

/**
 * derived スライド（現状 "toc" のみ）に導出内容を埋めた新しい DeckIR を返す。
 * 派生スライドが無ければ**同一参照**を返す＝宣言なしデッキは新コードパスに入らない。
 */
export function materializeDerivedSlides(deck: DeckIR): DeckIR {
  if (!deck.slides.some((s) => s.derived === "toc")) return deck;
  const sections = scanSections(deck);
  return {
    ...deck,
    slides: deck.slides.map((slide) =>
      slide.derived === "toc"
        ? {
            ...slide,
            placeholders: [
              { idx: "15", paragraphs: [{ segments: [{ text: TOC_TITLE }] }] },
              ...(sections.length > 0 ? [{ idx: "1", paragraphs: tocParagraphs(sections) }] : []),
            ],
          }
        : slide,
    ),
  };
}
