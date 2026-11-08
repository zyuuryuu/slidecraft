/**
 * slide-marker-hint.ts — 診断 `marker-layout-missing`（#593）の判定と文面。deck-diagnostics.ts から R1 で分離
 * （layout-augment-plan.columnAugmentHint と同じ「判定＋文面を返す関数」の形）。Pure（R2）。
 *
 * `<!-- statement -->` / `<!-- quote -->` のスライドが、その役割のレイアウトに届かなかった（テンプレに無い）
 * ことを never-silent に告げる。判定は export が描くのと同じ解決（autoSelectLayout）から読む（R8）ので、
 * 退化先の名前も実際に使われるものになる。テンプレにある pin はマーカーより優先する仕様なので告げない。
 */
import type { SlideIR } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { autoSelectLayout } from "./template-loader";
import { slideMarker } from "./slide-markers";

export function markerLayoutMissingHint(slide: SlideIR, slideIndex: number, totalSlides: number, catalog: LayoutCatalog): string | undefined {
  const marker = slideMarker(slide);
  if (!marker || catalog.length === 0) return undefined;
  const resolved = autoSelectLayout(slide, slideIndex, totalSlides, catalog);
  if (resolved === slide.layout || catalog.find((e) => e.name === resolved)?.role === marker) return undefined;
  return `<!-- ${marker} --> に対応するレイアウト（役割 ${marker}）がこのテンプレにありません。「${resolved}」で代替しました`;
}
