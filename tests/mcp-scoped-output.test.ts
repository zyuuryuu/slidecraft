// mcp-scoped-output.test.ts — ADR-0035 stage 1 (#299): export_pptx / save_project switch from
// base64-over-stdio to scoped-fs-reference output when the server session carries a `root`
// (--root). Drives the real MCP server (in-memory client↔server pair, same shape as
// mcp-server.test.ts) so this exercises the actual tool envelope, not just fs-scope.ts in isolation.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, symlinkSync } from "node:fs";
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

let bundleB64: string;
beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" });
  bundleB64 = Buffer.from(bytes).toString("base64");
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
  const d = mkdtempSync(join(tmpdir(), "slidecraft-mcp-scope-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("no --root (default): base64 is unchanged (non-regression)", () => {
  it("save_project returns dataBase64, no path", async () => {
    const client = await connect(null);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = (await call(client, "save_project")).data as Record<string, unknown>;
    expect(typeof res.dataBase64).toBe("string");
    expect(res.path).toBeUndefined();
  });

  it("export_pptx returns dataBase64 + skipped, no path", async () => {
    const client = await connect(null);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = (await call(client, "export_pptx")).data as { dataBase64: string; skipped: number[]; path?: string };
    const bytes = Buffer.from(res.dataBase64, "base64");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(res.skipped).toEqual([]);
    expect(res.path).toBeUndefined();
  });

  it("passing filename with no scope configured is a never-silent guard rejection", async () => {
    const client = await connect(null);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = await call(client, "save_project", { filename: "x.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-not-configured");
  });
});

describe("--root <dir> configured: scoped-fs reference output", () => {
  it("save_project writes a real .scft under the scope and returns {path}, no dataBase64", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = (await call(client, "save_project", { filename: "out.scft" })).data as { path?: string; dataBase64?: string };
    expect(res.dataBase64).toBeUndefined();
    expect(res.path).toBe("file:///out.scft");
    expect(existsSync(join(dir, "out.scft"))).toBe(true);
    expect(readFileSync(join(dir, "out.scft")).subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b]));
  });

  it("export_pptx writes a real .pptx under the scope and returns {path, skipped}", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = (await call(client, "export_pptx", { filename: "deck.pptx" })).data as { path?: string; dataBase64?: string; skipped: number[] };
    expect(res.dataBase64).toBeUndefined();
    expect(res.path).toBe("file:///deck.pptx");
    expect(res.skipped).toEqual([]);
    const onDisk = readFileSync(join(dir, "deck.pptx"));
    expect(onDisk.subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b])); // real, wellformed PK zip on disk
  });

  it("omitting filename auto-generates one inside the scope", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = (await call(client, "export_pptx")).data as { path: string };
    expect(res.path).toMatch(/^file:\/\/\/[^/]+\.pptx$/);
    const name = res.path.replace("file:///", "");
    expect(existsSync(join(dir, name))).toBe(true);
  });

  it("a doc minted AFTER connect (new_project) still inherits the server's scope", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
    await call(client, "new_project", { templateBase64: tBytes.toString("base64"), markdown: "# A" });
    const res = (await call(client, "export_pptx", { filename: "fresh.pptx" })).data as { path: string };
    expect(res.path).toBe("file:///fresh.pptx");
    expect(existsSync(join(dir, "fresh.pptx"))).toBe(true);
  });

  it("../ traversal in filename is rejected never-silently (ok:false, code:scope-violation), no file escapes", async () => {
    const dir = scratchDir();
    const outside = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = await call(client, "export_pptx", { filename: "../" + outside.split("/").pop() + "/escape.pptx" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
    expect(existsSync(join(outside, "escape.pptx"))).toBe(false);
  });

  it("an absolute-path filename is rejected", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = await call(client, "save_project", { filename: "/tmp/escape.scft" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
  });

  it("a pre-existing symlink at the target is never written through", async () => {
    const dir = scratchDir();
    const outside = scratchDir();
    symlinkSync(join(outside, "target.pptx"), join(dir, "link.pptx"));
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = await call(client, "export_pptx", { filename: "link.pptx" });
    expect(res.isError).toBe(false);
    const d = res.data as { ok: boolean; code?: string };
    expect(d.ok).toBe(false);
    expect(d.code).toBe("scope-violation");
    expect(existsSync(join(outside, "target.pptx"))).toBe(false);
  });

  it("generated files round-trip through the existing wellformed golden path (open_project reads them back)", async () => {
    const dir = scratchDir();
    const client = await connect(dir);
    await call(client, "open_project", { dataBase64: bundleB64 });
    await call(client, "save_project", { filename: "roundtrip.scft" });
    const bytesOnDisk = readFileSync(join(dir, "roundtrip.scft"));
    const reopened = await call(client, "open_project", { dataBase64: bytesOnDisk.toString("base64") });
    expect(reopened.isError).toBe(false);
    expect((reopened.data as { slideCount: number }).slideCount).toBeGreaterThan(1);
  });
});
