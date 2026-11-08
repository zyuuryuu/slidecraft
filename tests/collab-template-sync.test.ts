/**
 * collab-template-sync.test.ts — #616: collab（GUI が協働ホストを立て、AI が接続して同じ doc を編集するモード）で
 * AI の augment_template / adjust_template によるテンプレ差し替えを GUI へ同期する。
 *
 * 裁定（Issue #616 統括コメント・案 A）:
 *  - deckChanged に ADDITIVE なフィールド templateChanged:true ＋ templateName を足す（新通知は増やさない）。
 *  - rev は進める（forward-only）が undo 履歴には積まない（deck は変わっていない）。
 *  - GUI は新ツールを増やさず既存 save_project（.scft＝deck＋template）からテンプレを取り出す。
 *
 * 受け入れ基準: AI の augment_template 後に GUI 側（projection）が受け取るテンプレのレイアウト名一覧が、
 * host の get_template_capabilities と一致する。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient, type DeckChangedEvent } from "../src/ipc/collab-client";
import { CollabProjection, type ProjectedDeck, type ProjectedTemplate } from "../src/ipc/collab-projection";
import { buildCatalog } from "../src/engine/template-catalog";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/技術報告_スタンダード水色_全レイアウト見本.pptx")).toString("base64");
});

let host: CollabHost;
let proj: CollabProjection | undefined;
let ai: CollabClient | undefined;
let gui: CollabClient | undefined;
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null });
});
afterEach(async () => {
  for (const c of [proj, ai, gui]) {
    try {
      if (c) await (c instanceof CollabProjection ? c.stop() : c.close());
    } catch {
      /* ignore */
    }
  }
  proj = ai = gui = undefined;
  await host.close();
});

async function waitFor(pred: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const layoutNamesOfHost = async (c: CollabClient, docId: string): Promise<string[]> =>
  (await c.callTool<{ entries: Array<{ name: string }> }>("get_template_capabilities", { docId })).entries.map((e) => e.name);

async function aiDoc(): Promise<string> {
  ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
  await ai.connect();
  const made = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# 表紙\n\n---\n\n# 本文\n\n- a" });
  return made.docId;
}

describe("#616 collab: テンプレ差し替えを GUI へ同期する", () => {
  it("受け入れ: AI の augment_template 後、GUI が受け取るテンプレのレイアウト名一覧 == host の get_template_capabilities", async () => {
    const decks: ProjectedDeck[] = [];
    const templates: ProjectedTemplate[] = [];
    // pollMs:0 → push 経路だけで同期できることを確かめる。
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => decks.push(p), onTemplate: (t) => templates.push(t) });
    await proj.start();
    const docId = await aiDoc();
    await waitFor(() => decks.length >= 1);
    expect(templates).toEqual([]); // 採用時（rev 0）はテンプレ差し替えが無い → pull しない

    const before = await layoutNamesOfHost(ai!, docId);
    const r = await ai!.callTool<{ changed: boolean; templateName: string }>("augment_template", { structures: ["kpi-4"], docId });
    expect(r.changed).toBe(true);
    const after = await layoutNamesOfHost(ai!, docId);
    expect(after.length).toBeGreaterThan(before.length); // 派生で増えた（前提の確認）

    await waitFor(() => templates.length >= 1);
    const got = templates[templates.length - 1];
    expect(got.docId).toBe(docId);
    expect(buildCatalog(got.template).map((e) => e.name)).toEqual(after);
    expect(got.templateName).toBe(r.templateName);

    // deck は変わっていない → GUI に deck の再適用（＝GUI 側 undo の空エントリ）を出さない。
    await new Promise((res) => setTimeout(res, 150));
    expect(decks.map((p) => p.rev)).toEqual([0]);
    expect(templates.length).toBe(1); // 同じ rev のテンプレを二重に適用しない
  });

  it("deckChanged は ADDITIVE に templateChanged:true ＋ templateName を運ぶ（AI 由来・opId/changedIndices なし）", async () => {
    const events: DeckChangedEvent[] = [];
    gui = new CollabClient({ url: host.url, token: host.token, role: "gui", events: { onDeckChanged: (e) => events.push(e) } });
    await gui.connect();
    const docId = await aiDoc();
    const r = await ai!.callTool<{ templateName: string }>("adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }), docId });
    await waitFor(() => events.length >= 1);
    expect(events[0]).toEqual({ docId, rev: 1, origin: "ai", templateChanged: true, templateName: r.templateName });
  });

  it("rev は進むが undo 履歴には積まない（deck 不変・template 可変）／list_documents に templateRev", async () => {
    const docId = await aiDoc();
    await ai!.callTool("augment_template", { structures: ["kpi-4"], docId });
    const list = await ai!.callTool<{ documents: Array<{ docId: string; rev: number; templateRev: number }> }>("list_documents");
    const row = list.documents.find((d) => d.docId === docId)!;
    expect(row.rev).toBe(1);
    expect(row.templateRev).toBe(1);
    const u = await ai!.callTool<{ ok: boolean; reason?: string }>("undo", { docId });
    expect(u).toMatchObject({ ok: false, reason: "nothing-to-undo" });
  });

  it("no-op（足すものが無い）は rev も通知も出さない", async () => {
    const events: DeckChangedEvent[] = [];
    gui = new CollabClient({ url: host.url, token: host.token, role: "gui", events: { onDeckChanged: (e) => events.push(e) } });
    await gui.connect();
    const docId = await aiDoc();
    await ai!.callTool("augment_template", { structures: ["kpi-4"], docId });
    const again = await ai!.callTool<{ changed: boolean }>("augment_template", { structures: ["kpi-4"], docId });
    expect(again.changed).toBe(false);
    await new Promise((res) => setTimeout(res, 150));
    expect(events.map((e) => e.rev)).toEqual([1]);
  });

  it("テンプレ差し替え後、古い expectedRev の GUI 編集は stale で拒否される（既存の stale 契約）", async () => {
    gui = new CollabClient({ url: host.url, token: host.token, role: "gui" });
    await gui.connect();
    const docId = await aiDoc();
    await ai!.callTool("augment_template", { structures: ["kpi-4"], docId });
    const r = await gui.callTool<{ ok?: boolean; stale?: boolean; currentRev?: number }>("set_slide_markdown", { index: 1, markdown: "# x\n\n- y", docId, expectedRev: 0 });
    expect(r).toMatchObject({ ok: false, stale: true, currentRev: 1 });
  });

  it("push を取りこぼしても poll（list_documents の templateRev）でテンプレを取りに行く", async () => {
    const templates: ProjectedTemplate[] = [];
    const decks: ProjectedDeck[] = [];
    const docId = await aiDoc();
    // 接続前に派生済みの doc を後から採用する＝push を一度も受けていない状態。
    await ai!.callTool("augment_template", { structures: ["kpi-4"], docId });
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => decks.push(p), onTemplate: (t) => templates.push(t) });
    await proj.start();
    await waitFor(() => templates.length >= 1);
    expect(buildCatalog(templates[0].template).map((e) => e.name)).toEqual(await layoutNamesOfHost(ai!, docId));
    expect(decks.map((p) => p.rev)).toEqual([1]); // 初回採用の deck は従来どおり 1 回
  });

  // D1（PR #619 統括レビュー）: GUI 編集の送信中（sending=true で tick が bail）に AI が別の rev を作ると、GUI 編集は
  // expectedRev 古さで stale 拒否される。GUI は楽観適用済みなので、拒否後は host の deck を再 pull して画面を戻す必要がある。
  // 送信直前に AI 操作を挟むため、projection 内部の client.callTool を set_slide_markdown の時だけラップする（決定的に再現）。
  async function staleSendAfter(aiOp: (docId: string) => Promise<unknown>) {
    const decks: ProjectedDeck[] = [];
    const templates: ProjectedTemplate[] = [];
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => decks.push(p), onTemplate: (t) => templates.push(t) });
    await proj.start();
    const docId = await aiDoc();
    await waitFor(() => decks.length >= 1);
    const client = (proj as unknown as { client: CollabClient }).client;
    const orig = client.callTool.bind(client);
    client.callTool = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "set_slide_markdown") await aiOp(docId);
      return orig(name, args);
    }) as CollabClient["callTool"];
    const sent = await proj.sendSlideMarkdown(1, "# GUI の編集\n\n- z");
    return { decks, templates, sent, docId };
  }

  it("対照: 送信中に AI が deck を編集 → GUI 編集は stale → host の deck（rev 1）を再 pull する", async () => {
    const { decks, sent } = await staleSendAfter((docId) => ai!.callTool("set_slide_markdown", { index: 1, markdown: "# AI\n\n- a", docId }));
    expect(sent).toMatchObject({ ok: false, stale: true });
    await waitFor(() => decks.some((p) => p.rev === 1));
    expect(decks.map((p) => p.rev)).toEqual([0, 1]);
  });

  it("D1: 送信中に AI が augment_template → GUI 編集は stale → template-only rev でも deck を再 pull して楽観適用を戻す", async () => {
    const { decks, templates, sent, docId } = await staleSendAfter((docId) => ai!.callTool("augment_template", { structures: ["kpi-4"], docId }));
    expect(sent).toMatchObject({ ok: false, stale: true });
    await waitFor(() => decks.some((p) => p.rev === 1) && templates.length >= 1);
    expect(decks.map((p) => p.rev)).toEqual([0, 1]);
    expect(buildCatalog(templates[0].template).map((e) => e.name)).toEqual(await layoutNamesOfHost(ai!, docId));
  });
});
