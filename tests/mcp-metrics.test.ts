/**
 * mcp-metrics.test.ts — #512: MCP の呼出ログ（ローカル JSONL）と ADR-0037 D5 の 3 指標の集計。
 *
 *  1. ログ 1 行の形（純関数 buildRecord / formatMetricsLine / parseMetricsLines）
 *  2. 集計（aggregateMetrics・集計スクリプト）は mcp-metrics-report.test.ts
 *  3. 差し込み点（gatedToolRegistrar 経由の 1 箇所）: 実サーバで open_project → set_slide_markdown が
 *     2 行になる。本文（Markdown・base64）はログに乗らない。
 *  4. 計測オフ＝応答 byte-identical（docId は乱数なので同じ置換をかけて比較）・ファイル非作成。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { TOOL_PROFILES } from "../src/mcp/tool-profiles";
import { buildRecord, formatMetricsLine, parseMetricsLines, type MetricsRecord } from "../src/mcp/metrics";
import { createFileMetricsRecorder, type MetricsRecorder } from "../src/mcp/metrics-sink";

const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";
const SECRET = "秘密の本文テキスト";

let bundleB64: string;
beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" });
  bundleB64 = Buffer.from(bytes).toString("base64");
});

/** 決定論の時計（呼ぶたびに +5ms）と行バッファを持つ recorder。 */
function memRecorder(): MetricsRecorder & { lines: string[] } {
  let t = Date.parse("2026-11-07T00:00:00.000Z");
  const lines: string[] = [];
  return { lines, now: () => (t += 5), write: (line) => lines.push(line) };
}

async function connect(metrics?: MetricsRecorder): Promise<Client> {
  const server = buildServer(createSession(null), metrics ? { metrics } : {});
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

describe("ログ 1 行の形（純関数）", () => {
  it("buildRecord: 読み取りは mutation 欄を持たず、ツール名と数値だけ", () => {
    const r = buildRecord({
      tool: "get_slide",
      profile: "solo",
      startMs: Date.parse("2026-11-07T10:00:00.000Z"),
      endMs: Date.parse("2026-11-07T10:00:00.000Z") + 12.34,
      args: { index: 0, markdown: SECRET },
      result: { content: [{ type: "text", text: JSON.stringify({ markdown: SECRET }) }] },
      obs: { docId: "doc-1" },
    });
    expect(r).toEqual({
      v: 1,
      ts: "2026-11-07T10:00:00.000Z",
      tool: "get_slide",
      profile: "solo",
      doc: "doc-1",
      ms: 12.3,
      outcome: "ok",
      inChars: JSON.stringify({ index: 0, markdown: SECRET }).length,
      outChars: JSON.stringify({ markdown: SECRET }).length,
    });
    const line = formatMetricsLine(r);
    expect(line).not.toContain("\n");
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toEqual(r);
  });

  it("buildRecord: mutation は種別・changed・changedN・wholeDeck を持つ（changedIndices 不明＝丸ごと）", () => {
    const base = { tool: "set_deck_markdown", profile: "collab-ai" as const, startMs: 0, endMs: 1, args: {}, result: { content: [{ type: "text" as const, text: "{}" }] } };
    expect(buildRecord({ ...base, obs: { docId: "d", change: { kind: "edit", changed: true, changedIndices: undefined } } })).toMatchObject({ mut: "edit", changed: true, changedN: null, wholeDeck: true });
    expect(buildRecord({ ...base, obs: { docId: "d", change: { kind: "edit", changed: true, changedIndices: [2, 3] } } })).toMatchObject({ mut: "edit", changed: true, changedN: 2, wholeDeck: false });
    // no-op（changed:false）は丸ごと再生成に数えない
    expect(buildRecord({ ...base, obs: { docId: "d", change: { kind: "edit", changed: false, changedIndices: undefined } } })).toMatchObject({ mut: "edit", changed: false, changedN: null, wholeDeck: false });
    expect(buildRecord({ ...base, obs: { docId: "d", change: { kind: "mint", changed: true, changedIndices: undefined } } })).toMatchObject({ mut: "mint", changed: true, wholeDeck: false });
  });

  it("buildRecord: outcome は ok / reject（ok:false・code は列挙語のみ）/ error（isError）", () => {
    const base = { tool: "set_slide_markdown", profile: "solo" as const, startMs: 0, endMs: 1, args: {}, obs: {} };
    const guard = buildRecord({ ...base, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, error: SECRET, code: "index-out-of-range" }) }] } });
    expect(guard).toMatchObject({ outcome: "reject", code: "index-out-of-range", doc: null });
    expect(formatMetricsLine(guard)).not.toContain(SECRET);
    const stale = buildRecord({ ...base, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, stale: true, expectedRev: 1, currentRev: 2 }) }] } });
    expect(stale).toMatchObject({ outcome: "reject", stale: true });
    expect(stale.code).toBeUndefined();
    // code に列挙語以外（本文が紛れ込む形）が来ても載せない
    const odd = buildRecord({ ...base, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, code: SECRET }) }] } });
    expect(odd.code).toBeUndefined();
    const crash = buildRecord({ ...base, result: { content: [{ type: "text", text: SECRET }], isError: true } });
    expect(crash).toMatchObject({ outcome: "error" });
    expect(formatMetricsLine(crash)).not.toContain(SECRET);
    // handler が throw した（result 無し）も error
    expect(buildRecord({ ...base, result: undefined })).toMatchObject({ outcome: "error", outChars: 0 });
  });

  it("buildRecord: 画像結果の outChars は base64 の長さ", () => {
    const r = buildRecord({ tool: "get_slide_image", profile: "solo", startMs: 0, endMs: 1, args: { index: 0 }, obs: {}, result: { content: [{ type: "image", data: "QUJD", mimeType: "image/png" }] } });
    expect(r.outChars).toBe(4);
    expect(r.outcome).toBe("ok");
  });

  it("parseMetricsLines: 壊れた行は skipped に数えて捨てる（never-silent・空行は無視）", () => {
    const { records, skipped } = parseMetricsLines(readFileSync(resolve(__dirname, "fixtures/mcp-metrics/sample.jsonl"), "utf8"));
    expect(records).toHaveLength(13);
    expect(skipped).toBe(1);
  });
});

describe("#631: 編集経路（route／skipped）の記録 — optional・METRICS_VERSION 据え置き", () => {
  const base = { tool: "set_slide_markdown", profile: "solo" as const, startMs: 0, endMs: 1, args: {}, result: { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] } };
  it("buildRecord: 観測に route があれば route／skipped が JSONL に出る（無ければ出ない）", () => {
    const r = buildRecord({ ...base, obs: { docId: "d", route: { route: "field-ops", skipped: 2 } } });
    expect(r).toMatchObject({ v: 1, route: "field-ops", skipped: 2 });
    expect(JSON.parse(formatMetricsLine(r))).toMatchObject({ route: "field-ops", skipped: 2 });
    const plain = buildRecord({ ...base, obs: { docId: "d" } });
    expect(plain).not.toHaveProperty("route");
    expect(plain).not.toHaveProperty("skipped");
  });
  it("parseMetricsLines: 旧行（route 無し）と新行（route 有り）を同じ版で両方読む", () => {
    const old = '{"v":1,"ts":"2026-11-07T10:00:00.000Z","tool":"set_slide_markdown","profile":"solo","doc":"d","ms":1,"outcome":"ok","inChars":1,"outChars":1}';
    const neu = formatMetricsLine(buildRecord({ ...base, obs: { docId: "d", route: { route: "fallback", skipped: 0 } } }));
    const { records, skipped } = parseMetricsLines(`${old}\n${neu}\n`);
    expect(skipped).toBe(0);
    expect(records).toHaveLength(2);
    expect(records[0].route).toBeUndefined();
    expect(records[1]).toMatchObject({ route: "fallback", skipped: 0 });
  });
  it("実サーバ: set_slide_markdown の Markdown／ops／skip／不正配列／guard 拒否がそれぞれの経路で残る", async () => {
    const rec = memRecorder();
    const c = await connect(rec);
    const call = (name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: args });
    await call("open_project", { dataBase64: bundleB64 });
    const slide = JSON.parse(((await call("get_deck")) as unknown as { content: Array<{ text: string }> }).content[0].text).slides[1];
    const body = slide.placeholders.find((p: { idx: string }) => p.idx !== "0" && p.idx !== "15").idx as string;
    rec.lines.length = 0;
    await call("set_slide_markdown", { index: 1, markdown: `# 中身\n\n- ${SECRET}` });
    await call("set_slide_markdown", { index: 1, markdown: JSON.stringify([{ op: "setField", idx: body, text: SECRET }]) });
    await call("set_slide_markdown", { index: 1, markdown: JSON.stringify([{ op: "setField", idx: "99", text: "x" }]) });
    await call("set_slide_markdown", { index: 1, markdown: JSON.stringify([{ op: "setField", idx: body }]) });
    await call("set_slide_markdown", { index: 99, markdown: "[]" });
    const rs = rec.lines.map((l) => JSON.parse(l) as MetricsRecord);
    expect(rs.map((r) => [r.route, r.skipped, r.outcome])).toEqual([
      ["markdown", 0, "ok"],
      ["field-ops", 0, "ok"],
      ["field-ops", 1, "ok"],
      ["fallback", 0, "ok"],
      [undefined, undefined, "reject"],
    ]);
    for (const l of rec.lines) expect(l).not.toContain(SECRET);
  });
});

describe("差し込み点: 実サーバの全ツール呼出が 1 行ずつ記録される", () => {
  type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as unknown as CallRes;

  it("open_project → set_slide_markdown で 2 行（ツール名・プロファイル・ok・同じ docId・mutation 情報）", async () => {
    const rec = memRecorder();
    const c = await connect(rec);
    await call(c, "open_project", { dataBase64: bundleB64 });
    await call(c, "set_slide_markdown", { index: 1, markdown: `# 中身\n\n- ${SECRET}` });
    expect(rec.lines).toHaveLength(2);
    const [a, b] = rec.lines.map((l) => JSON.parse(l) as MetricsRecord);
    expect(a).toMatchObject({ v: 1, tool: "open_project", profile: "solo", outcome: "ok", mut: "mint", changed: true, wholeDeck: false, ms: 5 });
    expect(b).toMatchObject({ v: 1, tool: "set_slide_markdown", profile: "solo", outcome: "ok", mut: "edit", changed: true, changedN: 1, wholeDeck: false, doc: a.doc });
    expect(a.doc).toMatch(/^[0-9a-f-]{36}$/);
    // 本文も base64 もログに乗らない
    for (const l of rec.lines) {
      expect(l).not.toContain(SECRET);
      expect(l).not.toContain(bundleB64.slice(0, 40));
    }
  });

  it("読み取り・guard 拒否・入力なしツール・undo も同じ 1 箇所で記録される", async () => {
    const rec = memRecorder();
    const c = await connect(rec);
    await call(c, "open_project", { dataBase64: bundleB64 });
    await call(c, "get_slide", { index: 0 });
    await call(c, "set_slide_markdown", { index: 99, markdown: "# x" });
    await call(c, "get_diagram_types");
    await call(c, "set_deck_markdown", { markdown: DECK_MD + "\n\n---\n\n# 追加" });
    await call(c, "undo");
    const rs = rec.lines.map((l) => JSON.parse(l) as MetricsRecord);
    expect(rs.map((r) => r.tool)).toEqual(["open_project", "get_slide", "set_slide_markdown", "get_diagram_types", "set_deck_markdown", "undo"]);
    expect(rs[1]).toMatchObject({ outcome: "ok", doc: rs[0].doc });
    expect(rs[1].mut).toBeUndefined();
    expect(rs[2]).toMatchObject({ outcome: "reject", code: "index-out-of-range", doc: rs[0].doc });
    expect(rs[3]).toMatchObject({ outcome: "ok", doc: null, inChars: 0 });
    expect(rs[4]).toMatchObject({ mut: "edit", changed: true, changedN: null, wholeDeck: true });
    expect(rs[5]).toMatchObject({ mut: "undo", changed: true, wholeDeck: false });
    // 記録されたツール名は表の名前（第 2 の一覧を作らない — R8）
    for (const r of rs) expect(r.tool in TOOL_PROFILES).toBe(true);
  });

  it("collab-ai プロファイルの host でも profile 欄が正しく出る", async () => {
    const { DocRegistry } = await import("../src/mcp/host-core");
    const registry = new DocRegistry();
    const rec = memRecorder();
    const server = buildServer(createSession(null), {
      metrics: rec,
      registerResources: false,
      host: { registry, active: () => undefined, setActive: () => {}, sharedOnly: true },
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const c = new Client({ name: "t", version: "1" });
    await c.connect(clientT);
    await call(c, "list_documents");
    expect(JSON.parse(rec.lines[0])).toMatchObject({ tool: "list_documents", profile: "collab-ai", outcome: "ok", doc: null });
  });
});

describe("collab host: metricsPath で全接続が 1 ファイルに profile 付きで記録される", () => {
  it("GUI ロールと AI ロールの呼出がそれぞれ collab-gui / collab-ai で残る", async () => {
    const { createCollabHost } = await import("../src/mcp/host");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-metrics-host-"));
    const path = join(dir, "host.jsonl");
    const host = await createCollabHost({ port: 0, hostJsonPath: null, metricsPath: path });
    try {
      const open = async (role?: "gui") => {
        const headers: Record<string, string> = { Authorization: `Bearer ${host.token}`, ...(role ? { "x-slidecraft-role": role } : {}) };
        const c = new Client({ name: role ?? "ai", version: "1" });
        await c.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers } }));
        return c;
      };
      const gui = await open("gui");
      const ai = await open();
      await gui.callTool({ name: "list_documents", arguments: {} });
      await ai.callTool({ name: "get_diagram_types", arguments: {} });
      const rs = parseMetricsLines(readFileSync(path, "utf8")).records;
      expect(rs.map((r) => [r.tool, r.profile, r.outcome])).toEqual([
        ["list_documents", "collab-gui", "ok"],
        ["get_diagram_types", "collab-ai", "ok"],
      ]);
      await gui.close();
      await ai.close();
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("計測オフ＝不変・ファイル I/O は 1 箇所", () => {
  const SCRIPT: [string, Record<string, unknown> | "bundle"][] = [
    ["open_project", "bundle"],
    ["get_slide", { index: 0 }],
    ["set_slide_markdown", { index: 1, markdown: "# 中身\n\n- a\n- b" }],
    ["set_slide_markdown", { index: 99, markdown: "# x" }],
    ["set_slide_markdown", { index: 1, markdown: "# 中身\n\n- a\n- b", expectedRev: 0 }],
    ["get_deck_issues", {}],
    ["undo", {}],
    ["redo", {}],
    ["get_diagram_types", {}],
    ["validate_deck", {}],
  ];
  async function transcript(metrics?: MetricsRecorder): Promise<string> {
    const c = await connect(metrics);
    const out: unknown[] = [await c.listTools()];
    let docId = "";
    for (const [name, a] of SCRIPT) {
      const res = await c.callTool({ name, arguments: a === "bundle" ? { dataBase64: bundleB64 } : a });
      if (name === "open_project") docId = (JSON.parse((res.content as { text: string }[])[0].text) as { docId: string }).docId;
      out.push(res);
    }
    // docId だけは実行ごとの乱数（randomUUID）なので同じ置換をかけて比べる
    return JSON.stringify(out).split(docId).join("<docId>");
  }

  it("metrics 有り/無しで tools/list と全応答が byte-identical（一致テスト）", async () => {
    const off = await transcript();
    const rec = memRecorder();
    const on = await transcript(rec);
    expect(on).toBe(off);
    expect(rec.lines).toHaveLength(SCRIPT.length);
  });

  it("file recorder: 最初の記録までファイルを作らず、記録は JSONL 追記（親ディレクトリは作らない）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-metrics-"));
    try {
      const path = join(dir, "calls.jsonl");
      const rec = createFileMetricsRecorder(path);
      expect(existsSync(path)).toBe(false);
      const c = await connect(rec);
      await c.callTool({ name: "open_project", arguments: { dataBase64: bundleB64 } });
      await c.callTool({ name: "set_slide_markdown", arguments: { index: 1, markdown: "# 中身\n\n- a" } });
      const { records, skipped } = parseMetricsLines(readFileSync(path, "utf8"));
      expect(skipped).toBe(0);
      expect(records.map((r) => [r.tool, r.profile, r.outcome])).toEqual([
        ["open_project", "solo", "ok"],
        ["set_slide_markdown", "solo", "ok"],
      ]);
      // 2 本目の recorder で追記される（上書きしない）
      const c2 = await connect(createFileMetricsRecorder(path));
      await c2.callTool({ name: "get_diagram_types", arguments: {} });
      expect(parseMetricsLines(readFileSync(path, "utf8")).records).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("計測オフの実サーバはどこにもファイルを作らない（cwd に何も増えない）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-metrics-off-"));
    const prev = process.cwd();
    try {
      process.chdir(dir);
      const c = await connect();
      await c.callTool({ name: "open_project", arguments: { dataBase64: bundleB64 } });
      await c.callTool({ name: "set_slide_markdown", arguments: { index: 1, markdown: "# 中身\n\n- a" } });
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      process.chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("書き込み失敗はツール呼出を壊さない（stderr に 1 度だけ告げて以後は記録しない）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-metrics-bad-"));
    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (s: string) => (writes.push(String(s)), true);
    try {
      const rec = createFileMetricsRecorder(join(dir, "no-such-dir", "calls.jsonl"));
      const c = await connect(rec);
      const r1 = (await c.callTool({ name: "get_diagram_types", arguments: {} })) as { isError?: boolean };
      const r2 = (await c.callTool({ name: "get_diagram_types", arguments: {} })) as { isError?: boolean };
      expect(r1.isError).toBeFalsy();
      expect(r2.isError).toBeFalsy();
      expect(writes.filter((w) => w.includes("metrics")).length).toBe(1);
    } finally {
      (process.stderr as { write: unknown }).write = orig;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
