/**
 * collab-dirty.test.ts — #633: collab（GUI が協働ホストを立て、AI が MCP で接続して同じ doc を編集するモード）で、
 * GUI が【読み取り目的】で呼ぶ save_project（#616 のテンプレ pull・AI 製 doc のタブ化）が host doc の
 * dirty（未保存の変更があるかのフラグ）を false にしてはいけない。
 *
 * 受け入れ基準（Issue #633）: AI が編集（dirty=true）→ GUI projection が augment_template 後のテンプレを
 * pull した後も、AI の get_project_info が dirty:true、close_document（force なし）が {ok:false, dirty:true}。
 * 不変条件: AI クライアント自身の save_project（＝明示的な保存）は従来どおり dirty=false・savedAt 更新。
 * host 実体（createCollabHost）に対して検証する（collab-template-sync.test.ts の流儀）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient } from "../src/ipc/collab-client";
import { CollabProjection, type ProjectedTemplate } from "../src/ipc/collab-projection";
import { openProject } from "../src/engine/project-io";

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

interface Meta { dirty: boolean; savedAt?: string }
const metaOf = (docId: string) => ai!.callTool<Meta>("get_project_info", { docId });
const listedDirty = async (docId: string): Promise<boolean> =>
  (await ai!.callTool<{ documents: Array<{ docId: string; dirty: boolean }> }>("list_documents")).documents.find((d) => d.docId === docId)!.dirty;

/** AI が doc を作って編集する（dirty=true の前提）。 */
async function aiEditedDoc(): Promise<string> {
  ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
  await ai.connect();
  const { docId } = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# 表紙\n\n---\n\n# 本文\n\n- a" });
  await ai.callTool("set_slide_markdown", { index: 1, markdown: "# 本文\n\n- b", docId });
  expect((await metaOf(docId)).dirty).toBe(true); // 前提
  return docId;
}

describe("#633 collab: GUI の読み取り目的の save_project は dirty を下ろさない", () => {
  it("受け入れ: GUI projection がテンプレを pull した後も get_project_info.dirty=true・close_document(force なし) は拒否", async () => {
    const templates: ProjectedTemplate[] = [];
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: () => {}, onTemplate: (t) => templates.push(t) });
    await proj.start();
    const docId = await aiEditedDoc();
    const savedAtBefore = (await metaOf(docId)).savedAt;

    await ai!.callTool("augment_template", { structures: ["kpi-4"], docId });
    await waitFor(() => templates.length >= 1); // GUI が save_project でテンプレを pull した

    const meta = await metaOf(docId);
    expect(meta.dirty).toBe(true);
    expect(meta.savedAt).toBe(savedAtBefore); // 読み取りは「保存した」記録も残さない
    expect(await listedDirty(docId)).toBe(true);
    const closed = await ai!.callTool<{ ok: boolean; closed: boolean; dirty?: boolean }>("close_document", { docId });
    expect(closed).toEqual({ ok: false, closed: false, dirty: true });
  });

  it("GUI ロールの save_project（AI 製 doc のタブ化・useCollab の onDocs 経路）も dirty を下ろさず、同じ deck の .scft を返す", async () => {
    const docId = await aiEditedDoc();
    gui = new CollabClient({ url: host.url, token: host.token, role: "gui" });
    await gui.connect();
    const r = await gui.callTool<{ dataBase64: string }>("save_project", { docId });
    const { deck } = await openProject(new Uint8Array(Buffer.from(r.dataBase64, "base64")));
    expect(deck).toEqual(await ai!.callTool("get_deck", { docId }));
    expect((await metaOf(docId)).dirty).toBe(true);
  });

  it("不変条件: AI クライアント自身の save_project（明示的な保存）は dirty=false・savedAt 更新・close_document は force 不要", async () => {
    const docId = await aiEditedDoc();
    const r = await ai!.callTool<{ dataBase64: string }>("save_project", { docId });
    expect(typeof r.dataBase64).toBe("string");
    const meta = await metaOf(docId);
    expect(meta.dirty).toBe(false);
    expect(typeof meta.savedAt).toBe("string");
    expect(await listedDirty(docId)).toBe(false);
    expect(await ai!.callTool("close_document", { docId })).toEqual({ ok: true, closed: true });
  });
});
