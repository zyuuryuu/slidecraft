/**
 * template-repair.test.ts — 登録支援（テーマ2 スライス1）: rejected マスターの診断→修復提案→
 * XML パッチ。master-intake.test.ts と同じ probe 由来の mutator で壊したマスターに対し、
 * (D1) 健全/回復可能なマスターには修復を提案しない（過剰修復ゼロ）、
 * (D2) 真に壊れたマスター（型なし・非慣習 idx・ジオメトリなし・名前ノイズ）は修復で rejected を脱する、
 * (D3) パッチは最小（対象レイアウト以外のエントリは無改変）、
 * (D4) 候補が存在しないマスターは repairable=false で従来どおり拒否、を担保する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole } from "../src/engine/template-catalog";
import { planRepairs, applyRepairs, repairTemplate } from "../src/engine/template-repair";

const dir = "fixtures/templates/";
const bytesOf = (f: string) => readFileSync(resolve(__dirname, dir + f));
const CANON = "Midnight_Executive_30_TemplateOnly.pptx";

// ── Mutators（master-intake.test.ts の probe 系をバイト出力で流用）──
const scrambleNames = (xml: string) => xml.replace(/name="[^"]*"/g, (m) => `name="X${m.length}z"`);
const breakTypes = (xml: string) =>
  xml
    .replace(/(<p:ph\b)([^>]*?)\s*type="[^"]*"/g, "$1$2")
    .replace(/(<p:ph\b[^>]*?\bidx=")(\d+)(")/g, (_m, p, n, s) => `${p}${Number(n) + 30}${s}`);
const stripGeometry = (xml: string) => xml.replace(/<(\w+:)?xfrm[\s\S]*?<\/(\w+:)?xfrm>/g, "");
const breakEverything = (xml: string) => scrambleNames(stripGeometry(breakTypes(xml)));
const stripPhTags = (xml: string) => xml.replace(/<(?:\w+:)?ph\b[^>]*?\/?>/g, ""); // placeholder が1つも無いマスター

async function mutateBytes(srcBytes: Uint8Array, transform: (x: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(srcBytes);
  const targets = Object.keys(zip.files).filter((n) => /ppt\/slide(Layouts|Masters)\/.*\.xml$/.test(n));
  for (const n of targets) zip.file(n, transform(await zip.files[n].async("string")));
  return zip.generateAsync({ type: "uint8array" });
}

async function healthOf(bytes: Uint8Array) {
  return assessTemplateHealth(buildCatalog(await loadTemplate(bytes)));
}

describe("D1 過剰修復ゼロ — 健全/回復可能なマスターに ops を出さない", () => {
  it("canonical Baseline → needed=false, ops なし", async () => {
    const plan = planRepairs(await loadTemplate(bytesOf(CANON)));
    expect(plan.needed).toBe(false);
    expect(plan.ops).toEqual([]);
  });

  it("type 剥奪のみ（回復ラダーで復元できる）→ needed=false, ops なし", async () => {
    const broken = await mutateBytes(bytesOf(CANON), breakTypes);
    const plan = planRepairs(await loadTemplate(broken));
    expect(plan.needed).toBe(false);
    expect(plan.ops).toEqual([]);
  });
});

describe("D2 修復 — 真に壊れたマスターが rejected を脱する", () => {
  it("breakEverything → rejected を診断し、title/body 両方の ops を提案する", async () => {
    const dead = await mutateBytes(bytesOf(CANON), breakEverything);
    const plan = planRepairs(await loadTemplate(dead));
    expect(plan.health.status).toBe("rejected");
    expect(plan.needed).toBe(true);
    expect(plan.repairable).toBe(true);
    expect(plan.ops.some((o) => o.setType === "title")).toBe(true);
    expect(plan.ops.some((o) => o.setType === "body")).toBe(true);
    for (const op of plan.ops) {
      expect(op.reason.length).toBeGreaterThan(0); // 日本語の理由つき（UI/MCP がそのまま表示できる）
      expect(op.layoutIndex).toBeGreaterThan(0);
    }
  });

  it("repairTemplate 一括 → healthAfter が rejected でなく、title/body ロールが存在する", async () => {
    const dead = await mutateBytes(bytesOf(CANON), breakEverything);
    const r = await repairTemplate(dead);
    expect(r.plan.repairable).toBe(true);
    expect(r.healthAfter.status).not.toBe("rejected");
    const tpl = await loadTemplate(r.bytes);
    const roles = new Set(tpl.layouts.flatMap((l) => l.placeholders.map((p) => placeholderRole(p))));
    expect(roles.has("title")).toBe(true);
    expect(roles.has("body")).toBe(true);
  });

  it("title 候補はフォントサイズ最大の placeholder（タイトル書式が生き残る canonical で検証）", async () => {
    const dead = await mutateBytes(bytesOf(CANON), breakEverything);
    const tpl = await loadTemplate(dead);
    const plan = planRepairs(tpl);
    for (const op of plan.ops.filter((o) => o.setType === "title")) {
      const layout = tpl.layouts.find((l) => l.index === op.layoutIndex)!;
      const target = layout.placeholders.find((p) => p.idx === op.phIdx)!;
      const maxFont = Math.max(...layout.placeholders.map((p) => p.style.fontSize));
      expect(target.style.fontSize).toBe(maxFont);
      expect(target.style.fontSize).toBeGreaterThanOrEqual(18);
    }
  });
});

describe("D3 最小パッチ — 対象レイアウト以外は無改変", () => {
  it("theme / master / presentation / 非対象レイアウトの内容が修復前後で一致する", async () => {
    const dead = await mutateBytes(bytesOf(CANON), breakEverything);
    const plan = planRepairs(await loadTemplate(dead));
    const repaired = await applyRepairs(dead, plan.ops);

    const before = await JSZip.loadAsync(dead);
    const after = await JSZip.loadAsync(repaired);
    const patched = new Set(plan.ops.map((o) => `ppt/slideLayouts/slideLayout${o.layoutIndex}.xml`));
    for (const name of Object.keys(before.files).filter((n) => !before.files[n].dir)) {
      const a = await after.files[name]?.async("string");
      const b = await before.files[name].async("string");
      if (patched.has(name)) continue;
      expect(a, `${name} が意図せず変更された`).toBe(b);
    }
    // パッチ対象は type 属性の付与のみ（ph タグ以外は不変）
    for (const name of patched) {
      const a = await after.files[name].async("string");
      const b = await before.files[name].async("string");
      expect(a.replace(/<p:ph\b[^>]*?\/?>/g, "")).toBe(b.replace(/<p:ph\b[^>]*?\/?>/g, ""));
    }
  });
});

describe("D4 修復不能 — 候補ゼロは従来どおり拒否", () => {
  it("placeholder が1つも無いマスター → repairable=false・ops なし・rejected のまま", async () => {
    const hollow = await mutateBytes(bytesOf(CANON), stripPhTags);
    expect((await healthOf(hollow)).status).toBe("rejected");
    const r = await repairTemplate(hollow);
    expect(r.plan.needed).toBe(true);
    expect(r.plan.repairable).toBe(false);
    expect(r.plan.ops).toEqual([]);
    expect(r.healthAfter.status).toBe("rejected");
  });
});
