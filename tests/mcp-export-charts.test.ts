/**
 * mcp-export-charts.test.ts — #554 段 1: MCP `export_pptx` の引数 `charts`（"shapes" | "native"）の契約。
 *
 * - 省略時は既定 "shapes": 結果は従来どおり {dataBase64, skipped} のみ（`charts` キーを足さない）・chart パート無し。
 * - "native": pie / xychart は ppt/charts/ に出て、flowchart は図形のまま。結果に
 *   `charts: {native, shapes}`（never-silent: 何がネイティブ化され何が図形のままかを 1 行で返す）。
 * - 不正値は入力検証で拒否される。
 */
import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { templateBytes } from "./native-chart-fixtures";

// Mermaid pie / xychart graduate to native DiagramSpec on export; the flowchart stays shapes.
const DECK_MD = [
  "# 表紙\n\n## サブ",
  "# 円\n\n```mermaid\npie title シェア\n  \"A\" : 60\n  \"B\" : 40\n```",
  "# 棒\n\n```mermaid\nxychart-beta\n  x-axis [Q1, Q2, Q3]\n  bar [3, 5, 4]\n```",
  "# 流れ\n\n```mermaid\nflowchart LR\n  a[開始] --> b[終了]\n```",
].join("\n\n---\n\n");

let bundleB64: string;
beforeAll(async () => {
  const template = await loadTemplate(templateBytes());
  const bytes = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-11-07T00:00:00Z" });
  bundleB64 = Buffer.from(bytes).toString("base64");
});

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  return res.isError ? { data: text, isError: true } : { data: JSON.parse(text) as Record<string, unknown>, isError: false };
}

async function opened(): Promise<Client> {
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  await call(client, "open_project", { dataBase64: bundleB64 });
  return client;
}

const chartParts = async (b64: string) =>
  Object.keys((await JSZip.loadAsync(Buffer.from(b64, "base64"))).files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort();

describe("export_pptx charts", () => {
  it("is declared on the tool's input schema as an optional shapes|native enum", async () => {
    const client = await opened();
    const tools = await client.listTools();
    const exp = tools.tools.find((t) => t.name === "export_pptx")!;
    const prop = (exp.inputSchema.properties as Record<string, { enum?: string[] }>).charts;
    expect(prop?.enum).toEqual(["shapes", "native"]);
    expect(exp.inputSchema.required ?? []).not.toContain("charts");
  });

  it("omitted → default shapes: same result keys as before, no chart parts", async () => {
    const client = await opened();
    const res = await call(client, "export_pptx");
    expect(res.isError).toBe(false);
    expect(Object.keys(res.data).sort()).toEqual(["dataBase64", "skipped"]);
    expect(await chartParts(res.data.dataBase64 as string)).toEqual([]);
  });

  it("\"shapes\" explicit → identical slides to the default", async () => {
    const client = await opened();
    const a = await JSZip.loadAsync(Buffer.from((await call(client, "export_pptx")).data.dataBase64 as string, "base64"));
    const b = await JSZip.loadAsync(Buffer.from((await call(client, "export_pptx", { charts: "shapes" })).data.dataBase64 as string, "base64"));
    for (const f of Object.keys(a.files).filter((f) => /^ppt\/slides\/.+\.(xml|rels)$/.test(f))) {
      expect(await b.file(f)!.async("string"), f).toBe(await a.file(f)!.async("string"));
    }
  });

  it("\"native\" → pie + xychart as native charts, flowchart stays shapes, counts reported", async () => {
    const client = await opened();
    const res = await call(client, "export_pptx", { charts: "native" });
    expect(res.isError).toBe(false);
    expect(res.data.charts).toEqual({ native: 2, shapes: 1 });
    expect(await chartParts(res.data.dataBase64 as string)).toEqual(["ppt/charts/chart1.xml", "ppt/charts/chart2.xml"]);
  });

  it("rejects an unknown mode", async () => {
    const client = await opened();
    const res = await call(client, "export_pptx", { charts: "image" });
    expect(res.isError).toBe(true);
  });
});
