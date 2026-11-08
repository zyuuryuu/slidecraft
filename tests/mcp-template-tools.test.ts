/**
 * mcp-template-tools.test.ts — #568 段 3 / #570 段 3 の MCP 口（in-memory client↔server・solo）。
 *
 *  - augment_template({ structures?, rule? }): 開いている doc のテンプレに無い構造を合成した**派生テンプレ**を
 *    その doc に適用する。元テンプレ（open 時の bytes）は不変。足したもの・足さなかった理由を返す（never-silent）。
 *  - adjust_template({ recipe }): #570 のレシピ（JSON 文字列）で派生テンプレを作って適用する。
 *  - どちらも「元テンプレ＋レシピ（書体置換 → 倍率 → 合成の固定順）」から毎回作り直す（倍率が重ならない）。
 *  - get_deck_issues: `*-overflow` があるときだけ info `overflow-scale-hint` を 1 件足し、hints に
 *    adjust_template（絶対レシピ付き）を出す。溢れが無いデッキの応答は従来どおり。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseMd } from "../src/engine/md-parser";
import { countOverflows } from "../src/engine/overflow-scale-hint";
import { DocRegistry, MemTemplateStore, type HostContext } from "../src/mcp/host-core";

const TECH = readFileSync(resolve(__dirname, "fixtures/templates/技術報告_スタンダード水色_全レイアウト見本.pptx"));
const GROUPED = readFileSync(resolve(__dirname, "fixtures/templates/Dirty_Grouped_TemplateOnly.pptx"));

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function connect(): Promise<{ client: Client }> {
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return { client };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  expect(res.isError, res.content[0]?.text).toBeFalsy();
  return JSON.parse(res.content[0]?.text ?? "null") as Record<string, unknown>;
}
/** collab ホスト（sharedOnly: false＝GUI ロール / true＝AI ロール）への接続。 */
async function connectCollab(sharedOnly: boolean): Promise<{ client: Client }> {
  const host: HostContext = { registry: new DocRegistry(), active: () => undefined, setActive: () => {}, sharedOnly, templates: new MemTemplateStore() };
  const server = buildServer(createSession(null), { host, registerResources: false });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return { client };
}
const layoutsOf = async (client: Client) => ((await call(client, "get_template_capabilities")).entries as Array<{ name: string }>).map((e) => e.name);

const bullets = (n: number, chars = 30) => Array.from({ length: n }, (_, i) => `- ${String(i).padStart(2, "0")}${"あ".repeat(chars)}`).join("\n");

/** Smallest bullet count overflowing 技術報告's content body (same 1 path as the engine). */
let overN = 0;
beforeAll(async () => {
  const t = await loadTemplate(TECH);
  const cat = buildCatalog(t);
  for (let n = 1; n < 80 && !overN; n++) {
    const d = parseMd(`# 表紙\n\n---\n\n# 本文\n\n${bullets(n)}`, cat);
    if (countOverflows(diagnoseDeck(d, cat, t.layouts)) > 0) overN = n;
  }
  expect(overN).toBeGreaterThan(0);
});

describe("augment_template", () => {
  it("adds the missing structures to the doc's template, reports added + skipped; the source bytes are untouched", async () => {
    const { client } = await connect();
    const src = new Uint8Array(GROUPED);
    const copy = src.slice();
    await call(client, "new_project", { templateBase64: Buffer.from(src).toString("base64"), markdown: "# 表紙\n\n---\n\n# 本文\n\n- a" });
    const before = await layoutsOf(client);
    const r = await call(client, "augment_template", {});
    const added = r.added as Array<{ structure: string; name: string }>;
    expect(added.map((a) => a.structure)).toEqual(["columns-2", "columns-3", "compare-2", "card-3", "kpi-3", "kpi-4"]);
    const after = await layoutsOf(client);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(added.map((a) => a.name));
    expect(r.templateName).toMatch(/（強化）$/);
    expect(Buffer.compare(Buffer.from(src), Buffer.from(copy))).toBe(0);
  });

  it("structures narrows what is added; already-present structures come back in skipped with a reason; a second call adds nothing", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    const r = await call(client, "augment_template", { structures: ["compare-2", "kpi-4"] });
    expect((r.added as Array<{ structure: string }>).map((a) => a.structure)).toEqual(["kpi-4"]);
    const skipped = r.skipped as Array<{ structure: string; reason: string }>;
    expect(skipped.map((s) => s.structure)).toEqual(["compare-2"]);
    expect(skipped[0].reason).toContain("12_課題と対策");
    const again = await call(client, "augment_template", { structures: ["kpi-4"] });
    expect(again.added).toEqual([]);
    expect(again.changed).toBe(false);
  });

  it("PR #606 D1: rule omitted → explicit default → omitted never re-installs (the effective rule did not change); a real rule change does", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    const first = await call(client, "augment_template", { structures: ["kpi-4"] });
    expect(first.changed).toBe(true);
    const explicit = await call(client, "augment_template", { structures: ["kpi-4"], rule: "steps" });
    expect(explicit.changed).toBe(false);
    const omitted = await call(client, "augment_template", { structures: ["kpi-4"] });
    expect(omitted.changed).toBe(false);
    expect(omitted.added).toEqual([]);
    const ratio = await call(client, "augment_template", { structures: ["kpi-4"], rule: "ratio" });
    expect(ratio.changed).toBe(true);
    const keep = await call(client, "augment_template", { structures: ["kpi-4"] });
    expect(keep.changed).toBe(false); // omitted keeps the doc's rule (ratio), so nothing changes
  });

  it("a template with no usable base: nothing applied, the reason is returned (never-silent)", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: readFileSync(resolve(__dirname, "fixtures/templates/Dirty_AllBody_TemplateOnly.pptx")).toString("base64") });
    const before = await layoutsOf(client);
    const r = await call(client, "augment_template", { structures: ["card-3"] });
    expect(r.changed).toBe(false);
    expect(String(r.reason)).toContain("元にするレイアウト");
    expect(await layoutsOf(client)).toEqual(before);
  });
});

describe("adjust_template", () => {
  it("applies the recipe as a derived template (body ×0.9 grows the body budget) and rebuilds from the source, so scales never stack", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    const cap = async () => ((await call(client, "get_template_capabilities")).budget as { maxBullets: number }).maxBullets;
    const base = await cap();
    const r1 = await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    expect(r1.templateName).toMatch(/（調整）$/);
    const once = await cap();
    expect(once).toBeGreaterThanOrEqual(base);
    await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    expect(await cap()).toBe(once); // same recipe from the same source → same template, not 0.81
  });

  it("adjust then augment: the order is fixed (fonts → scale → augment) whichever tool is called first", async () => {
    const a = await connect();
    await call(a.client, "new_project", { templateBase64: TECH.toString("base64") });
    await call(a.client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    await call(a.client, "augment_template", { structures: ["kpi-4"] });
    const b = await connect();
    await call(b.client, "new_project", { templateBase64: TECH.toString("base64") });
    await call(b.client, "augment_template", { structures: ["kpi-4"] });
    await call(b.client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    const caps = async (c: Client) => JSON.stringify((await call(c, "get_template_capabilities")).entries);
    expect(await caps(a.client)).toBe(await caps(b.client));
  });

  it("PR #606 D2: a no-op recipe {} (or the recipe already applied) is changed:false with a reason; {} after a real recipe resets it (changed:true)", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    const info0 = await call(client, "get_project_info");
    const noop = await call(client, "adjust_template", { recipe: "{}" });
    expect(noop.changed).toBe(false);
    expect(String(noop.reason)).toContain("変わりません");
    expect((await call(client, "get_project_info")).templateName).toBe(info0.templateName);
    const r1 = await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    expect(r1.changed).toBe(true);
    const same = await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: 0.9 } }) });
    expect(same.changed).toBe(false);
    const reset = await call(client, "adjust_template", { recipe: "{}" });
    expect(reset.changed).toBe(true);
    expect(reset.templateName).not.toMatch(/（調整）$/);
  });

  it("a malformed recipe is a modeled invalid-argument (nothing applied)", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    const before = await layoutsOf(client);
    for (const recipe of ["{", JSON.stringify({ scale: { body: -1 } }), JSON.stringify({ scale: { size: 2 } })]) {
      const r = await call(client, "adjust_template", { recipe });
      expect(r).toMatchObject({ ok: false, code: "invalid-argument" });
    }
    expect(await layoutsOf(client)).toEqual(before);
  });

  it("the derived template is what save_project bundles (the .scft carries it)", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    await call(client, "augment_template", { structures: ["kpi-4"] });
    const saved = await call(client, "save_project");
    const z = await JSZip.loadAsync(Buffer.from(String(saved.dataBase64), "base64"));
    const inner = await z.file("template.pptx")!.async("uint8array");
    expect((await loadTemplate(inner)).layouts.some((l) => l.name.endsWith("+4KPI"))).toBe(true);
  });
});

describe("get_deck_issues — overflow-scale-hint (#570 段 3)", () => {
  it("no overflow → the response is exactly the session diagnostics (unchanged) with no hint", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64"), markdown: "# 表紙\n\n---\n\n# 本文\n\n- a" });
    const r = await call(client, "get_deck_issues");
    const issues = r.issues as Array<{ id?: string }>;
    expect(issues.some((i) => i.id === "overflow-scale-hint")).toBe(false);
    expect((r.hints as Array<{ tool: string }>).some((h) => h.tool === "adjust_template")).toBe(false);
  });

  it("an overflow → one info issue naming the scale and N→M, plus an adjust_template hint with the absolute recipe", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    await call(client, "set_slide_markdown", { index: 0, markdown: `# 本文\n\n${bullets(overN)}` });
    const r = await call(client, "get_deck_issues");
    const issues = r.issues as Array<{ id?: string; level: string; message: string }>;
    const hint = issues.filter((i) => i.id === "overflow-scale-hint");
    expect(hint).toHaveLength(1);
    expect(hint[0].level).toBe("info");
    expect(hint[0].message).toMatch(/(0\.95|0\.9|0\.85) 倍/);
    const h = (r.hints as Array<{ tool: string; args?: { recipe?: string } }>).find((x) => x.tool === "adjust_template");
    expect(h).toBeDefined();
    const scale = Number(hint[0].message.match(/(0\.\d+) 倍/)![1]);
    expect(JSON.parse(h!.args!.recipe!)).toEqual({ scale: { body: scale } });
    // applying the hinted recipe clears the overflows it promised to clear
    await call(client, "adjust_template", { recipe: h!.args!.recipe! });
    const after = await call(client, "get_deck_issues");
    const m = Number(hint[0].message.match(/→(\d+) 件/)![1]);
    expect((after.issues as Array<{ id?: string }>).filter((i) => i.id?.endsWith("-overflow")).length).toBe(m);
  });

  it("set_review_rules can turn the hint off", async () => {
    const { client } = await connect();
    await call(client, "new_project", { templateBase64: TECH.toString("base64") });
    await call(client, "set_slide_markdown", { index: 0, markdown: `# 本文\n\n${bullets(overN)}` });
    await call(client, "set_review_rules", { rules: { "overflow-scale-hint": "off" } });
    const r = await call(client, "get_deck_issues");
    expect((r.issues as Array<{ id?: string }>).some((i) => i.id === "overflow-scale-hint")).toBe(false);
  });
});

describe("#616: the template-derive tools are back on every profile (collab syncs the template to the GUI — PR #606 D3 lifted)", () => {
  for (const sharedOnly of [false, true]) {
    it(`collab ${sharedOnly ? "AI" : "GUI"}: augment_template / adjust_template are registered, and get_deck_issues hints adjust_template`, async () => {
      const { client } = await connectCollab(sharedOnly);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("augment_template");
      expect(names).toContain("adjust_template");
      await call(client, "new_project", { templateBase64: TECH.toString("base64") });
      await call(client, "set_slide_markdown", { index: 0, markdown: `# 本文\n\n${bullets(overN)}` });
      const r = await call(client, "get_deck_issues");
      expect(countOverflows(r.issues as never)).toBeGreaterThan(0);
      expect((r.issues as Array<{ id?: string }>).some((i) => i.id === "overflow-scale-hint")).toBe(true);
      expect((r.hints as Array<{ tool: string }>).some((h) => h.tool === "adjust_template")).toBe(true);
    });
  }
});
