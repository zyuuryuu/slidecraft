/**
 * template-spec-prompts.test.ts — テーマ2 S5: 自然言語 → TemplateSpec の AI 提案。
 * ADR-0005（ハーネス over モデル）: AI は JSON を「提案」するだけで、検証・修正・生成は
 * 決定論コードが行う。ここではその決定論側を担保する:
 * (P1) プロンプトが全パレットキーと JSON-only 出力を明示、
 * (P2) 応答の防御的パース（フェンス/前置き耐性・#/小文字の正規化・欠落/不正キーのフォールバック＋告知）、
 * (P3) コントラスト・ガード（titleText/background・bodyText/canvas が近すぎたら決定論修正＋告知）、
 * (P4) パース結果がそのまま writeTemplate → 受け入れゲート ok を通る（round-trip）。
 */
import { describe, it, expect } from "vitest";
import { templateSpecSystemPrompt, parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { PALETTE_KEYS } from "../src/engine/template-layout-library";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";

const validJson = () => ({
  name: "森の報告書",
  fonts: { major: "Times New Roman", minor: "Arial" },
  palette: {
    background: "#1B4332",
    canvas: "#ffffff",
    titleText: "F0FFF4",
    bodyText: "1B2E22",
    subtle: "#B7E4C7",
    muted: "#95A5A0",
    accent: "#40916C",
    accent2: "#52B788",
    emphasis: "#1B4332",
  },
});

describe("P1 プロンプト", () => {
  it("全パレットキー・JSON 出力・コントラスト指示を含む", () => {
    const p = templateSpecSystemPrompt();
    for (const k of PALETTE_KEYS) expect(p).toContain(k);
    expect(p).toMatch(/JSON/);
    expect(p.toLowerCase()).toMatch(/contrast/);
  });
});

describe("P2 防御的パース", () => {
  it("フェンス＋前置きつき応答から正規化済みスペックを得る（# 除去・大文字化）", () => {
    const raw = "はい、こちらが提案です:\n```json\n" + JSON.stringify(validJson()) + "\n```\nいかがでしょう。";
    const r = parseTemplateSpecResponse(raw);
    if (!r.ok) throw new Error(r.error);
    expect(r.spec.name).toBe("森の報告書");
    expect(r.spec.fonts).toEqual({ major: "Times New Roman", minor: "Arial" });
    expect(r.spec.palette.background).toBe("1B4332");
    expect(r.spec.palette.canvas).toBe("FFFFFF"); // 小文字 → 大文字
    expect(r.notices).toEqual([]);
  });

  it("欠落キー・不正 hex は MIDNIGHT へフォールバックし告知する", () => {
    const j = validJson() as { palette: Record<string, string>; name: string };
    delete j.palette.muted; // 欠落
    j.palette.accent = "greenish"; // 不正
    const r = parseTemplateSpecResponse(JSON.stringify(j));
    if (!r.ok) throw new Error(r.error);
    expect(r.spec.palette.muted).toBe(MIDNIGHT_PALETTE.muted);
    expect(r.spec.palette.accent).toBe(MIDNIGHT_PALETTE.accent);
    expect(r.notices.join(" ")).toMatch(/muted/);
    expect(r.notices.join(" ")).toMatch(/accent/);
  });

  it("name/fonts の欠落もフォールバックする（提案は常に使える形で返る）", () => {
    const r = parseTemplateSpecResponse(JSON.stringify({ palette: validJson().palette }));
    if (!r.ok) throw new Error(r.error);
    expect(r.spec.name.length).toBeGreaterThan(0);
    expect(r.spec.fonts.major.length).toBeGreaterThan(0);
    expect(r.spec.fonts.minor.length).toBeGreaterThan(0);
  });

  it("JSON が見つからない応答 → ok:false", () => {
    const r = parseTemplateSpecResponse("すみません、わかりませんでした。");
    expect(r.ok).toBe(false);
  });
});

describe("P3 コントラスト・ガード（決定論修正）", () => {
  it("titleText ≈ background → 修正して告知（暗背景なら白へ）", () => {
    const j = validJson();
    j.palette.titleText = "#1B4332"; // background と同色
    const r = parseTemplateSpecResponse(JSON.stringify(j));
    if (!r.ok) throw new Error(r.error);
    expect(r.spec.palette.titleText).not.toBe("1B4332");
    expect(r.spec.palette.titleText).toBe("FFFFFF");
    expect(r.notices.join(" ")).toMatch(/titleText/);
  });

  it("bodyText ≈ canvas（明背景に白文字）→ 暗色へ修正", () => {
    const j = validJson();
    j.palette.bodyText = "#F8F8F8";
    const r = parseTemplateSpecResponse(JSON.stringify(j));
    if (!r.ok) throw new Error(r.error);
    expect(r.spec.palette.bodyText).toBe("1E293B");
    expect(r.notices.join(" ")).toMatch(/bodyText/);
  });
});

describe("P4 round-trip — 提案スペックがそのまま生成ゲートを通る", () => {
  it("parse → writeTemplate → loadTemplate → health ok", async () => {
    const r = parseTemplateSpecResponse(JSON.stringify(validJson()));
    if (!r.ok) throw new Error(r.error);
    const tpl = await loadTemplate(await writeTemplate(r.spec));
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
    expect(tpl.masterTitleStyle.fontName).toBe("Times New Roman");
  });
});
