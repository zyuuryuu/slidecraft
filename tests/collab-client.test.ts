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
});
