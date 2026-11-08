/**
 * overflow-scale-hint-670.test.ts — #670: get_deck_issues の本文倍率提案（overflow-scale-hint）が、プリセットの
 * 本文倍率の適用範囲（裁定 B・PR #635: 倍率前 21pt＝PRESET_BODY_MAX_PT 以下の枠だけ）と食い違っていた。
 *
 * fix 方針 A: 適用範囲の定義を template-adjust.ts の 1 関数に寄せ、hint の試算も本番の適用（adjustTemplate を
 * 呼ぶ adjust_template／GUI）も同じ関数を通す（R8）。プリセット由来のテンプレ＝テンプレのメタ
 * （TemplateData.styleDensity・docProps/custom.xml）を持つもの。
 *
 *  (a) 一致テスト（R8）: プリセット由来のテンプレに本文倍率を掛けたとき、変わる枠＝プリセットが倍率を掛けた枠。
 *  (b) Executive の見本で KPI 値枠だけが溢れるデッキ → hint は提案しない（どの倍率でも減らない）。
 *  (c) 一致テスト（R8）: hint の予告件数＝提案倍率を adjustTemplate で適用して再診断した件数。
 *  (d) MCP: get_deck_issues が hint を出さず、adjust_template で同じ倍率を掛けても KPI 値枠の溢れは残る。
 * プリセット由来でないテンプレの hint は不変（overflow-scale-hint.test.ts / mcp-template-tools.test.ts の既存 golden）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck, type DeckIssue } from "../src/engine/deck-diagnostics";
import { adjustTemplate } from "../src/engine/template-adjust";
import { writeTemplate } from "../src/engine/template-writer";
import { EXECUTIVE_PRESET, presetToSpec, writePresetTemplate } from "../src/engine/template-presets";
import { parseMd } from "../src/engine/md-parser";
import type { DeckIR } from "../src/engine/slide-schema";
import { OVERFLOW_SCALE_CANDIDATES, countOverflows, suggestBodyScale } from "../src/engine/overflow-scale-hint";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const EXEC_SAMPLE = new Uint8Array(readFileSync(resolve(__dirname, "fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx")));

const COVER = "# 表紙\n\nサブ\n\n---\n\n";
/** KPI 3 つ。最初の値「4.2 億円」は Executive の KPI.3Value.Equal（値枠 52pt）で 1 行に収まらない（#643 と同じ実測）。 */
const KPI_MD = COVER + "# 3 つの効果\n\n<!-- kpi -->\n### コスト\n- 4.2 億円\n- 前年比\n\n<!-- kpi -->\n### 問い合わせ\n- 40% 減\n\n<!-- kpi -->\n### 立ち上がり\n- 2 週";
const bodyMd = (n: number, chars = 30) =>
  COVER + `# 本文\n\n${Array.from({ length: n }, (_, i) => `- ${String(i).padStart(2, "0")}${"あ".repeat(chars)}`).join("\n")}`;

const issuesOf = (deck: DeckIR, t: TemplateData): DeckIssue[] => diagnoseDeck(deck, buildCatalog(t), t.layouts);
const overflowIds = (deck: DeckIR, t: TemplateData) => issuesOf(deck, t).filter((i) => i.id?.endsWith("-overflow")).map((i) => i.id);
const overflowsAt = async (bytes: Uint8Array, deck: DeckIR, body: number) =>
  countOverflows(issuesOf(deck, await loadTemplate(await adjustTemplate(bytes, { scale: { body } }))));

/** master／レイアウトの `<p:sp>` ごとの最大 defRPr sz（part 名＋図形名で引く）。 */
async function frameSizes(bytes: Uint8Array): Promise<Map<string, number>> {
  const z = await JSZip.loadAsync(bytes);
  const out = new Map<string, number>();
  for (const p of Object.keys(z.files).filter((f) => /^ppt\/(slideLayouts\/slideLayout|slideMasters\/slideMaster)\d+\.xml$/.test(f))) {
    const xml = await z.file(p)!.async("string");
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
      const sz = [...sp.matchAll(/<a:defRPr\b[^>]*?\bsz="(\d+)"/g)].map((m) => Number(m[1]));
      if (sz.length) out.set(`${p}#${sp.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/)?.[1]}`, Math.max(...sz));
    }
  }
  return out;
}
const changedFrames = (a: Map<string, number>, b: Map<string, number>) => [...a.keys()].filter((k) => a.get(k) !== b.get(k)).sort();

let exec: TemplateData;
let kpiDeck: DeckIR;
beforeAll(async () => {
  exec = await loadTemplate(EXEC_SAMPLE);
  kpiDeck = parseMd(KPI_MD, buildCatalog(exec));
});

describe("#670 (a) 適用範囲: プリセット由来のテンプレでは、本文倍率はプリセットが倍率を掛けた枠だけに掛かる", () => {
  it("Executive の見本はプリセット由来（メタ styleDensity を持つ）", () => {
    expect(exec.styleDensity?.bodyPt).toBe(EXECUTIVE_PRESET.density.bodyPt);
  });

  it("adjustTemplate(×0.9) で変わる枠 ＝ writePresetTemplate が倍率を掛けた枠（R8 一致テスト）", async () => {
    const base = await frameSizes(await writeTemplate(presetToSpec(EXECUTIVE_PRESET)));
    const presetBytes = await writePresetTemplate(EXECUTIVE_PRESET);
    const preset = await frameSizes(presetBytes);
    const scaledByPreset = changedFrames(base, preset);
    expect(scaledByPreset.length).toBeGreaterThan(0);
    const scaledByAdjust = changedFrames(preset, await frameSizes(await adjustTemplate(presetBytes, { scale: { body: 0.9 } })));
    expect(scaledByAdjust).toEqual(scaledByPreset);
  });

  it("明示の bodyMaxPt はそのまま使う（レシピ側の指定が優先）", async () => {
    const presetBytes = await writePresetTemplate(EXECUTIVE_PRESET);
    const before = await frameSizes(presetBytes);
    const huge = changedFrames(before, await frameSizes(await adjustTemplate(presetBytes, { scale: { body: 0.9, bodyMaxPt: 400 } })));
    const auto = changedFrames(before, await frameSizes(await adjustTemplate(presetBytes, { scale: { body: 0.9 } })));
    expect(huge.length).toBeGreaterThan(auto.length);
  });
});

describe("#670 (b)(c) hint と本番の一致", () => {
  it("Executive の見本で KPI 値枠だけが溢れるデッキ → 提案しない（どの倍率でも溢れは減らない）", async () => {
    expect(overflowIds(kpiDeck, exec)).toEqual(["kpi-value-overflow"]);
    expect(await suggestBodyScale(EXEC_SAMPLE, kpiDeck)).toBeUndefined();
    for (const f of OVERFLOW_SCALE_CANDIDATES) expect(await overflowsAt(EXEC_SAMPLE, kpiDeck, f)).toBe(1);
  });

  it("Executive の本文溢れには提案が出て、予告件数＝提案倍率を adjustTemplate で掛けて再診断した件数", async () => {
    let deck: DeckIR | undefined;
    for (let n = 1; n < 40 && !deck; n++) {
      const d = parseMd(bodyMd(n, 12), buildCatalog(exec));
      if (overflowIds(d, exec).includes("body-overflow")) deck = d;
    }
    expect(deck).toBeDefined();
    const s = await suggestBodyScale(EXEC_SAMPLE, deck!);
    expect(s).toBeDefined();
    expect(s!.before).toBe(countOverflows(issuesOf(deck!, exec)));
    expect(await overflowsAt(EXEC_SAMPLE, deck!, s!.scale)).toBe(s!.after);
  });
});

describe("#670 (d) MCP get_deck_issues / adjust_template", () => {
  type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
  async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
    expect(res.isError, res.content[0]?.text).toBeFalsy();
    return JSON.parse(res.content[0]?.text ?? "null") as Record<string, unknown>;
  }

  it("KPI 値枠だけの溢れには hint を出さず、adjust_template で倍率を掛けても溢れは残る（hint の言うとおり）", async () => {
    const server = buildServer(createSession(null));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientT);
    await call(client, "new_project", { templateBase64: Buffer.from(EXEC_SAMPLE).toString("base64"), markdown: KPI_MD });
    const ids = async () => ((await call(client, "get_deck_issues")).issues as Array<{ id?: string }>).map((i) => i.id);
    expect(await ids()).toContain("kpi-value-overflow");
    expect(await ids()).not.toContain("overflow-scale-hint");
    await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: Math.min(...OVERFLOW_SCALE_CANDIDATES) } }) });
    expect(await ids()).toContain("kpi-value-overflow");
  });
});
