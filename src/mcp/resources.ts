/**
 * resources.ts — exposes the live deck as MCP *resources* (read-only state) next to the tools
 * in server.ts. An agent can `resources/read deck://current` instead of calling a get_* tool —
 * the idiomatic MCP shape for "current state". Same engine Session, so a resource ALWAYS
 * reflects the latest mutation (no caching). Reading before a project is open surfaces the
 * engine's "not opened" error rather than a fake-empty deck (never-silent).
 *
 * Pure wiring: depends only on the session handlers (src/engine via session.ts).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./session";
import * as S from "./session";

type ReadResult = { contents: { uri: string; mimeType?: string; text: string }[] };
const asJson = (uri: URL, data: unknown): ReadResult => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});
const asMd = (uri: URL, text: string): ReadResult => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
});

export function registerResources(server: McpServer, session: Session): void {
  // ── whole-deck state (mirror the get_* tools, addressable as resources) ──
  server.registerResource(
    "deck-current",
    "deck://current",
    { title: "現在の deck", description: "DeckIR（構造化 JSON）。最新の編集を反映", mimeType: "application/json" },
    (uri) => asJson(uri, S.getDeck(session)),
  );
  server.registerResource(
    "deck-markdown",
    "deck://markdown",
    { title: "deck 全体の Markdown", description: "round-trip 可能な deck 全体の Markdown", mimeType: "text/markdown" },
    (uri) => asMd(uri, S.getDeckMarkdown(session)),
  );
  server.registerResource(
    "deck-issues",
    "deck://issues",
    { title: "deck の診断", description: "CONTENT レバー（split/condense/visualize/title）付きの課題一覧＋本文 budget（このテンプレの容量: maxBullets/charsPerBullet）", mimeType: "application/json" },
    (uri) => asJson(uri, S.getDiagnostics(session)),
  );
  server.registerResource(
    "deck-capabilities",
    "deck://capabilities",
    { title: "テンプレートの能力", description: "レイアウト一覧＋能力サマリ（生成のプロンプト文脈）", mimeType: "application/json" },
    (uri) => asJson(uri, S.getCatalog(session)),
  );
  server.registerResource(
    "deck-info",
    "deck://info",
    { title: "プロジェクト情報", description: "テンプレート名・スライド数・dirty 等", mimeType: "application/json" },
    (uri) => asJson(uri, S.getProjectMeta(session)),
  );

  // ── per-slide Markdown, addressable by index ── listed dynamically from the OPEN deck so an
  // agent discovers slide://0/markdown … slide://N/markdown (empty until a project is opened).
  server.registerResource(
    "slide-markdown",
    new ResourceTemplate("slide://{index}/markdown", {
      list: () => {
        let count = 0;
        try {
          count = S.getDeck(session).slides.length;
        } catch {
          count = 0; // no project open yet → nothing to list
        }
        return {
          resources: Array.from({ length: count }, (_, i) => ({
            uri: `slide://${i}/markdown`,
            name: `slide ${i} markdown`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { title: "スライドの Markdown", description: "1スライドの Markdown（auto レイアウト解決済み）。slide://{index}/markdown", mimeType: "text/markdown" },
    (uri, { index }) => {
      const raw = Array.isArray(index) ? index[0] : index;
      return asMd(uri, S.getSlideMarkdown(session, Number(raw)));
    },
  );
}
