/**
 * overflow-scale-hint-670-derived.test.ts — PR #682 統括レビューの要修正: 派生済みのプリセット由来テンプレ
 * （adjust_template で本文倍率を掛けた後の Executive）で、get_deck_issues の本文倍率提案（overflow-scale-hint）の
 * 試算と adjust_template の適用が別の入力から作られていた。
 *
 *  - 試算（修正前）: 今の（派生後の）bytes × 候補倍率。
 *  - 適用: 元テンプレ bytes × 絶対レシピ（前回の本文倍率 × 候補倍率）で作り直す。
 * 本文倍率の上限（プリセット由来の枠だけに掛ける・bodyMaxPtFor）はメタの bodyPt から決まる固定値なのに、
 * 比べる枠は前回倍率で拡大済みなので、試算だけ除外される枠が出る（統括の実測: 前回 ×1.2 で 10 枠／12 枠、
 * ×1.3 で 9 枠／12 枠）。
 *
 *  (e) 一致テスト（R8）: hint が試算したテンプレ ＝ 提案レシピを adjust_template が適用したテンプレ（枠ごとのサイズ）。
 *  (f) hint が予告する溢れ件数 ＝ 提案レシピを adjust_template で適用した結果の overflow.after。
 * どちらも前回の本文倍率 1.2 と 1.3 の 2 点で見る。
 *
 * 試算したテンプレは adjustTemplate の呼び出しを記録して取り出す（動作は素通し・戻り値は本物）。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as TA from "../src/engine/template-adjust";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseMd } from "../src/engine/md-parser";
import { OVERFLOW_SCALE_CANDIDATES } from "../src/engine/overflow-scale-hint";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

const trials: Uint8Array[] = [];
vi.mock("../src/engine/template-adjust", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/engine/template-adjust")>();
  return {
    ...orig,
    adjustTemplate: async (...a: Parameters<typeof orig.adjustTemplate>) => {
      const out = await orig.adjustTemplate(...a);
      trials.push(out);
      return out;
    },
  };
});

const EXEC_SAMPLE = new Uint8Array(readFileSync(resolve(__dirname, "fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx")));
const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const bodyMd = (n: number) => COVER + `# 本文\n\n${Array.from({ length: n }, (_, i) => `- ${String(i).padStart(2, "0")}${"あ".repeat(12)}`).join("\n")}`;

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

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  expect(res.isError, res.content[0]?.text).toBeFalsy();
  return JSON.parse(res.content[0]?.text ?? "null") as Record<string, unknown>;
}

/** 前回倍率 prev を掛けた Executive で本文が溢れる最小の箇条書き数（デッキは 1 枚の本文スライド＋表紙）。 */
async function overflowingMd(prev: number): Promise<string> {
  const t = await loadTemplate(await TA.adjustTemplate(EXEC_SAMPLE, { scale: { body: prev } }));
  for (let n = 1; n < 40; n++) {
    const md = bodyMd(n);
    const deck = parseMd(md, buildCatalog(t));
    if (diagnoseDeck(deck, buildCatalog(t), t.layouts).some((i) => i.id === "body-overflow")) return md;
  }
  throw new Error("no overflowing deck");
}

describe.each([1.2, 1.3])("#670 / PR #682: 前回の本文倍率 ×%s の派生テンプレで hint と adjust_template が一致する", (prev) => {
  let hintRecipe: string;
  let hintScale: number;
  let hintAfter: number;
  let trialForHint: Uint8Array;
  let client: Client;

  beforeAll(async () => {
    const markdown = await overflowingMd(prev);
    const server = buildServer(createSession(null));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientT);
    await call(client, "new_project", { templateBase64: Buffer.from(EXEC_SAMPLE).toString("base64"), markdown });
    await call(client, "adjust_template", { recipe: JSON.stringify({ scale: { body: prev } }) });
    trials.length = 0;
    const r = await call(client, "get_deck_issues");
    const hint = (r.issues as Array<{ id?: string; message: string }>).find((i) => i.id === "overflow-scale-hint");
    expect(hint, "前回倍率の派生テンプレでも本文溢れに提案が出る").toBeDefined();
    hintScale = Number(hint!.message.match(/(0\.\d+) 倍/)![1]);
    hintAfter = Number(hint!.message.match(/→(\d+) 件/)![1]);
    hintRecipe = (r.hints as Array<{ tool: string; args?: { recipe?: string } }>).find((h) => h.tool === "adjust_template")!.args!.recipe!;
    // 候補は大きい順に 1 つずつ試算される（溢れ 0 で打ち切り）＝提案倍率の試算は大きい順で何番目か。
    const k = [...OVERFLOW_SCALE_CANDIDATES].sort((a, b) => b - a).indexOf(hintScale);
    expect(trials.length).toBeGreaterThan(k);
    trialForHint = trials[k];
  });

  it("提案レシピは絶対レシピ（前回の本文倍率 × 提案倍率）", () => {
    expect(JSON.parse(hintRecipe)).toEqual({ scale: { body: Math.round(prev * hintScale * 10000) / 10000 } });
  });

  it("(e) hint が試算したテンプレの枠サイズ ＝ 提案レシピを元テンプレに適用したテンプレの枠サイズ（R8 一致テスト）", async () => {
    const before = await frameSizes(await TA.adjustTemplate(EXEC_SAMPLE, { scale: { body: prev } }));
    const applied = await frameSizes(await TA.adjustTemplate(EXEC_SAMPLE, JSON.parse(hintRecipe)));
    const tried = await frameSizes(trialForHint);
    expect(changedFrames(before, tried)).toEqual(changedFrames(before, applied));
    expect([...tried]).toEqual([...applied]);
  });

  it("(f) hint の予告件数 ＝ 提案レシピを adjust_template で適用した overflow.after", async () => {
    const applied = await call(client, "adjust_template", { recipe: hintRecipe });
    expect((applied.overflow as { after: number }).after).toBe(hintAfter);
  });
});
