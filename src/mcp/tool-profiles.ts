/**
 * tool-profiles.ts — ADR-0037 D2 (#465): プロファイル別「登録」の唯一の表。
 *
 * ツールは全プロファイルで存在し続け（削除しない — ADR-0008 フロア）、ここは「どのプロファイルの
 * tools/list に出すか」だけを決める。散在する per-tool の if を第 2 の真実にしない（R8）ため、
 * server.ts の全登録はこの表を参照するゲート（gatedToolRegistrar）を通る。表に無い名前の登録は
 * throw（never-silent）— 新ツールは必ずこの表への追記を強制され、スナップショットテスト
 * （tests/mcp-tool-profiles.test.ts）が増減を ratchet する。
 *
 * プロファイルの軸は既存の HostContext マーカーそのまま（新しい状態は持ち込まない）:
 *  - solo       … stdio 単独（host.solo）。GUI が一切繋がらず、doc は常に 1 つ。
 *  - collab-gui … 協働ホストへの GUI ロール接続（sharedOnly:false）。
 *  - collab-ai  … 協働ホストへの AI クライアント接続（sharedOnly:true）。
 *
 * solo から隠すもの（collab 専用）とその理由:
 *  - list/select/close_document … 多 doc 切替系。solo は soleDocId() で常に一意解決され、
 *    close は唯一 doc を壊すだけ。
 *  - register_templates … GUI webview が master レジストリを push する口。solo には GUI が
 *    存在せず host.templates も配線されない＝常に template-registry-unavailable で死にツール。
 *  - undo/redo は隠さない: solo でもサーバ側履歴は実動する（tests/mcp-server.test.ts の
 *    solo undo→redo round-trip が実測）。Issue #465 の基準「迷ったら見せる側へ倒す」。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type McpProfile = "solo" | "collab-gui" | "collab-ai";

/** HostContext の既存マーカーからプロファイルを 1 箇所で導出（solo マーカーが最優先）。 */
export function profileOf(host: { solo?: boolean; sharedOnly: boolean }): McpProfile {
  return host.solo ? "solo" : host.sharedOnly ? "collab-ai" : "collab-gui";
}

const ALL: readonly McpProfile[] = ["solo", "collab-gui", "collab-ai"];
const COLLAB: readonly McpProfile[] = ["collab-gui", "collab-ai"];
const GUI: readonly McpProfile[] = ["collab-gui"];

/** ツール名 → 登録先プロファイル。server.ts の登録順と同じ並びで列挙する。 */
export const TOOL_PROFILES: Record<string, readonly McpProfile[]> = {
  // 入口
  open_project: ALL,
  new_project: ALL,
  // read
  get_deck: ALL,
  get_deck_markdown: ALL,
  get_slide_markdown: ALL,
  get_slide: ALL,
  get_deck_issues: ALL,
  get_template_capabilities: ALL,
  get_project_info: ALL,
  get_slide_fix_request: ALL,
  get_slide_image: ALL,
  get_slide_html: ALL,
  // 契約・ガイド
  get_authoring_guide: ALL,
  get_diagram_types: ALL,
  get_diagram_guide: ALL,
  // テンプレ調達
  create_template: ALL,
  get_template_spec_guide: ALL,
  // コールド統合（ADR-0037 D2 / #464）
  bootstrap: ALL,
  // 著作・レバー
  set_slide_markdown: ALL,
  set_deck_markdown: ALL,
  split_overflowing_slides: ALL,
  convert_bullets_to_table: ALL,
  set_slide_diagram: ALL,
  apply_design_intent: ALL,
  // 構造
  insert_slide: ALL,
  delete_slide: ALL,
  move_slide: ALL,
  duplicate_slide: ALL,
  // 出口
  validate_deck: ALL,
  save_project: ALL,
  export_pptx: ALL,
  // 多 doc ライフサイクル（collab 専用 — solo は常に 1 doc）
  list_documents: COLLAB,
  select_document: COLLAB,
  close_document: COLLAB,
  // サーバ側 undo/redo（solo でも実動 — ヘッダ注記の実測参照）
  undo: ALL,
  redo: ALL,
  // テンプレ選択（solo は組み込みプリセット/--root fallback で成立 — #298/#332）
  list_templates: ALL,
  use_template: ALL,
  // GUI 専用（webview → host の push 口）
  register_templates: GUI,
};

/** 表引き。未知の名前は never-silent に throw — 表への追記を強制する。 */
export function isToolVisible(name: string, profile: McpProfile): boolean {
  const profiles = TOOL_PROFILES[name];
  if (!profiles) throw new Error(`TOOL_PROFILES に未登録のツール: ${name}（src/mcp/tool-profiles.ts の表に追記すること）`);
  return profiles.includes(profile);
}

/** server.registerTool と同型のゲート: 表でこのプロファイルに出すと決めたツールだけ登録する。
 *  server.ts は全登録をこれ経由にする（call site に per-tool の if を書かない — R8）。 */
export function gatedToolRegistrar(server: McpServer, host: { solo?: boolean; sharedOnly: boolean }): McpServer["registerTool"] {
  const profile = profileOf(host);
  const register = server.registerTool.bind(server) as (name: string, cfg: unknown, cb: unknown) => unknown;
  return ((name: string, cfg: unknown, cb: unknown) => (isToolVisible(name, profile) ? register(name, cfg, cb) : undefined)) as McpServer["registerTool"];
}
