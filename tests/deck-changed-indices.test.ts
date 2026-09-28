/**
 * deck-changed-indices.test.ts — #407: deckChanged ペイロードに「どのスライドが変わったか」
 * (changedIndices＝変更後 deck での 0-based index) と発火元 (origin: "ai" | "gui") を追加する。
 * 追加フィールドのみ＝既存購読者 (docId/rev/opId) は非破壊。粒度が不明な変更 (set_deck_markdown・
 * undo/redo) は changedIndices を「省略」する (空配列と区別＝「どこも変わっていない」と偽らない)。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { changedIndicesOf, deckChangedPayload, type DocEntry } from "../src/mcp/host-core";

describe("changedIndicesOf — mutation → 変更後 deck の index（純関数）", () => {
  it("index 指定の単一スライド編集は [index]", () => {
    for (const tool of ["set_slide_markdown", "convert_bullets_to_table", "set_slide_diagram", "apply_design_intent"]) {
      expect(changedIndicesOf(tool, 3, { ok: true, changed: true })).toEqual([3]);
    }
  });

  it("構造操作は結果が持つ変更後 index を使う", () => {
    expect(changedIndicesOf("insert_slide", 2, { insertedIndex: 3 })).toEqual([3]); // position:after
    expect(changedIndicesOf("duplicate_slide", 1, { newIndex: 2 })).toEqual([2]);
    expect(changedIndicesOf("move_slide", undefined, { fromIndex: 0, toIndex: 4 })).toEqual([4]);
  });

  it("split は distill の changedSlides（分割後 indices）をそのまま使う（R8: 再計算しない）", () => {
    expect(changedIndicesOf("split_overflowing_slides", undefined, { changedSlides: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it("delete は残ったスライドの中身が変わらないので []", () => {
    expect(changedIndicesOf("delete_slide", 2, { deletedIndex: 2 })).toEqual([]);
  });

  it("粒度が不明な変更（deck 全置換・未知の tool）は undefined（省略）", () => {
    expect(changedIndicesOf("set_deck_markdown", undefined, { ok: true, changed: true })).toBeUndefined();
    expect(changedIndicesOf("some_future_tool", 0, {})).toBeUndefined();
  });
});

describe("deckChangedPayload — 追加フィールドのみ（非破壊）", () => {
  const entry = { docId: "d1", rev: 7 } as DocEntry;
  it("既存 docId/rev/opId を保ち、origin と changedIndices を足す", () => {
    expect(deckChangedPayload(entry, "op1", "ai", [3])).toEqual({ docId: "d1", rev: 7, opId: "op1", origin: "ai", changedIndices: [3] });
  });
  it("changedIndices が不明なら key 自体を出さない", () => {
    const p = deckChangedPayload(entry, undefined, "gui", undefined);
    expect(p).toEqual({ docId: "d1", rev: 7, opId: undefined, origin: "gui" });
    expect("changedIndices" in p).toBe(false);
  });
});

// ── 実 loopback host 越しのペイロード形 ──
let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

let host: CollabHost;
const clients: Client[] = [];
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null });
});
afterEach(async () => {
  for (const c of clients.splice(0)) {
    try { await c.close(); } catch { /* ignore */ }
  }
  await host.close();
});

async function connect(role?: "gui"): Promise<Client> {
  const headers: Record<string, string> = { Authorization: `Bearer ${host.token}` };
  if (role) headers["x-slidecraft-role"] = role;
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers } }));
  clients.push(c);
  return c;
}

type Notif = { method: string; params?: Record<string, unknown> };
async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for a condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

/** A listener (gui) + an editor; returns the deckChanged params the listener has seen so far. */
async function setup(editorRole?: "gui") {
  const listener = await connect("gui");
  const seen: Record<string, unknown>[] = [];
  listener.fallbackNotificationHandler = async (n) => {
    const m = n as Notif;
    if (m.method === "notifications/slidecraft/deckChanged") seen.push(m.params ?? {});
  };
  await new Promise((r) => setTimeout(r, 100)); // let the listener's SSE leg establish
  const editor = await connect(editorRole);
  return { editor, seen };
}

const FIVE = ["# 0", "# 1\n\n- a", "# 2\n\n- b", "# 3\n\n- c", "# 4\n\n- d"].join("\n\n---\n\n");

describe("deckChanged over the collab host (#407)", () => {
  it("AI の set_slide_markdown(index=3) → changedIndices=[3]・origin=ai（既存 docId/rev も保持）", async () => {
    const { editor, seen } = await setup();
    const made = text(await editor.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: FIVE } }));
    await editor.callTool({ name: "set_slide_markdown", arguments: { index: 3, markdown: "# 3 改\n\n- z" } });
    await waitFor(() => seen.length >= 1);
    expect(seen[0]).toMatchObject({ docId: made.docId, rev: 1, origin: "ai", changedIndices: [3] });
  });

  it("split → changedIndices = 分割後 indices（ツール結果の changedSlides と一致）", async () => {
    const { editor, seen } = await setup();
    const bullets = Array.from({ length: 40 }, (_, i) => `- 長い箇条書き項目${i}：容量を超過させるための十分に長いテキストをここに置きます`).join("\n");
    // new_project は作成時に分割を済ませるので、溢れる deck は set_deck_markdown で入れる（split-index-map.test と同じ前提）。
    await editor.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: "# 表紙" } });
    await editor.callTool({ name: "set_deck_markdown", arguments: { markdown: `# 表紙\n\n---\n\n# 中身\n\n${bullets}\n\n---\n\n# 末尾\n\n- 最後` } });
    await waitFor(() => seen.length >= 1);
    seen.length = 0; // set_deck_markdown の通知（changedIndices 省略）は捨て、split の通知だけを見る
    const r = text(await editor.callTool({ name: "split_overflowing_slides", arguments: {} }));
    expect(r.changed).toBe(true);
    await waitFor(() => seen.length >= 1);
    expect((r.changedSlides as number[]).length).toBeGreaterThan(1);
    expect(seen[0].changedIndices).toEqual(r.changedSlides);
  });

  it("GUI ロールの編集は origin=gui（GUI はこれで追随しない）", async () => {
    const { editor, seen } = await setup("gui");
    await editor.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: FIVE } });
    await editor.callTool({ name: "set_slide_markdown", arguments: { index: 1, markdown: "# 1 改", opId: "op-x" } });
    await waitFor(() => seen.length >= 1);
    expect(seen[0]).toMatchObject({ origin: "gui", opId: "op-x", changedIndices: [1] });
  });

  it("undo は粒度不明 → changedIndices を省略", async () => {
    const { editor, seen } = await setup();
    await editor.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: FIVE } });
    await editor.callTool({ name: "set_slide_markdown", arguments: { index: 2, markdown: "# 2 改" } });
    await editor.callTool({ name: "undo", arguments: {} });
    await waitFor(() => seen.length >= 2);
    expect(seen[1].rev).toBe(2);
    expect(seen[1].origin).toBe("ai");
    expect("changedIndices" in seen[1]).toBe(false);
  });
});
