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

/** Build options. `onMutate` fires AFTER a mutating tool actually changed the deck — the seam
 *  the collab host (P2) uses to bump rev + broadcast deckChanged. stdio/cli passes nothing, so
 *  the seam is a no-op and behavior is identical. `registerResources:false` drops the deck://
 *  resources in host mode (orphaned for the GUI-hosted vision). */
export interface BuildServerOptions {
  onMutate?: (tool: string) => void;
  registerResources?: boolean;
}

export function buildServer(session: Session, opts: BuildServerOptions = {}): McpServer {
  const server = new McpServer({ name: "slidecraft", version: "0.1.0" });
  const index = { index: z.number().int().describe("0-based slide index") };

  // Like run(), but fires onMutate(tool) when the engine actually mutated — i.e. NOT when the
  // handler returned {ok:false} (a never-silent validation reject changes nothing). Used ONLY
  // for the 8 mutating tools; reads keep plain run() so a get_* never triggers a broadcast.
  const runMut = async (tool: string, fn: () => unknown | Promise<unknown>): Promise<ToolResult> => {
    try {
      const v = await fn();
      if (!(v && typeof v === "object" && (v as { ok?: unknown }).ok === false)) opts.onMutate?.(tool);
      return ok(v);
    } catch (e) {
      return fail(e);
    }
  };

  // ── open / read ──
  server.registerTool(
    "open_project",
    { description: "base64 の .slidecraft を開きセッションに読み込む（deck + template + catalog）", inputSchema: { dataBase64: z.string() } },
    ({ dataBase64 }) => runMut("open_project", () => S.openProjectBytes(session, unb64(dataBase64))),
  );
  server.registerTool(
    "new_project",
    { description: "base64 の .pptx テンプレートと（任意の）Markdown から新規プロジェクトを作る（テンプレ持ち込み＋Markdown→スライド。GUI の Draft と同じ整形）", inputSchema: { templateBase64: z.string(), markdown: z.string().optional() } },
    ({ templateBase64, markdown }) => runMut("new_project", () => S.newProject(session, unb64(templateBase64), markdown)),
  );
  server.registerTool("get_deck", { description: "現在の deck（DeckIR JSON）。resource `deck://current` のミラー — resource を自律読みできるクライアントでは resource 推奨" }, () => run(() => S.getDeck(session)));
  server.registerTool("get_deck_markdown", { description: "deck 全体を round-trip 可能な Markdown で。`deck://markdown` のミラー（resource 推奨）" }, () => run(() => S.getDeckMarkdown(session)));
  server.registerTool("get_slide_markdown", { description: "1スライドの Markdown（auto レイアウト解決済み）。`slide://{index}/markdown` の確実版（テンプレ resource 非対応クライアント向けにツールが正）", inputSchema: index }, ({ index: i }) => run(() => S.getSlideMarkdown(session, i)));
  server.registerTool("get_deck_issues", { description: "deck の診断＝CONTENT レバー（split/condense/visualize/title）＋本文 budget（このテンプレの容量: maxBullets/charsPerBullet）。`deck://issues` のミラー。※ export 可否は validate_deck" }, () => run(() => S.getDiagnostics(session)));
  server.registerTool("get_template_capabilities", { description: "テンプレートの能力サマリ＋レイアウト一覧（生成のプロンプト文脈）。`deck://capabilities` のミラー" }, () => run(() => S.getCatalog(session)));
  server.registerTool("get_project_info", { description: "現在のプロジェクトのメタ情報。`deck://info` のミラー" }, () => run(() => S.getProjectMeta(session)));
  server.registerTool("get_slide_fix_request", { description: "1スライドの修正リクエスト packet（agent が LLM として埋め、set_slide_markdown で適用）", inputSchema: index }, ({ index: i }) => run(() => S.getSlideFix(session, i)));

  // ── deterministic mutations ──
  server.registerTool("set_slide_markdown", { description: "1スライド（index 指定）を Markdown で差し替え。既存の図/mermaid は自動保持。zod 検証・不正は never-silent で拒否", inputSchema: { ...index, markdown: z.string() } }, ({ index: i, markdown }) => runMut("set_slide_markdown", () => S.applySlideMarkdown(session, i, markdown)));
  server.registerTool("set_deck_markdown", { description: "⚠️ deck 全体を置換（スライド数が変わりうる・図は自動保持されない）。1枚だけ直すなら set_slide_markdown を使うこと", inputSchema: { markdown: z.string() } }, ({ markdown }) => runMut("set_deck_markdown", () => S.applyDeckMarkdown(session, markdown)));
  server.registerTool("split_overflowing_slides", { description: "決定論レバー: 溢れた本文スライドをフォント縮小なしで分割" }, () => runMut("split_overflowing_slides", () => S.distill(session)));
  server.registerTool("convert_bullets_to_table", { description: "決定論レバー: key-value 箇条書きを GFM 表に", inputSchema: index }, ({ index: i }) => runMut("convert_bullets_to_table", () => S.visualizeKeyValue(session, i)));
  server.registerTool(
    "set_slide_diagram",
    { description: "図に【何を】置くか：DiagramSpec(yaml/json) or Mermaid で設定（検証＋native YAML 化。図/mermaid を持つスライドのみ）。配置・レイアウトの調整は apply_design_intent", inputSchema: { ...index, source: z.string(), format: z.enum(["yaml", "json", "mermaid"]) } },
    ({ index: i, source, format }) => runMut("set_slide_diagram", () => S.setDiagram(session, i, source, format)),
  );
  server.registerTool(
    "apply_design_intent",
    {
      description: '図を【どう配置するか】（design edit）：ops 配列の JSON で regionSplit(text-left/right/diagram-only) / emphasize(nodeId) / relayout(TB/LR/RL/BT)。エンジンが座標を計算＋クランプ。図/mermaid を持つスライドのみ。図の中身そのものは set_slide_diagram。例: [{"op":"relayout","direction":"LR"}]',
      inputSchema: { ...index, intent: z.string() },
    },
    ({ index: i, intent }) => runMut("apply_design_intent", () => S.applyDesignIntent(session, i, intent)),
  );
  server.registerTool("validate_deck", { description: "EXPORT ゲート：schema 検証＋変換不能 mermaid スキャン→exportReadiness。※ 内容の手直し（溢れ/冗長/表化）は get_deck_issues" }, () => run(() => S.validate(session)));

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
  // Opt-out in host/collab mode: the GUI is the human's surface there, so resources are orphaned.
  if (opts.registerResources !== false) registerResources(server, session);

  return server;
}
