/**
 * visual-tools.ts — the AI's VISUAL read tools (split out of server.ts for R1): the current drawing
 * of one slide (#109 PNG / #242 HTML) and of the whole deck as ONE contact sheet (#522). All four
 * ride the single shared rendering `renderSlideHtml` (SlideCard SSR, fonts embedded — the same
 * painter as the preview and the HTML export, R8) and the same confined headless rasterizer.
 * Tool-only (no deck:// mirror for the images): ADR-0008's dual-read rule serves STATE reads;
 * tools/call is the one universally supported channel and binary resources have patchier support.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session";
import { rasterizeSlide, renderSlideHtml, rasterizeDeck, renderDeckHtml, DECK_SHEET } from "./slide-raster";
import { run, fail } from "./tool-result";

export interface VisualToolDeps {
  /** server.ts's gated registrar (tool-profiles) — registration order is preserved by the call site. */
  tool: McpServer["registerTool"];
  /** explicit docId → active doc → sole doc (server.ts's resolution; never-silent otherwise). */
  sessionOf: (extra: unknown, docId?: string) => Session;
  index: { index: z.ZodNumber };
  doc: { docId: z.ZodOptional<z.ZodString> };
}

export function registerVisualTools({ tool, sessionOf, index, doc }: VisualToolDeps): void {
  // #109: the AI's visual design check — screenshot the SHARED HTML rendering (SlideCard SSR,
  // fonts embedded) in a locally installed headless Chrome/Edge, network-dead and script-free.
  tool(
    "get_slide_image",
    { description: "1スライドの現在の描画を PNG で返す（AI の視覚デザインチェック用）。共有 HTML 描画（フォント埋め込み済・preview/HTML 書き出しと同一）をローカルの Chrome/Edge で画面なし・ネット遮断・使い捨てプロファイルで撮影。ブラウザ未検出時は環境変数 SLIDECRAFT_BROWSER でパス指定。deck 全枚をまとめて見るなら get_deck_image", inputSchema: { ...index, ...doc } },
    async (a, extra) => {
      try {
        const img = await rasterizeSlide(sessionOf(extra, a.docId), a.index);
        return { content: [{ type: "image" as const, data: img.pngBase64, mimeType: img.mimeType }] };
      } catch (e) {
        return fail(e);
      }
    },
  );
  // #242: same shared rendering as get_slide_image, minus the local-browser requirement — the caller
  // rasterizes with its own means (CI/sandboxes often have no Chrome/Edge). R8: no second render
  // path — `renderSlideHtml` IS the exact page get_slide_image screenshots.
  tool(
    "get_slide_html",
    { description: "1スライドの現在の描画を自己完結 HTML 文字列で返す（get_slide_image と同一の共有 HTML＝script ゼロ・CSP・フォント埋め込み済）。ローカルに Chrome/Edge が無い環境向け：呼び出し側の任意の手段でラスタ化できる", inputSchema: { ...index, ...doc } },
    (a, extra) => run(() => renderSlideHtml(sessionOf(extra, a.docId), a.index)),
  );
  // #522 (ADR-0037 D3, hot loop): the WHOLE deck as ONE contact sheet — the finishing check that
  // used to cost one get_slide_image per slide (29 calls measured in #516) becomes one round trip.
  // Each cell is renderSlideHtml's exact body laid out in a grid and shot ONCE by the same
  // rasterizer (R8: no compositing library, no second render path). Cells are labeled with the
  // 0-based index every other slide tool takes.
  const sheet = {
    start: z.number().int().optional().describe("先頭スライド（0-based・既定 0）"),
    columns: z.number().int().optional().describe(`格子の列数（既定 ${DECK_SHEET.columns}・枚数が少なければ列数も縮む）`),
    maxSlides: z.number().int().optional().describe(`この 1 枚に載せる最大枚数（既定 ${DECK_SHEET.maxSlides}・超過分は truncated:true と nextStart で続きを取る）`),
    ...doc,
  };
  tool(
    "get_deck_image",
    { description: `deck 全枚（または start からの範囲）の現在の描画を 1 枚の PNG（格子サムネイル・各セル左上に 0-based index）で返す＝仕上がり確認は最後にこれを 1 回。各セルは get_slide_image と同一の共有描画の縮小（既定 ${DECK_SHEET.columns} 列・最大 ${DECK_SHEET.maxSlides} 枚・幅 ${DECK_SHEET.maxWidth}px）。細部を読むなら get_slide_image(index)。ブラウザ要件は get_slide_image と同じ`, inputSchema: sheet },
    async (a, extra) => {
      try {
        const img = await rasterizeDeck(sessionOf(extra, a.docId), { start: a.start, columns: a.columns, maxSlides: a.maxSlides });
        const { from, count, total, columns, width, height, truncated } = img;
        const meta = { from, count, total, columns, width, height, truncated, ...(truncated ? { nextStart: from + count } : {}) };
        return {
          content: [
            { type: "image" as const, data: img.pngBase64, mimeType: img.mimeType },
            { type: "text" as const, text: JSON.stringify(meta) },
          ],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
  tool(
    "get_deck_html",
    { description: "get_deck_image と同一のコンタクトシートを自己完結 HTML 文字列で返す（script ゼロ・CSP・フォント埋め込み済）＝ローカルに Chrome/Edge が無い環境向け。{html, from, count, total, columns, width, height, truncated}", inputSchema: sheet },
    (a, extra) =>
      run(() => {
        const { html, meta } = renderDeckHtml(sessionOf(extra, a.docId), { start: a.start, columns: a.columns, maxSlides: a.maxSlides });
        const { from, count, total, columns, width, height, truncated } = meta;
        return { html, from, count, total, columns, width, height, truncated, ...(truncated ? { nextStart: from + count } : {}) };
      }),
  );
}
