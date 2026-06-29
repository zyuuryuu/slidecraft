/**
 * server-seam.test.ts — the P2.0 buildServer(session, {onMutate, registerResources}) seam that
 * the collab host (P2) uses to bump rev + broadcast deckChanged. Guards the key invariant: a
 * READ tool NEVER fires onMutate (else every get_deck would broadcast), and a never-silent
 * {ok:false} reject does NOT fire it either. Drives the real server over an in-memory client.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

let bundleB64: string;
let templateB64: string;
beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
  templateB64 = tBytes.toString("base64");
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-29T00:00:00Z" });
  bundleB64 = Buffer.from(bytes).toString("base64");
});

async function connect() {
  const mutated: string[] = [];
  const server = buildServer(createSession(null), { onMutate: (t) => mutated.push(t) });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return { client, mutated };
}

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  return { isError: !!res.isError };
}

describe("buildServer onMutate seam", () => {
  it("a READ tool NEVER fires onMutate (the broadcast-on-read regression guard)", async () => {
    const { client, mutated } = await connect();
    await call(client, "open_project", { dataBase64: bundleB64 }); // open IS a mutator
    const afterOpen = [...mutated];
    for (const r of ["get_deck", "get_deck_markdown", "get_deck_issues", "get_template_capabilities", "get_project_info", "validate_deck"]) {
      await call(client, r);
    }
    await call(client, "get_slide_markdown", { index: 1 });
    await call(client, "get_slide_fix_request", { index: 1 });
    expect(mutated).toEqual(afterOpen); // not one read added a name
  });

  it("each successful mutating tool fires onMutate exactly once with its name", async () => {
    const { client, mutated } = await connect();
    await call(client, "new_project", { templateBase64: templateB64, markdown: "# A\n\n---\n\n# B\n\n- x\n- y" });
    await call(client, "set_slide_markdown", { index: 0, markdown: "# 差替\n\n- 一点" });
    await call(client, "set_deck_markdown", { markdown: "# X\n\n---\n\n# Y\n\n- 速度: 0.8秒\n- 重量: 1.2kg" });
    await call(client, "split_overflowing_slides");
    await call(client, "convert_bullets_to_table", { index: 1 }); // slide 1 = key-value run
    expect(mutated).toEqual(["new_project", "set_slide_markdown", "set_deck_markdown", "split_overflowing_slides", "convert_bullets_to_table"]);
  });

  it("a mutating tool returning {ok:false} does NOT fire onMutate (reject = no change)", async () => {
    const { client, mutated } = await connect();
    await call(client, "open_project", { dataBase64: bundleB64 });
    const afterOpen = [...mutated];
    // figureless slide 0 → both reject with {ok:false} (never-silent), so neither mutated.
    await call(client, "set_slide_diagram", { index: 0, source: "flowchart TD\n  A-->B", format: "mermaid" });
    await call(client, "apply_design_intent", { index: 0, intent: '[{"op":"relayout","direction":"LR"}]' });
    expect(mutated).toEqual(afterOpen); // neither rejected op added a name
  });

  it("default opts keep deck:// resources on; registerResources:false drops them", async () => {
    const withRes = buildServer(createSession(null)); // no opts = backward-compatible
    const [ca, sa] = InMemoryTransport.createLinkedPair();
    await withRes.connect(sa);
    const a = new Client({ name: "t", version: "1" });
    await a.connect(ca);
    expect((await a.listResources()).resources.map((r) => r.uri)).toContain("deck://current");

    const noRes = buildServer(createSession(null), { registerResources: false });
    const [cb, sb] = InMemoryTransport.createLinkedPair();
    await noRes.connect(sb);
    const b = new Client({ name: "t", version: "1" });
    await b.connect(cb);
    let offUris: string[] = [];
    try {
      offUris = (await b.listResources()).resources.map((r) => r.uri);
    } catch {
      offUris = []; // no resource registered → server doesn't advertise the capability
    }
    expect(offUris).not.toContain("deck://current");
  });
});
