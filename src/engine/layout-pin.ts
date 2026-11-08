/**
 * layout-pin.ts — 「レイアウト名の固定（pin）をこのテンプレが受けられるか」の単一の判定（R8・#637）。Pure（R2）。
 *
 * autoSelectLayout（pin を守るか degrade するか）と materializeDerivedSlides（章扉を章一覧つきレイアウトへ
 * 固定してよいか）が同じ関数で判定する — 判定が 2 経路に分かれていたため、章一覧つき章扉を持たない
 * テンプレで「選択は章扉・書き出しは本文」と食い違った（#637）。
 *
 * catalog 無し（テンプレ未指定）は pin をそのまま受ける＝テンプレ無しの経路は従来どおり。
 */
import type { LayoutCatalog } from "./template-catalog";

export function layoutPinHonored(catalog: LayoutCatalog | undefined, name: string): boolean {
  return !catalog || catalog.some((e) => e.name === name);
}
