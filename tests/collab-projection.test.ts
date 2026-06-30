/**
 * collab-projection.test.ts — the P2.4 live-projection core (collab-projection.ts) driven against a
 * REAL collab host. Proves the webview's gui-role projection ADOPTS a doc the AI opens, re-PULLs the
 * deck via get_deck on every edit (so the GUI mirrors the host's truth), and applies each rev EXACTLY
 * ONCE (the rev guard swallows duplicate/overlapping signals). This is the headless half of
 * "AI 編集 → GUI ライブ更新"; the React setDeck wiring (useCollab) sits on top of this.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient } from "../src/ipc/collab-client";
import { CollabProjection, type ProjectedDeck, type CollabStatus } from "../src/ipc/collab-projection";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

let host: CollabHost;
let proj: CollabProjection | undefined;
let ai: CollabClient | undefined;
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null });
});
afterEach(async () => {
  try { await proj?.stop(); } catch { /* ignore */ }
  try { await ai?.close(); } catch { /* ignore */ }
  proj = ai = undefined;
  await host.close();
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("CollabProjection", () => {
  it("adopts an AI-opened doc, re-pulls the deck on each edit, and applies each rev exactly once", async () => {
    const applied: ProjectedDeck[] = [];
    // pollMs:0 → push-only, so the assertions exercise the deckChanged/documentOpened path directly.
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => applied.push(p) });
    await proj.start();
    expect(applied.length).toBe(0); // nothing open yet → nothing mirrored

    // A SEPARATE ai-role connection opens a doc + edits it (exactly what an upstream AI does).
    ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    const made = await ai.callTool<{ docId: string; slideCount: number }>("new_project", {
      templateBase64: templateB64,
      markdown: "# Hello\n\n- one\n\n---\n\n# Two\n\n- a",
    });

    // documentOpened → projection adopts the doc and mirrors its deck at rev 0.
    await waitFor(() => applied.length >= 1);
    const first = applied[applied.length - 1];
    expect(first.docId).toBe(made.docId);
    expect(first.rev).toBe(0);
    expect(first.deck?.slides.length).toBe(made.slideCount);

    // AI edits slide 0 → deckChanged → projection re-pulls at rev 1 with the new content.
    await ai.callTool("set_slide_markdown", { index: 0, markdown: "# 差し替え後\n\n- x", docId: made.docId });
    await waitFor(() => applied.some((p) => p.rev === 1));
    const latest = applied.find((p) => p.rev === 1)!;
    expect(latest.docId).toBe(made.docId);
    expect(JSON.stringify(latest.deck)).toContain("差し替え後");

    // Rev guard: despite documentOpened + deckChanged (+ coalesced pump runs), each distinct rev
    // produced exactly one apply — no duplicate re-renders.
    await new Promise((r) => setTimeout(r, 150));
    expect(applied.map((p) => p.rev)).toEqual([0, 1]);
    // First apply of a doc is the adopt (isInitial=true → 'silent' so a seed never clobbers); the
    // subsequent edit is isInitial=false (→ 'commit', one undoable live step).
    expect(applied.map((p) => p.isInitial)).toEqual([true, false]);
  });

  it("on host failure, surfaces an error and STOPS polling (no forever-polling zombie)", async () => {
    const statuses: CollabStatus[] = [];
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 40, onDeck: () => {}, onStatus: (s) => statuses.push(s) });
    await proj.start();
    expect(statuses).toContain("connected");

    await host.close(); // pull the host out from under the projection
    await waitFor(() => statuses.includes("error"));

    // failAndStop cleared the poll interval — no continued error churn after the first failure.
    const n = statuses.length;
    await new Promise((r) => setTimeout(r, 200)); // > several poll intervals
    expect(statuses.length).toBe(n);
  });

  it("suppresses the echo of its OWN edit (no double apply) but applies others' edits (P2.5 round-trip)", async () => {
    const applied: ProjectedDeck[] = [];
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => applied.push(p) });
    await proj.start();
    ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    const made = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# Hello\n\n- one\n\n---\n\n# Two\n\n- a" });
    await waitFor(() => applied.some((p) => p.rev === 0)); // adopt

    // The GUI sends its OWN edit → rev 1. The echo (opId) must be SUPPRESSED (no onDeck for rev 1).
    const sent = await proj.sendSlideMarkdown(0, "# 自分の編集\n\n- z");
    expect(sent.ok).toBe(true);
    expect(sent.rev).toBe(1);

    // A foreign (AI) edit → rev 2 → DOES apply.
    await ai.callTool("set_slide_markdown", { index: 0, markdown: "# AI の編集\n\n- q", docId: made.docId });
    await waitFor(() => applied.some((p) => p.rev === 2));

    await new Promise((r) => setTimeout(r, 120));
    expect(applied.map((p) => p.rev)).toEqual([0, 2]); // rev 1 (our own) was never re-applied
    expect(JSON.stringify(applied.find((p) => p.rev === 2)!.deck)).toContain("AI の編集");
  });

  it("reroutes Undo to the host and pulls the rolled-back deck (P2.5 server-undo)", async () => {
    const applied: ProjectedDeck[] = [];
    proj = new CollabProjection({ url: host.url, token: host.token, pollMs: 0, onDeck: (p) => applied.push(p) });
    await proj.start();
    ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    const made = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# 元のタイトル\n\n- a" });
    await waitFor(() => applied.some((p) => p.rev === 0));
    await ai.callTool("set_slide_markdown", { index: 0, markdown: "# 編集後\n\n- b", docId: made.docId });
    await waitFor(() => applied.some((p) => p.rev === 1));
    expect(JSON.stringify(applied.find((p) => p.rev === 1)!.deck)).toContain("編集後");

    // GUI Undo → host server-undo → a new forward rev whose deck equals the pre-edit deck.
    const undo = await proj.serverUndo();
    expect(undo.ok).toBe(true);
    await waitFor(() => applied.some((p) => p.rev === 2));
    expect(JSON.stringify(applied.find((p) => p.rev === 2)!.deck)).toContain("元のタイトル");
  });

  it("surfaces an unauthorized connection as an error (bad token never silently no-ops)", async () => {
    proj = new CollabProjection({ url: host.url, token: "wrong-token", pollMs: 0, onDeck: () => {} });
    await expect(proj.start()).rejects.toThrow();
  });
});
