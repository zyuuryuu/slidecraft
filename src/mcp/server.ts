/**
 * server.ts — wires the headless engine Session (session.ts) to MCP as a tight set of
 * tools. The upstream agent IS the LLM; these tools are the deterministic engine ops, so
 * the server never calls a model. v1 transport is --no-fs: bytes (the .slidecraft / .pptx)
 * flow as base64 over stdio, so the server touches NO filesystem. Every tool returns fresh
 * result JSON (incl. diagnostics) so an agent always sees current deck state. The same state is
 * also exposed read-only as MCP *resources* (deck://… , slide://{i}/markdown) via resources.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session";
import * as S from "./session";
import { registerResources } from "./resources";

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [k: string]: unknown; // match the SDK's CallToolResult (passthrough _meta etc.)
}
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown): ToolResult => ({
  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
  isError: true,
});
async function run(fn: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

export function buildServer(session: Session): McpServer {
  const server = new McpServer({ name: "slidecraft", version: "0.1.0" });
  const index = { index: z.number().int().describe("0-based slide index") };

  // ── open / read ──
  server.registerTool(
    "open_project",
    { description: "base64 の .slidecraft を開きセッションに読み込む（deck + template + catalog）", inputSchema: { dataBase64: z.string() } },
    ({ dataBase64 }) => run(() => S.openProjectBytes(session, unb64(dataBase64))),
  );
  server.registerTool(
    "new_project",
    { description: "base64 の .pptx テンプレートと（任意の）Markdown から新規プロジェクトを作る（テンプレ持ち込み＋Markdown→スライド。GUI の Draft と同じ整形）", inputSchema: { templateBase64: z.string(), markdown: z.string().optional() } },
    ({ templateBase64, markdown }) => run(() => S.newProject(session, unb64(templateBase64), markdown)),
  );
  server.registerTool("get_deck", { description: "現在の deck（DeckIR JSON）" }, () => run(() => S.getDeck(session)));
  server.registerTool("get_deck_markdown", { description: "deck 全体を round-trip 可能な Markdown で" }, () => run(() => S.getDeckMarkdown(session)));
  server.registerTool("get_slide_markdown", { description: "1スライドの Markdown（auto レイアウト解決済み）", inputSchema: index }, ({ index: i }) => run(() => S.getSlideMarkdown(session, i)));
  server.registerTool("get_deck_issues", { description: "deck の診断（split/condense/visualize/title レバー付き）" }, () => run(() => S.getDiagnostics(session)));
  server.registerTool("get_template_capabilities", { description: "テンプレートの能力サマリ＋レイアウト一覧（生成のプロンプト文脈）" }, () => run(() => S.getCatalog(session)));
  server.registerTool("get_project_info", { description: "現在のプロジェクトのメタ情報" }, () => run(() => S.getProjectMeta(session)));
  server.registerTool("get_slide_fix_request", { description: "1スライドの修正リクエスト packet（agent が LLM として埋め、set_slide_markdown で適用）", inputSchema: index }, ({ index: i }) => run(() => S.getSlideFix(session, i)));

  // ── deterministic mutations ──
  server.registerTool("set_slide_markdown", { description: "1スライドを Markdown で差し替え（zod 検証・不正は never-silent で拒否）", inputSchema: { ...index, markdown: z.string() } }, ({ index: i, markdown }) => run(() => S.applySlideMarkdown(session, i, markdown)));
  server.registerTool("set_deck_markdown", { description: "deck 全体を Markdown で差し替え", inputSchema: { markdown: z.string() } }, ({ markdown }) => run(() => S.applyDeckMarkdown(session, markdown)));
  server.registerTool("split_overflowing_slides", { description: "決定論レバー: 溢れた本文スライドをフォント縮小なしで分割" }, () => run(() => S.distill(session)));
  server.registerTool("convert_bullets_to_table", { description: "決定論レバー: key-value 箇条書きを GFM 表に", inputSchema: index }, ({ index: i }) => run(() => S.visualizeKeyValue(session, i)));
  server.registerTool(
    "set_slide_diagram",
    { description: "スライドの図を DiagramSpec(yaml/json) or Mermaid で設定（検証＋native YAML 化。図/mermaid を持つスライドのみ）", inputSchema: { ...index, source: z.string(), format: z.enum(["yaml", "json", "mermaid"]) } },
    ({ index: i, source, format }) => run(() => S.setDiagram(session, i, source, format)),
  );
  server.registerTool(
    "apply_design_intent",
    {
      description: '図に空間意図（design edit）を適用：ops 配列の JSON で regionSplit(text-left/right/diagram-only) / emphasize(nodeId) / relayout(TB/LR/RL/BT)。図/mermaid を持つスライドのみ。例: [{"op":"relayout","direction":"LR"}]',
      inputSchema: { ...index, intent: z.string() },
    },
    ({ index: i, intent }) => run(() => S.applyDesignIntent(session, i, intent)),
  );
  server.registerTool("validate_deck", { description: "deck 検証＋exportReadiness（変換不能 mermaid スキャン）" }, () => run(() => S.validate(session)));

  // ── persist / export (base64 over stdio) ──
  server.registerTool("save_project", { description: ".slidecraft を生成し base64 で返す" }, () =>
    run(async () => ({ dataBase64: b64(await S.saveProjectBytes(session)) })),
  );
  server.registerTool(
    "export_pptx",
    { description: ".pptx を native-vector で headless 生成し base64 で返す（変換不能 mermaid は default reject / skip）", inputSchema: { onUnsupportedMermaid: z.enum(["reject", "skip"]).optional() } },
    ({ onUnsupportedMermaid }) =>
      run(async () => {
        const { bytes, skipped } = await S.exportPptxBytes(session, onUnsupportedMermaid ?? "reject");
        return { dataBase64: b64(bytes), skipped };
      }),
  );

  // ── read-only deck state as MCP resources (deck://… , slide://{i}/markdown) ──
  registerResources(server, session);

  return server;
}
