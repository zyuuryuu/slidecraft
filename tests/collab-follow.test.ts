/**
 * collab-follow.test.ts — #407: the gui-role CollabProjection turns an AI edit's deckChanged
 * {origin:"ai", changedIndices} into an onFollow AFTER the deck at that rev is applied (so the GUI's
 * jump lands on the fresh deck). The human's own edits (echo) and gui-origin edits never follow, and an
 * AI edit landing right after the human typed is suppressed (followQuietMs). Real host, push-only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient } from "../src/ipc/collab-client";
import { CollabProjection, type FollowTarget } from "../src/ipc/collab-projection";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

let host: CollabHost;
let proj: CollabProjection | undefined;
const others: CollabClient[] = [];
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null });
});
afterEach(async () => {
  try { await proj?.stop(); } catch { /* ignore */ }
  for (const c of others.splice(0)) { try { await c.close(); } catch { /* ignore */ } }
  proj = undefined;
  await host.close();
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 200));

const FOUR = ["# 0", "# 1\n\n- a", "# 2\n\n- b", "# 3\n\n- c"].join("\n\n---\n\n");

/** Start a push-only projection + an editor client; the doc is adopted (rev 0) before returning. */
async function setup(editorRole: "ai" | "gui", followQuietMs?: number) {
  const events: string[] = [];
  const follows: FollowTarget[] = [];
  proj = new CollabProjection({
    url: host.url, token: host.token, pollMs: 0, followQuietMs,
    onDeck: (p) => events.push(`deck:${p.rev}`),
    onFollow: (f) => { events.push(`follow:${f.rev}`); follows.push(f); },
  });
  await proj.start();
  const editor = new CollabClient({ url: host.url, token: host.token, role: editorRole });
  await editor.connect();
  others.push(editor);
  const made = await editor.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: FOUR });
  await waitFor(() => events.includes("deck:0"));
  return { editor, docId: made.docId, events, follows };
}

describe("CollabProjection follow (#407)", () => {
  it("AI edit → onFollow with its indices, fired AFTER the deck at that rev is applied; adopt never follows", async () => {
    const { editor, docId, events, follows } = await setup("ai");
    expect(follows).toEqual([]); // the initial adopt is not an edit to follow
    await editor.callTool("set_slide_markdown", { index: 2, markdown: "# 2 改\n\n- z", docId });
    await waitFor(() => follows.length >= 1);
    expect(follows[0]).toEqual({ docId, rev: 1, indices: [2] });
    expect(events.indexOf("deck:1")).toBeLessThan(events.indexOf("follow:1"));
  });

  it("insert at the end → follows the NEW last index (validated against the applied deck)", async () => {
    const { editor, docId, follows } = await setup("ai");
    await editor.callTool("insert_slide", { index: 3, position: "after", markdown: "# 4\n\n- new", docId });
    await waitFor(() => follows.length >= 1);
    expect(follows[0].indices).toEqual([4]);
  });

  it("a gui-origin edit (another human client) does not follow", async () => {
    const { editor, docId, events, follows } = await setup("gui");
    await editor.callTool("set_slide_markdown", { index: 1, markdown: "# 1 改", docId });
    await waitFor(() => events.includes("deck:1"));
    await settle();
    expect(follows).toEqual([]);
  });

  it("the human's own edit never follows, and an AI edit right after it is suppressed (quiet window)", async () => {
    const { docId, events, follows } = await setup("gui"); // the editor only seeds the doc here
    const ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    others.push(ai);
    const sent = await proj!.sendSlideMarkdown(0, "# 自分の編集");
    expect(sent.ok).toBe(true);
    await ai.callTool("set_slide_markdown", { index: 3, markdown: "# 3 AI", docId });
    await waitFor(() => events.includes("deck:2"));
    await settle();
    expect(follows).toEqual([]);
  });

  it("with followQuietMs:0 the same AI edit after a human edit does follow", async () => {
    const { docId, events, follows } = await setup("gui", 0);
    const ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    others.push(ai);
    await proj!.sendSlideMarkdown(0, "# 自分の編集");
    await ai.callTool("set_slide_markdown", { index: 3, markdown: "# 3 AI", docId });
    await waitFor(() => follows.length >= 1);
    expect(follows).toEqual([{ docId, rev: 2, indices: [3] }]);
    expect(events).not.toContain("follow:1"); // the human's own rev-1 edit never followed
  });
});
