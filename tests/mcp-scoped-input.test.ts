// mcp-scoped-input.test.ts — ADR-0035 stage 3 (#299): open_project / new_project switch from
// base64-over-stdio to scoped-fs-reference INPUT when the server session carries a `root`
// (--root) — the symmetric counterpart to mcp-scoped-output.test.ts's stage 1 (write side).
// Drives the real MCP server (in-memory client↔server pair, same shape as mcp-server.test.ts) so
// this exercises the actual tool envelope, not just fs-scope.ts in isolation.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";
const TEMPLATE_FIXTURE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

let bundleBytes: Buffer;
let bundleB64: string;
let templateBytes: Buffer;
beforeAll(async () => {
  templateBytes = readFileSync(TEMPLATE_FIXTURE);
  const template = await loadTemplate(templateBytes);
  bundleBytes = Buffer.from(await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" }));
  bundleB64 = bundleBytes.toString("base64");
});

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  return res.isError ? { data: text, isError: true } : { data: JSON.parse(text) as unknown, isError: false };
}

async function connect(root: string | null): Promise<Client> {
  const server = buildServer(createSession(root));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

const tmpDirs: string[] = [];
function scratchDir(): string {
  const d = mkdtempSync(join(tmpdir(), "slidecraft-mcp-scope-in-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("no --root (default): base64 input is unchanged (non-regression)", () => {
  it("open_project(dataBase64) still opens normally", async () => {
    const client = await connect(null);
    const res = (await call(client, "open_project", { dataBase64: bundleB64 })).data as { slideCount: number };
    expect(res.slideCount).toBeGreaterThan(1);
  });

  it("new_project(templateBase64) still opens normally", async () => {
    const client = await connect(null);
    const res = (await call(client, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: "# A" })).data as { slideCount: number };
    expect(res.slideCount).toBeGreaterThanOrEqual(1);
  });

  it("passing path with no scope configured is a never-silent guard rejection", async () => {
    const client = await connect(null);
    const res = await call(client, "open_project", { path: "deck.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-not-configured");
  });

  it("passing templatePath with no scope configured is a never-silent guard rejection", async () => {
    const client = await connect(null);
    const res = await call(client, "new_project", { templatePath: "t.pptx" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-not-configured");
  });
});

describe("--root <dir> configured: scoped-fs reference input", () => {
  it("open_project(path) reads a real .scft placed in the scope, no base64 involved", async () => {
    const dir = scratchDir();
    writeFileSync(join(dir, "deck.scft"), bundleBytes);
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "deck.scft" });
    expect(res.isError).toBe(false);
    expect((res.data as { slideCount: number }).slideCount).toBeGreaterThan(1);
  });

  it("new_project(templatePath, markdown) reads a real .pptx template placed in the scope", async () => {
    const dir = scratchDir();
    writeFileSync(join(dir, "tpl.pptx"), templateBytes);
    const client = await connect(dir);
    const res = await call(client, "new_project", { templatePath: "tpl.pptx", markdown: "# A\n\n---\n\n# B\n\n- x\n- y" });
    expect(res.isError).toBe(false);
    expect((res.data as { slideCount: number }).slideCount).toBeGreaterThan(1);
  });

  it("write→read round-trip: save_project(filename) then open_project(path) reads the SAME file back", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const saved = (await call(client, "save_project", { filename: "roundtrip.scft" })).data as { path: string };
    expect(saved.path).toBe(`file://${join(dir, "roundtrip.scft")}`);

    const reopened = await call(client, "open_project", { path: "roundtrip.scft" });
    expect(reopened.isError).toBe(false);
    expect((reopened.data as { slideCount: number; docId: string }).slideCount).toBeGreaterThan(1);
  });

  it("both dataBase64 and path given is rejected never-silently (ambiguous-input)", async () => {
    const dir = scratchDir();
    writeFileSync(join(dir, "deck.scft"), bundleBytes);
    const client = await connect(dir);
    const res = await call(client, "open_project", { dataBase64: bundleB64, path: "deck.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("ambiguous-input");
  });

  it("both templateBase64 and templatePath given is rejected never-silently (ambiguous-input)", async () => {
    const dir = scratchDir();
    writeFileSync(join(dir, "tpl.pptx"), templateBytes);
    const client = await connect(dir);
    const res = await call(client, "new_project", { templateBase64: templateBytes.toString("base64"), templatePath: "tpl.pptx" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("ambiguous-input");
  });

  it("neither dataBase64 nor path given is rejected never-silently (missing-input)", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    const res = await call(client, "open_project", {});
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("missing-input");
  });

  it("../ traversal in path is rejected never-silently, no file escapes the scope", async () => {
    const dir = scratchDir();
    const outside = scratchDir();
    writeFileSync(join(outside, "secret.scft"), bundleBytes);
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "../" + outside.split("/").pop() + "/secret.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
  });

  it("an absolute-path `path` is rejected", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "/etc/passwd" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
  });

  it("a wrong extension is rejected", async () => {
    const dir = scratchDir();
    writeFileSync(join(dir, "deck.txt"), bundleBytes);
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "deck.txt" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
  });

  it("a missing file is rejected with scope-file-not-found", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "does-not-exist.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-file-not-found");
  });

  it("a symlink pointing outside the scope is never followed — no information leak", async () => {
    const dir = scratchDir();
    const outside = scratchDir();
    writeFileSync(join(outside, "secret.scft"), "not-actually-a-valid-scft-but-should-never-be-read");
    symlinkSync(join(outside, "secret.scft"), join(dir, "innocuous.scft"));
    const client = await connect(dir);
    const res = await call(client, "open_project", { path: "innocuous.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
  });
});
