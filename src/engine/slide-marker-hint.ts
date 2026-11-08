/**
 * slide-marker-hint.ts — 診断 `marker-layout-missing`（#593）の判定と文面。deck-diagnostics.ts から R1 で分離
 * （layout-augment-plan.columnAugmentHint と同じ「判定＋文面を返す関数」の形）。Pure（R2）。
 *
 * `<!-- statement -->` / `<!-- quote -->` のスライド、および `<!-- section -->` の章扉（#662）が、その役割の
 * レイアウトに届かなかった（テンプレに無い）ことを never-silent に告げる。判定は export が描くのと同じ解決
 * （autoSelectLayout）から読む（R8）ので、退化先の名前も実際に使われるものになる。章扉かどうかは
 * deck-sections.isSectionDivider、届いたかどうかは解決先の catalog role（section）だけで判定する。
 * テンプレにある pin はマーカーより優先する仕様なので告げない（materialize が章一覧つき章扉へ固定した
 * スライドもここで除かれる）。
 */
import type { SlideIR } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { autoSelectLayout } from "./template-loader";
import { slideMarker } from "./slide-markers";
import { isSectionDivider } from "./deck-sections";

export function markerLayoutMissingHint(slide: SlideIR, slideIndex: number, totalSlides: number, catalog: LayoutCatalog): string | undefined {
  const marker = slideMarker(slide) ?? (isSectionDivider(slide) ? "section" : undefined);
  if (!marker || catalog.length === 0) return undefined;
  const resolved = autoSelectLayout(slide, slideIndex, totalSlides, catalog);
  if (resolved === slide.layout) return undefined;
  const role = catalog.find((e) => e.name === resolved)?.role;
  if (role === marker) return undefined;
  if (marker === "section") {
    const kind = role === "content" ? "本文レイアウト" : "レイアウト";
    return `章扉（<!-- section -->）のレイアウト（役割 section）がこのテンプレに無いので、${kind}「${resolved}」に置きました`;
  }
  return `<!-- ${marker} --> に対応するレイアウト（役割 ${marker}）がこのテンプレにありません。「${resolved}」で代替しました`;
}
