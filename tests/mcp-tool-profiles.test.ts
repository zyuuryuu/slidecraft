/**
 * mcp-tool-profiles.test.ts — ADR-0037 D2 (#465): プロファイル別登録のスナップショット ratchet。
 *
 * solo（stdio 単独）・collab GUI・collab AI（sharedOnly）の 3 プロファイルそれぞれについて、
 * tools/list が返す登録ツール名の**全列挙**を期待値として固定する。意図しない増減（新ツールの
 * 無断追加・既存ツールの脱落・プロファイル漏れ）はここで赤になる。期待値を書き換える PR は
 * その理由を本文で宣言すること（ADR-0037: 温度分類と D3 適合の宣言）。
 *
 * 不変条件（Issue #465）:
 *  - collab（GUI/AI）の現状ツール集合は不変 — 変えるのは solo から collab 専用を隠すことだけ。
 *  - どのプロファイルでも既存ツールの入出力は不変（出す/出さないだけ）。I/O は既存テスト
 *    （mcp-server / host-server / mcp-bootstrap 等）が担保する。
 *  - undo/redo は solo でもサーバ側履歴が実動（mcp-server.test.ts の solo undo→redo round-trip）
 *    なので solo に残す（縮退しない側へ倒す — Issue の判断基準）。
 */
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, MemTemplateStore, type HostContext } from "../src/mcp/host-core";
import { TOOL_PROFILES, isToolVisible, profileOf } from "../src/mcp/tool-profiles";

/** 全プロファイル共通の deck ツール（著作・read・レバー・出口・入口・undo/redo）— 35 本。 */
const SHARED_TOOLS = [
  "apply_design_intent",
  "bootstrap",
  "convert_bullets_to_table",
  "create_template",
  "delete_slide",
  "duplicate_slide",
  "export_pptx",
  "get_authoring_guide",
  "get_deck",
  "get_deck_issues",
  "get_deck_markdown",
  "get_diagram_guide",
  "get_diagram_types",
  "get_project_info",
  "get_slide",
  "get_slide_fix_request",
  "get_slide_html",
  "get_slide_image",
  "get_slide_markdown",
  "get_template_capabilities",
  "get_template_spec_guide",
  "insert_slide",
  "list_templates",
  "move_slide",
  "new_project",
  "open_project",
  "redo",
  "save_project",
  "set_deck_markdown",
  "set_slide_diagram",
  "set_slide_markdown",
  "split_overflowing_slides",
  "undo",
  "use_template",
  "validate_deck",
];
/** collab 専用（doc 切替系）: solo（常に 1 doc・GUI が一切繋がらない）には見せない。 */
const COLLAB_ONLY_TOOLS = ["close_document", "list_documents", "select_document"];
/** GUI 専用: webview が master レジストリを push する口。AI からも solo からも見えない。 */
const GUI_ONLY_TOOLS = ["register_templates"];

const sorted = (xs: string[]): string[] => [...xs].sort();

const EXPECTED = {
  solo: sorted(SHARED_TOOLS),
  "collab-gui": sorted([...SHARED_TOOLS, ...COLLAB_ONLY_TOOLS, ...GUI_ONLY_TOOLS]),
  "collab-ai": sorted([...SHARED_TOOLS, ...COLLAB_ONLY_TOOLS]),
} as const;

function collabHost(sharedOnly: boolean): HostContext {
  return {
    registry: new DocRegistry(),
    active: () => undefined,
    setActive: () => {},
    sharedOnly,
    templates: new MemTemplateStore(),
  };
}

async function listToolNames(host?: HostContext): Promise<string[]> {
  const server = buildServer(createSession(null), host ? { host, registerResources: false } : {});
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return sorted((await client.listTools()).tools.map((t) => t.name));
}

describe("プロファイル別登録のスナップショット（ADR-0037 D2 / #465 受け入れ基準）", () => {
  it("solo（stdio 単独）: collab 専用 4 本（doc 切替 3 本＋register_templates）が隠れ、残り全部が出る", async () => {
    expect(await listToolNames()).toEqual(EXPECTED.solo);
  });

  it("collab GUI: 従来どおり全ツール（collab 集合は不変）", async () => {
    expect(await listToolNames(collabHost(false))).toEqual(EXPECTED["collab-gui"]);
  });

  it("collab AI（sharedOnly）: 従来どおり register_templates だけが隠れる（collab 集合は不変）", async () => {
    expect(await listToolNames(collabHost(true))).toEqual(EXPECTED["collab-ai"]);
  });

  it("solo にも undo/redo は残る（サーバ側履歴が solo で実動 — mcp-server.test.ts round-trip が実測）", async () => {
    const names = await listToolNames();
    expect(names).toContain("undo");
    expect(names).toContain("redo");
  });
});

describe("tool-profiles の表はツール面と 1:1（R8: 表を第 2 の真実にしない）", () => {
  it("表のキー集合 == 全プロファイルの登録ツール名の和集合（stale な表エントリも漏れも赤）", async () => {
    const union = new Set([...EXPECTED.solo, ...EXPECTED["collab-gui"], ...EXPECTED["collab-ai"]]);
    expect(sorted(Object.keys(TOOL_PROFILES))).toEqual(sorted([...union]));
  });

  it("表に無いツール名は登録時に throw（never-silent — 新ツールは表への追加を強制される）", () => {
    expect(() => isToolVisible("no_such_tool", "solo")).toThrow(/no_such_tool/);
  });

  it("profileOf: solo マーカー優先 → sharedOnly で AI/GUI を割る", () => {
    expect(profileOf({ solo: true, sharedOnly: false })).toBe("solo");
    expect(profileOf({ sharedOnly: true })).toBe("collab-ai");
    expect(profileOf({ sharedOnly: false })).toBe("collab-gui");
  });
});
