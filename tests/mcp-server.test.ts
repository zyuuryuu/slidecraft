/**
 * mcp-server.test.ts — drives the real MCP server through an in-memory client↔server pair
 * (no subprocess, no build): list tools, run the open→edit→validate→export loop over the
 * protocol, and confirm engine errors surface as isError tool results.
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
beforeAll(async () => {
  const template = await loadTemplate(
    readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")),
  );
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
  // error results carry a plain message (not JSON); success results carry result JSON.
  return res.isError ? { data: text, isError: true } : { data: JSON.parse(text) as unknown, isError: false };
}

describe("mcp server (in-memory client↔server pair)", () => {
  it("lists the deterministic tool surface", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["open_project", "get_diagnostics", "apply_slide_markdown", "distill", "visualize_key_value", "set_diagram", "validate", "export_pptx"]) {
      expect(names).toContain(n);
    }
  });

  it("open → get_slide_markdown → apply_slide_markdown → validate round trip", async () => {
    const client = await connect();
    const opened = (await call(client, "open_project", { dataBase64: bundleB64 })).data as { slideCount: number };
    expect(opened.slideCount).toBeGreaterThan(1);

    const slideMd = (await call(client, "get_slide_markdown", { index: 1 })).data as string;
    expect(slideMd).toContain("速度");

    const applied = (await call(client, "apply_slide_markdown", { index: 1, markdown: "# 差替\n\n- 一点" })).data as { ok: boolean; afterMd: string };
    expect(applied.ok).toBe(true);
    expect(applied.afterMd).toContain("差替");

    const v = (await call(client, "validate")).data as { ok: boolean; exportReadiness: string };
    expect(v.ok).toBe(true);
    expect(v.exportReadiness).toBe("native-ok");
  });

  it("export_pptx returns base64 PK-zip bytes (headless native export)", async () => {
    const client = await connect();
    await call(client, "open_project", { dataBase64: bundleB64 });
    const exp = (await call(client, "export_pptx")).data as { dataBase64: string };
    const bytes = Buffer.from(exp.dataBase64, "base64");
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K' → valid OOXML zip
  });

  it("surfaces engine errors as isError tool results (out-of-range slide)", async () => {
    const client = await connect();
    await call(client, "open_project", { dataBase64: bundleB64 });
    const res = await call(client, "get_slide_markdown", { index: 99 });
    expect(res.isError).toBe(true);
    expect(String(res.data)).toMatch(/範囲外/);
  });
});
