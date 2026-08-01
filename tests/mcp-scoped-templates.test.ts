// mcp-scoped-templates.test.ts — #324 / proposal #1+#2: when the server runs with `--root`,
// list_templates reflects <root>/templates/*.{pptx,potx} (id "file:<name>") on top of the built-in
// presets, and use_template("file:...") mints a project from that file — so a GUI-less stdio client
// (Cursor, Claude Code CLI) can pick its OWN templates without the GUI's register_templates. Drives
// the real MCP server (in-memory client↔server pair, same shape as mcp-scoped-input.test.ts).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const TEMPLATE_FIXTURE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(TEMPLATE_FIXTURE); // a real template-only .pptx; .potx is the same package
});

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  return res.isError ? { data: text, isError: true } : { data: JSON.parse(text) as unknown, isError: false };
}

async function connect(root: string | null): Promise<Client> {
  const server = buildServer(createSession(root)); // no explicit host → solo control plane (stdio's shape)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

const tmpDirs: string[] = [];
function scratchDir(): string {
  const d = mkdtempSync(join(tmpdir(), "slidecraft-mcp-tpl-"));
  tmpDirs.push(d);
  return d;
}
/** A scope root with a `templates/` sub-directory holding the given template filenames. */
function scopeWithTemplates(...filenames: string[]): string {
  const root = scratchDir();
  mkdirSync(join(root, "templates"));
  for (const f of filenames) writeFileSync(join(root, "templates", f), templateBytes);
  return root;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

type ListRow = { id: string; name: string; builtin: boolean; path?: string };
type ListResult = { templates: ListRow[]; note?: string };

describe("list_templates discovery (#324)", () => {
  it("with --root, reflects <root>/templates/*.{pptx,potx} on top of the built-ins (no note)", async () => {
    const root = scopeWithTemplates("tech-report.potx", "gov.pptx");
    const client = await connect(root);
    const list = (await call(client, "list_templates")).data as ListResult;
    expect(list.templates.some((t) => t.id === "midnight" && t.builtin)).toBe(true);
    const tech = list.templates.find((t) => t.id === "file:tech-report.potx");
    expect(tech).toMatchObject({ name: "tech-report", builtin: false, path: "tech-report.potx" });
    expect(list.templates.some((t) => t.id === "file:gov.pptx")).toBe(true);
    expect(list.note).toBeUndefined(); // templates present → no guidance note
  });

  it("with --root but no templates/ dir, returns built-ins + a note pointing at templates/", async () => {
    const client = await connect(scratchDir());
    const list = (await call(client, "list_templates")).data as ListResult;
    expect(list.templates.every((t) => t.builtin)).toBe(true);
    expect(list.note).toContain("templates/");
  });

  it("with no --root (solo), returns built-ins + a note pointing at --root", async () => {
    const client = await connect(null);
    const list = (await call(client, "list_templates")).data as ListResult;
    expect(list.templates.every((t) => t.builtin)).toBe(true);
    expect(list.note).toContain("--root");
  });

  it("never lists a symlink placed in templates/ (no traversal vector)", async () => {
    const root = scopeWithTemplates("real.pptx");
    const outside = scratchDir();
    writeFileSync(join(outside, "secret.pptx"), templateBytes);
    symlinkSync(join(outside, "secret.pptx"), join(root, "templates", "linked.pptx"));
    const client = await connect(root);
    const list = (await call(client, "list_templates")).data as ListResult;
    expect(list.templates.some((t) => t.id === "file:real.pptx")).toBe(true);
    expect(list.templates.some((t) => t.id === "file:linked.pptx")).toBe(false);
  });
});

describe("use_template with a file: id (#324)", () => {
  it("mints a new project from a .potx discovered in the scope", async () => {
    const root = scopeWithTemplates("tech-report.potx");
    const client = await connect(root);
    const used = (await call(client, "use_template", { id: "file:tech-report.potx", markdown: "# 表紙\n\n---\n\n# 中身\n\n- x" })).data as { docId: string; slideCount: number };
    expect(used.docId).toBeTruthy();
    expect(used.slideCount).toBeGreaterThan(1);
    const info = (await call(client, "get_project_info")).data as { templateName: string };
    expect(info.templateName).toBe("tech-report"); // tab named after the file stem
  });

  it("mints from a .pptx discovered in the scope too", async () => {
    const root = scopeWithTemplates("gov.pptx");
    const client = await connect(root);
    const used = (await call(client, "use_template", { id: "file:gov.pptx", markdown: "# A" })).data as { slideCount: number };
    expect(used.slideCount).toBeGreaterThanOrEqual(1);
  });

  it("a file: id for a missing file is never-silent (scope-file-not-found)", async () => {
    const client = await connect(scopeWithTemplates());
    const r = (await call(client, "use_template", { id: "file:missing.pptx" })).data as { ok: boolean; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("scope-file-not-found");
  });

  it("a file: id with no --root configured is never-silent (scope-not-configured)", async () => {
    const client = await connect(null);
    const r = (await call(client, "use_template", { id: "file:whatever.pptx" })).data as { ok: boolean; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("scope-not-configured");
  });

  it("a file: id resolving to a symlink is rejected (scope-violation), never followed", async () => {
    const root = scratchDir();
    mkdirSync(join(root, "templates"));
    const outside = scratchDir();
    writeFileSync(join(outside, "secret.pptx"), templateBytes);
    symlinkSync(join(outside, "secret.pptx"), join(root, "templates", "linked.pptx"));
    const client = await connect(root);
    const r = (await call(client, "use_template", { id: "file:linked.pptx" })).data as { ok: boolean; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("scope-violation");
  });

  it("the built-in id (midnight) still mints normally when --root is set (no regression)", async () => {
    const client = await connect(scopeWithTemplates("tech.potx"));
    const used = (await call(client, "use_template", { id: "midnight", markdown: "# A" })).data as { slideCount: number };
    expect(used.slideCount).toBeGreaterThanOrEqual(1);
  });
});
