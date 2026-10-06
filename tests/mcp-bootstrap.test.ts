/**
 * mcp-bootstrap.test.ts — ADR-0037 D2: the ONE cold "procurement" call. `bootstrap` returns, in one
 * response, what a session otherwise pulls through 6 cold tools (get_authoring_guide /
 * get_diagram_types / get_template_spec_guide / get_template_capabilities / list_templates, plus a
 * pointer for the per-type get_diagram_guide — menu-only, see #464 for the measured-size rationale).
 *
 * R8 agreement tests (the Issue #464 acceptance criteria): each bootstrap section deep-equals the
 * corresponding legacy tool's result — in BOTH states (before any project is open, where the
 * doc-scoped tools answer with their { ok:false, code } guard envelope, and after open_project).
 * The legacy 6 stay registered with unchanged I/O (ADR-0008 floor: no read-tool removal).
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

/** The 6 cold tools bootstrap consolidates (and must NOT replace — alias floor). */
const LEGACY_COLD_TOOLS = ["get_authoring_guide", "get_diagram_types", "get_diagram_guide", "get_template_spec_guide", "get_template_capabilities", "list_templates"];

let bundleB64: string;
beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" });
  bundleB64 = Buffer.from(bytes).toString("base64");
});

async function connect(): Promise<Client> {
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  return res.isError ? { data: text, isError: true } : { data: JSON.parse(text) as unknown, isError: false };
}

describe("bootstrap (ADR-0037 D2: cold tools consolidated into one call)", () => {
  it("bootstrap is registered AND all 6 legacy cold tools stay (alias floor, ADR-0008)", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("bootstrap");
    for (const n of LEGACY_COLD_TOOLS) expect(names).toContain(n);
  });

  it("pre-open: every section deep-equals its legacy tool — doc-scoped sections carry the SAME guard envelope the legacy tools answer with", async () => {
    const client = await connect();
    const b = (await call(client, "bootstrap")).data as Record<string, unknown>;
    expect(b.diagramTypes).toEqual((await call(client, "get_diagram_types")).data);
    expect(b.templateSpecGuide).toEqual((await call(client, "get_template_spec_guide")).data);
    expect(b.templates).toEqual((await call(client, "list_templates")).data);
    // Doc-scoped sections: no project open → the legacy tools return { ok:false, code } (modeled,
    // never-silent). bootstrap embeds the IDENTICAL envelope instead of crashing the whole call.
    expect(b.authoringGuide).toEqual((await call(client, "get_authoring_guide")).data);
    expect(b.templateCapabilities).toEqual((await call(client, "get_template_capabilities")).data);
    expect((b.authoringGuide as { ok: boolean; code?: string }).code).toBe("project-not-opened");
  });

  it("after open_project: every section deep-equals its legacy tool (R8 agreement — one generation path)", async () => {
    const client = await connect();
    await call(client, "open_project", { dataBase64: bundleB64 });
    const b = (await call(client, "bootstrap")).data as Record<string, unknown>;
    expect(b.authoringGuide).toEqual((await call(client, "get_authoring_guide")).data);
    expect(b.templateCapabilities).toEqual((await call(client, "get_template_capabilities")).data);
    expect(b.diagramTypes).toEqual((await call(client, "get_diagram_types")).data);
    expect(b.templateSpecGuide).toEqual((await call(client, "get_template_spec_guide")).data);
    expect(b.templates).toEqual((await call(client, "list_templates")).data);
    // Sanity: the doc-scoped sections are the REAL guides now, not envelopes.
    expect((b.authoringGuide as { format?: string }).format).toBeTruthy();
  });

  it("diagram guides are menu-only: bootstrap points at get_diagram_guide and every listed type is pullable there", async () => {
    const client = await connect();
    const b = (await call(client, "bootstrap")).data as { diagramTypes: { types: { type: string }[] }; diagramGuides: { note: string } };
    expect(b.diagramGuides.note).toContain("get_diagram_guide");
    expect(b.diagramTypes.types.length).toBeGreaterThanOrEqual(12);
    for (const { type } of b.diagramTypes.types) {
      const g = (await call(client, "get_diagram_guide", { type })).data as { type: string; guide: string };
      expect(g.type).toBe(type);
      expect(g.guide.length).toBeGreaterThan(100);
    }
  });
});
