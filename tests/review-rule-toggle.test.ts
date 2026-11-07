/**
 * review-rule-toggle.test.ts — Issue #247: レビュー規則（句読点等）を on/off できる lint トグル。
 *
 * 置き場は MCP パラメータ（セッション＝doc 単位の状態・deck 構造 schema.ts には入れない＝R4 回避）。
 * 固定するもの:
 *   1. 句読点規則を off → get_deck_issues（と mutation の diagnostics tail）にその指摘が出ない・
 *      guide の activeReviewRules で当該 id が level:"off"・get_deck_issues の disabledReviewRules に載る。
 *   2. 未指定時は従来どおり（get_deck_issues の payload は byte-identical・activeReviewRules == REVIEW_RULES）。
 *   3. guide↔診断の一致（#244 agreement）が on/off どちらでも成立 — off 状態も REVIEW_RULES と同じ単一源
 *      （reviewRuleStates）からの射影（R8）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";
import { setReviewRules } from "../src/mcp/review-rules";
import { buildServer } from "../src/mcp/server";
import { diagnoseDeck, parseNoticesToIssues, REVIEW_RULES, type ReviewRuleId } from "../src/engine/deck-diagnostics";
import { reviewRuleStates, withoutDisabledRules } from "../src/engine/review-rule-toggle";
import { parseMd } from "../src/engine/md-parser";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

// 読点（touten-used=warn）と句点（kuten-used=info）の両方と、句読点以外の規則（missing-title）を踏む deck。
const MD = ["# 概要\n\n- 速く、安く、簡単に導入できる\n- 導入は容易です。", "- タイトル無しの箇条書き"].join("\n\n---\n\n");
const PUNCT: ReviewRuleId[] = ["touten-used", "kuten-used"];

async function opened(): Promise<S.Session> {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, MD);
  return s;
}

describe("engine: reviewRuleStates / withoutDisabledRules（純粋関数・単一源）", () => {
  it("何も off でなければ REVIEW_RULES そのもの（既定は全 on）", () => {
    expect(reviewRuleStates(new Set())).toEqual(REVIEW_RULES);
  });

  it("off の id だけ level が \"off\" になり、順序と他の規則は不変", () => {
    const states = reviewRuleStates(new Set<ReviewRuleId>(["touten-used"]));
    expect(states.map((r) => r.id)).toEqual(REVIEW_RULES.map((r) => r.id));
    for (const r of states) {
      const base = REVIEW_RULES.find((x) => x.id === r.id)!;
      expect(r.level).toBe(r.id === "touten-used" ? "off" : base.level);
    }
  });

  it("off の規則の issue だけを落とす（他は同一参照・同順で残す）", () => {
    const issues = diagnoseDeck(parseMd(MD));
    expect(issues.some((i) => i.id === "touten-used")).toBe(true);
    const kept = withoutDisabledRules(issues, new Set<ReviewRuleId>(["touten-used"]));
    expect(kept).toEqual(issues.filter((i) => i.id !== "touten-used"));
    expect(withoutDisabledRules(issues, new Set())).toEqual(issues);
  });
});

describe("session: 句読点規則を off（受け入れ基準）", () => {
  it("未指定時は従来どおり：get_deck_issues の payload が byte-identical・guide は REVIEW_RULES", async () => {
    const s = await opened();
    const d = S.getDiagnostics(s);
    const legacy = [...diagnoseDeck(s.deck!, s.catalog, s.template!.layouts), ...parseNoticesToIssues(s.deck!, s.parseNotices)];
    expect(JSON.stringify(d)).toBe(JSON.stringify({ budget: d.budget, issues: legacy }));
    expect(d).not.toHaveProperty("disabledReviewRules");
    expect(G.getAuthoringGuide(s).activeReviewRules).toEqual(REVIEW_RULES);
  });

  it("touten/kuten を off → 診断に出ない・disabledReviewRules に載る・guide で level:\"off\"", async () => {
    const s = await opened();
    expect(S.getDiagnostics(s).issues.some((i) => i.id === "touten-used")).toBe(true);
    expect(S.getDiagnostics(s).issues.some((i) => i.id === "kuten-used")).toBe(true);

    const r = setReviewRules(s, { "touten-used": "off", "kuten-used": "off" });
    expect(r).toMatchObject({ ok: true, changed: true, disabledReviewRules: PUNCT });

    const d = S.getDiagnostics(s);
    expect(d.issues.some((i) => i.id === "touten-used" || i.id === "kuten-used")).toBe(false);
    expect(d.issues.some((i) => i.id === "missing-title")).toBe(true); // 句読点以外は残る
    expect(d.disabledReviewRules).toEqual(PUNCT);

    const guide = G.getAuthoringGuide(s).activeReviewRules;
    for (const id of PUNCT) expect(guide.find((x) => x.id === id)!.level).toBe("off");
  });

  it("on に戻すと従来どおり（同じ値の再指定は changed:false）", async () => {
    const s = await opened();
    const before = JSON.stringify(S.getDiagnostics(s));
    setReviewRules(s, { "touten-used": "off" });
    expect(setReviewRules(s, { "touten-used": "off" })).toMatchObject({ ok: true, changed: false });
    expect(setReviewRules(s, { "touten-used": "on" })).toMatchObject({ ok: true, changed: true, disabledReviewRules: [] });
    expect(JSON.stringify(S.getDiagnostics(s))).toBe(before);
    expect(G.getAuthoringGuide(s).activeReviewRules).toEqual(REVIEW_RULES);
  });

  it("mutation の diagnostics tail と get_slide_fix_request も off を尊重（読み経路で食い違わない）", async () => {
    const s = await opened();
    setReviewRules(s, { "touten-used": "off" });
    const r = S.applySlideMarkdown(s, 0, "# 概要\n\n- 速く、安く導入できる");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.diagnostics.some((i) => i.id === "touten-used")).toBe(false);
    expect(S.getSlideFix(s, 0).issues.some((i) => i.id === "touten-used")).toBe(false);
  });

  it("agreement（#244）が on/off どちらでも成立：出る issue の id/level は guide の状態と一致し、off の id は出ない", async () => {
    for (const off of [[], PUNCT] as ReviewRuleId[][]) {
      const s = await opened();
      setReviewRules(s, Object.fromEntries(off.map((id) => [id, "off"])));
      const guide = new Map(G.getAuthoringGuide(s).activeReviewRules.map((r) => [r.id, r.level]));
      const { issues } = S.getDiagnostics(s);
      expect(issues.length).toBeGreaterThan(0);
      for (const iss of issues) {
        expect(iss.id).toBeDefined();
        expect(guide.get(iss.id!)).toBe(iss.level); // off の規則なら guide は "off" → issue level と不一致で赤
      }
    }
  });
});

describe("MCP: set_review_rules → get_deck_issues / get_authoring_guide", () => {
  type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
  async function client(): Promise<Client> {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: "test", version: "1.0.0" });
    await c.connect(ct);
    return c;
  }
  async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
    const res = (await c.callTool({ name, arguments: args })) as unknown as CallRes;
    const text = res.content[0]?.text ?? "null";
    return { isError: !!res.isError, text, data: res.isError ? undefined : (JSON.parse(text) as Record<string, unknown>) };
  }

  it("句読点を off にすると get_deck_issues に出ず disabledReviewRules に載る・guide は off", async () => {
    const c = await client();
    await call(c, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: MD });
    const before = (await call(c, "get_deck_issues")).data!;
    expect(before).not.toHaveProperty("disabledReviewRules");
    expect((before.issues as Array<{ id: string }>).some((i) => i.id === "touten-used")).toBe(true);

    const set = await call(c, "set_review_rules", { rules: { "touten-used": "off", "kuten-used": "off" } });
    expect(set.isError).toBe(false);
    expect(set.data).toMatchObject({ ok: true, changed: true, disabledReviewRules: PUNCT });

    const after = (await call(c, "get_deck_issues")).data!;
    expect((after.issues as Array<{ id: string }>).some((i) => PUNCT.includes(i.id as ReviewRuleId))).toBe(false);
    expect(after.disabledReviewRules).toEqual(PUNCT);
    const guide = (await call(c, "get_authoring_guide")).data!.activeReviewRules as Array<{ id: string; level: string }>;
    expect(guide.find((r) => r.id === "touten-used")!.level).toBe("off");
  });

  it("未知の規則 id・on/off 以外の値は never-silent に拒否（状態は変わらない）", async () => {
    const c = await client();
    await call(c, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: MD });
    // 未知 id はモデル化済みの拒否 {ok:false, code:"invalid-argument"}（同じ呼び出しの有効な id も適用しない＝原子的）
    const bad = await call(c, "set_review_rules", { rules: { "touten-used": "off", "no-such-rule": "off" } });
    expect(bad.isError).toBe(false);
    expect(bad.data).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(String(bad.data!.error)).toContain("no-such-rule");
    const badVal = await call(c, "set_review_rules", { rules: { "touten-used": "disabled" } });
    expect(badVal.isError).toBe(true);
    expect((await call(c, "get_deck_issues")).data).not.toHaveProperty("disabledReviewRules");
  });
});
