/**
 * apply-template-repair.test.ts — 取り込みゲートの修復オファー（テーマ2 スライス1 の UI 配線層）。
 * rejected マスターは即拒否ではなく修復プランを提示し、ユーザ同意で「整形して取り込む」:
 * 同意 → 修復済み bytes が適用され repairedBytes で返る（レジストリはこれを登録する）、
 * 拒否 → 従来と同一の parseError で非適用。健全なマスターでは確認が一切発火しない。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { applyTemplateBytesWithRepair, describeRepairPlan } from "../src/components/apply-template";
import { loadTemplate } from "../src/engine/template-loader";
import { planRepairs } from "../src/engine/template-repair";

const CANONICAL = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

function setters() {
  return { setTemplateData: vi.fn(), setTemplateName: vi.fn(), setParseError: vi.fn() };
}

// master-intake.test.ts と同じ probe 由来の「真に壊れたマスター」（型なし・非慣習 idx・ジオメトリなし・名前ノイズ）
async function deadMaster(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(readFileSync(CANONICAL));
  const breakAll = (xml: string) =>
    xml
      .replace(/(<p:ph\b)([^>]*?)\s*type="[^"]*"/g, "$1$2")
      .replace(/(<p:ph\b[^>]*?\bidx=")(\d+)(")/g, (_m, p, n, s) => `${p}${Number(n) + 30}${s}`)
      .replace(/<(\w+:)?xfrm[\s\S]*?<\/(\w+:)?xfrm>/g, "")
      .replace(/name="[^"]*"/g, (m) => `name="X${m.length}z"`);
  const targets = Object.keys(zip.files).filter((n) => /ppt\/slide(Layouts|Masters)\/.*\.xml$/.test(n));
  for (const n of targets) zip.file(n, breakAll(await zip.files[n].async("string")));
  return zip.generateAsync({ type: "uint8array" });
}

describe("applyTemplateBytesWithRepair（修復オファーつき取り込みゲート）", () => {
  it("健全なマスター → 確認なしでそのまま適用（既存経路と同一挙動）", async () => {
    const s = setters();
    const confirm = vi.fn(async () => true);
    const res = await applyTemplateBytesWithRepair(readFileSync(CANONICAL), "Midnight Executive.pptx", s, confirm);

    expect(res.ok).toBe(true);
    expect(res.repairedBytes).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    expect(s.setTemplateData).toHaveBeenCalledOnce();
    expect(s.setTemplateName).toHaveBeenCalledWith("Midnight Executive");
    expect(s.setParseError).not.toHaveBeenCalled();
  });

  it("rejected マスター＋同意 → 修復済み bytes を適用し repairedBytes で返す", async () => {
    const s = setters();
    const confirm = vi.fn(async () => true);
    const res = await applyTemplateBytesWithRepair(await deadMaster(), "broken.pptx", s, confirm);

    expect(confirm).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    expect(res.health?.status).not.toBe("rejected");
    expect(res.repairedBytes).toBeInstanceOf(Uint8Array);
    expect(s.setTemplateData).toHaveBeenCalledOnce();
    expect(s.setParseError).not.toHaveBeenCalled();
    // 返った bytes 自体が自力で受け入れゲートを通る（レジストリ登録の正当性）
    const tpl = await loadTemplate(res.repairedBytes!);
    expect(planRepairs(tpl).needed).toBe(false);
  });

  it("rejected マスター＋拒否 → 従来どおり parseError で非適用", async () => {
    const s = setters();
    const res = await applyTemplateBytesWithRepair(await deadMaster(), "broken.pptx", s, async () => false);

    expect(res.ok).toBe(false);
    expect(res.repair?.repairable).toBe(true); // プランは返す（呼び出し側が再提示できる）
    expect(s.setTemplateData).not.toHaveBeenCalled();
    expect(s.setParseError).toHaveBeenCalledOnce();
    expect(String(s.setParseError.mock.calls[0][0])).toContain("このテンプレートは使用できません");
  });

  it("読めない bytes → 従来どおり parse error（確認は発火しない）", async () => {
    const s = setters();
    const confirm = vi.fn(async () => true);
    const res = await applyTemplateBytesWithRepair(new Uint8Array([1, 2, 3, 4]), "broken.pptx", s, confirm);

    expect(res.ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(s.setParseError).toHaveBeenCalledOnce();
  });
});

describe("describeRepairPlan（確認ダイアログ用の要約・純粋）", () => {
  it("block 理由と修復件数（タイトル/本文の内訳）を含む短い日本語を返す", async () => {
    const plan = planRepairs(await loadTemplate(await deadMaster()));
    const text = describeRepairPlan(plan);
    expect(text).toContain("タイトル");
    expect(text).toContain("本文");
    expect(text).toContain(String(plan.ops.length));
    expect(text.length).toBeLessThan(600); // ネイティブ確認ダイアログに収まる長さ
  });
});
