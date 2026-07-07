/**
 * authoring-contract-digest.test.ts — Theme 3 / S1 增分2: the contract DIGEST that rides every
 * session-entry return (open/new/select), plus the now-actionable capabilities budget. The digest is
 * the unskippable PUSH channel — it must carry this template's real layout names + the separator
 * placement rule + the body budget + pointers, and it must actually appear on new_project's tool
 * result. See docs/design/mcp-brushup.md §F ②.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, type HostContext, type DocEntry } from "../src/mcp/host-core";

type Contract = { layouts: string[]; seeAlso: { figures: string } };
type EntryResult = { docId?: string; documents?: { contract?: Contract }[]; contract?: Contract };

let templateBytes: Buffer;
let templateB64: string;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  templateB64 = templateBytes.toString("base64");
});

describe("contractDigest — the session-entry push channel", () => {
  it("carries this template's layout names, budget, separator hint, and pointers", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes);
    const d = G.contractDigest(s);
    expect(Array.isArray(d.layouts)).toBe(true);
    expect(d.layouts.length).toBeGreaterThan(0);
    expect(d.separators).toMatch(/col|kpi|step/);
    expect(d.separators).toContain("先頭より前"); // teaches the leading-delimiter footgun
    expect(d.seeAlso.format).toContain("get_authoring_guide");
    expect(d.seeAlso.figures).toContain("get_diagram_types");
    expect(d.budget === null || typeof d.budget.maxBullets === "number").toBe(true);
  });
});

describe("get_template_capabilities — budget is actionable (rides the catalog read)", () => {
  it("getCatalog returns the deck body budget alongside entries", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes);
    const c = S.getCatalog(s);
    expect(c.entries.length).toBeGreaterThan(0);
    expect(c.budget === null || typeof c.budget.maxBullets === "number").toBe(true);
  });
});

describe("new_project tool result carries the contract digest (unskippable push)", () => {
  it("includes contract with layout names + figure pointer", async () => {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);

    const res = (await client.callTool({ name: "new_project", arguments: { templateBase64: templateB64 } })) as unknown as {
      content: { text?: string }[];
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0]!.text!) as {
      slideCount: number;
      contract?: { layouts: string[]; seeAlso: { figures: string }; budget: unknown };
    };
    expect(data.slideCount).toBeGreaterThan(0);
    expect(data.contract).toBeTruthy();
    expect(data.contract!.layouts.length).toBeGreaterThan(0);
    expect(data.contract!.seeAlso.figures).toContain("get_diagram_types");
  });
});

// ── host (collab) mode: the contract must ride EVERY entry path incl. the sole-doc discovery flow ──
function makeHost(): HostContext {
  const registry = new DocRegistry();
  let activeDocId: string | undefined;
  const opened: DocEntry[] = [];
  return {
    registry,
    active: () => activeDocId,
    setActive: (_e, id) => {
      activeDocId = id;
    },
    sharedOnly: false,
    notifyOpened: (e) => opened.push(e),
  };
}

async function hostClient(host: HostContext): Promise<Client> {
  const server = buildServer(S.createSession(null), { host });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "1.0.0" });
  await client.connect(ct);
  return client;
}

async function callData(client: Client, name: string, args: Record<string, unknown> = {}): Promise<EntryResult> {
  const res = (await client.callTool({ name, arguments: args })) as unknown as { content: { text?: string }[]; isError?: boolean };
  return JSON.parse(res.content[0]?.text ?? "null") as EntryResult;
}

describe("host mode — contract rides new_project / select_document / list_documents", () => {
  it("new_project (host mint) carries the contract", async () => {
    const r = await callData(await hostClient(makeHost()), "new_project", { templateBase64: templateB64 });
    expect(r.docId).toBeTruthy();
    expect(r.contract?.layouts.length).toBeGreaterThan(0);
    expect(r.contract?.seeAlso.figures).toContain("get_diagram_types");
  });

  it("select_document and list_documents both carry each doc's contract (collab discovery path)", async () => {
    const client = await hostClient(makeHost());
    const a = await callData(client, "new_project", { templateBase64: templateB64 });
    await callData(client, "new_project", { templateBase64: templateB64 });
    // switch back to the first doc → its select return carries the contract
    const sel = await callData(client, "select_document", { docId: a.docId! });
    expect(sel.contract?.layouts.length).toBeGreaterThan(0);
    // list shows both, each row carrying a contract (so list→operate-by-docId is never blind)
    const list = await callData(client, "list_documents");
    expect(list.documents!.length).toBe(2);
    for (const d of list.documents!) expect(d.contract?.layouts.length).toBeGreaterThan(0);
  });
});
