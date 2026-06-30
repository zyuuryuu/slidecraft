/**
 * collab-client.test.ts — the webview's MCP client module (collab-client.ts) driven against a REAL
 * collab host over loopback HTTP. Proves it connects, drives the engine via callTool (parsed
 * result / thrown error), and surfaces the host's deckChanged + documentOpened notifications to its
 * typed event callbacks. (The React projection that consumes these events is P2.4 UI.)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient, type DeckChangedEvent, type DocumentOpenedEvent } from "../src/ipc/collab-client";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

let host: CollabHost;
let client: CollabClient | undefined;
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null });
});
afterEach(async () => {
  try { await client?.close(); } catch { /* ignore */ }
  client = undefined;
  await host.close();
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("CollabClient", () => {
  it("connects, callTool returns parsed JSON, and notifications reach the typed callbacks", async () => {
    const opened: DocumentOpenedEvent[] = [];
    const changed: DeckChangedEvent[] = [];
    client = new CollabClient({
      url: host.url,
      token: host.token,
      events: { onDocumentOpened: (e) => opened.push(e), onDeckChanged: (e) => changed.push(e) },
    });
    await client.connect();

    const made = await client.callTool<{ docId: string; slideCount: number }>("new_project", {
      templateBase64: templateB64,
      markdown: "# A\n\n---\n\n# B\n\n- x",
    });
    expect(made.docId).toBeTruthy();
    expect(made.slideCount).toBeGreaterThan(1);

    await waitFor(() => opened.length > 0);
    expect(opened[0].docId).toBe(made.docId);

    await client.callTool("set_slide_markdown", { index: 0, markdown: "# 差替\n\n- z" });
    await waitFor(() => changed.length > 0);
    expect(changed[0].docId).toBe(made.docId);
    expect(changed[0].rev).toBe(1);
  });

  it("callTool throws on an engine error result (out-of-range slide, never silent)", async () => {
    client = new CollabClient({ url: host.url, token: host.token });
    await client.connect();
    await client.callTool("new_project", { templateBase64: templateB64, markdown: "# A\n\n---\n\n# B" });
    await expect(client.callTool("get_slide_markdown", { index: 99 })).rejects.toThrow(/範囲外/);
  });

  it("set_slide_markdown honours expectedRev (stale → never-silent) and echoes opId (P2.5 round-trip)", async () => {
    client = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await client.connect();
    const made = await client.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# A\n\n- x\n\n---\n\n# B" });

    // An edit based on the CURRENT rev (0) commits, reports the new rev, and echoes the opId.
    const ok1 = await client.callTool<{ rev: number; opId: string }>("set_slide_markdown", { index: 0, markdown: "# A2\n\n- y", docId: made.docId, expectedRev: 0, opId: "op-1" });
    expect(ok1.rev).toBe(1);
    expect(ok1.opId).toBe("op-1");

    // A STALE edit (expectedRev still 0 while rev is now 1) is rejected never-silently — no mutation.
    const stale = await client.callTool<{ ok: boolean; stale?: boolean; currentRev?: number }>("set_slide_markdown", { index: 0, markdown: "# A3", docId: made.docId, expectedRev: 0, opId: "op-2" });
    expect(stale.ok).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.currentRev).toBe(1);

    // The rejected edit didn't bump rev → a correct expectedRev=1 now commits at rev 2.
    const ok2 = await client.callTool<{ rev: number }>("set_slide_markdown", { index: 0, markdown: "# A3\n\n- z", docId: made.docId, expectedRev: 1, opId: "op-3" });
    expect(ok2.rev).toBe(2);
  });
});
