/**
 * useGenerateSlide.ts — GUI 駆動の「便利スライドを生成」（ADR-0034 / #277）。初期タイプは目次のみ。
 * live＝derived:"toc" を挿入するだけ（materializeDerivedSlides が消費点で導出）。static＝現在の章から
 * buildStaticTocSlide で普通の編集可能スライドを1回生成して挿入。「作り直す」は同じ関数を対象スライドに
 * 再適用するだけ（明示再生成・単一経路＝R8）。src/components に置くのは insertSlideAt 呼び出しが
 * GUI の add/delete/duplicate と同じ deck-structure 経路を使うため（engine 自体は deck-sections.ts に純粋関数
 * として置く・R2）。useDeckController から呼ばれる薄い DI フック（R1 分割・useDeckIO と同型）。
 */
import { useCallback } from "react";
import type { DeckIR } from "../engine/slide-schema";
import { buildLiveTocSlide, buildStaticTocSlide } from "../engine/deck-sections";
import { insertSlideAt } from "../engine/deck-structure";
import { type HistoryMode } from "./useHistoryState";

export type GenerateSlideMode = "live" | "static";

interface GenerateSlideDeps {
  deck: DeckIR | null;
  activeSlide: number;
  setDeck: (next: DeckIR, mode?: HistoryMode) => void;
  setActiveSlide: (i: number) => void;
  setSelected: (s: Set<number>) => void;
  /** 他の構造ハンドラ（handleAddSlide 等）と同じ観測専用ロック。true の間は全ハンドラが no-op。 */
  editLockedRef: React.RefObject<boolean>;
}

export function useGenerateSlide({ deck, activeSlide, setDeck, setActiveSlide, setSelected, editLockedRef }: GenerateSlideDeps) {
  // 目次を1枚、選択中スライドの後ろに挿入する（addBlankSlide と同型：deck が無ければ1枚デッキを起こす）。
  const handleGenerateToc = useCallback(
    (mode: GenerateSlideMode) => {
      if (editLockedRef.current) return;
      const base: DeckIR = deck ?? { slides: [] };
      const slide = mode === "live" ? buildLiveTocSlide() : buildStaticTocSlide(base);
      const { deck: next, at } = insertSlideAt(base, activeSlide, slide, "after");
      setDeck(next, "commit");
      setActiveSlide(at);
      setSelected(new Set([at]));
    },
    [deck, activeSlide, setDeck, setActiveSlide, setSelected, editLockedRef],
  );

  // 「作り直す」: 選択中スライドの内容を、現在の章構成から生成した static 目次で置き換える（明示再生成）。
  const handleRegenerateStaticToc = useCallback(
    (index: number) => {
      if (editLockedRef.current || !deck || index < 0 || index >= deck.slides.length) return;
      const slides = deck.slides.map((s, i) => (i === index ? buildStaticTocSlide(deck) : s));
      setDeck({ ...deck, slides }, "commit");
    },
    [deck, setDeck, editLockedRef],
  );

  return { handleGenerateToc, handleRegenerateStaticToc };
}
