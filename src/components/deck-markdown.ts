/**
 * deck-markdown.ts — GUI の deck-level Markdown readout（ADR-0030 段階B, Issue #155）。
 *
 * components の deck→Markdown はすべてここを通る: serializeMd に SerializeTemplate
 * （catalog + layouts = 束縛 authority）を渡し、readout が export/preview の実束縛と
 * 乖離しない（#144: catalog なしの auto 解決が canonical fallback 名に落ち、closing 語彙
 * スライドのタイトルが title 名前空間の誤読で消えた）。テンプレ未ロード時は tpl なし
 * ＝旧経路 byte-identical。純粋関数（React なし）なのでテストが直接駆動できる。
 */

import { serializeMd, type SerializeTemplate } from "../engine/md-serializer";
import { buildCatalog, type LayoutCatalog } from "../engine/template-catalog";
import type { TemplateData } from "../engine/template-loader";
import type { DeckIR, SlideIR } from "../engine/slide-schema";

/** GUI が保持する catalog + templateData → serializeMd の束縛 authority。どちらか欠けると
 *  undefined（＝旧経路）: 片方だけで束縛を再構成しない（no-silent-drop より do-no-harm）。 */
export function serializeTpl(
  catalog: LayoutCatalog | undefined,
  templateData: TemplateData | null | undefined,
): SerializeTemplate | undefined {
  return catalog && templateData ? { catalog, layouts: templateData.layouts } : undefined;
}

/** アクティブ文書の deck-level readout（Markdown ビュー同期・保存・AI 系 before/after）。 */
export function deckMarkdown(
  deck: DeckIR,
  catalog: LayoutCatalog | undefined,
  templateData: TemplateData | null | undefined,
): string {
  return serializeMd(deck, serializeTpl(catalog, templateData));
}

/** per-slide readout（collab 送信・per-slide エディタ / AiPanel 入力・変更プレビュー・→表, #159）。
 *  layout は呼び手が解決済みのものを渡す — auto の解決規則がサイトごとに違う（エディタ系は無条件
 *  resolve で不在 pin を実レイアウトに落とす／collab 送信・→表 は auto のみ resolve）ため。 */
export function slideMarkdown(
  slide: SlideIR,
  catalog: LayoutCatalog | undefined,
  templateData: TemplateData | null | undefined,
): string {
  return serializeMd({ slides: [slide] }, serializeTpl(catalog, templateData));
}

/** まだ文書ストアに入っていない template（.scft オープン直後）の readout — アクティブ文書の
 *  catalog は別テンプレのものなので使えない。開いた template 自身から catalog を組む
 *  （mcp/session の openProjectBytes と同じ形）。 */
export function deckMarkdownForTemplate(deck: DeckIR, template: TemplateData): string {
  return serializeMd(deck, { catalog: buildCatalog(template), layouts: template.layouts });
}
