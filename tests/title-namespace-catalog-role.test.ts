/**
 * title-namespace-catalog-role.test.ts — #453: パーサの title 名前空間判定（slide-roles の
 * isTitleNamespace）が正規レイアウト名（Title./Closing. 接頭辞）依存のため、テンプレの実名
 * （公文書系 `00_表紙` 等）を pin した表紙が content 名前空間（idx 15/16）で読まれていた。
 * 修正: catalog（解決レイアウトの role）があるときは role === "title"/"closing" でも title
 * 名前空間と判定する。catalog が無いとき（テンプレ無しパース）の既定は従来どおり名前照合。
 *
 * 不変条件（Issue #453）: 正規名 pin・auto・テンプレ無しパースは byte-identical。
 * ミラー対象: parser（md-slide-parser）と ai-reconcile / ai-validate は同じ規則を共有する
 * （slide-roles 集約の理由そのもの — 片方だけ catalog を見ると復元先 idx がずれる）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { isTitleNamespace, titleSubtitleIdx } from "../src/engine/slide-roles";
import { reconcileEdit } from "../src/engine/ai-reconcile";
import { validateStructure } from "../src/engine/ai-validate";
import type { SlideIR } from "../src/engine/slide-schema";
import * as S from "../src/mcp/session";

// 公文書_白紺: committed fixture。実名レイアウト `00_表紙`（role=title）・`06_まとめ`
// （role=closing）を持つ — 本 Issue の対象テンプレ族そのもの。
const KOUBUNSHO = resolve(__dirname, "fixtures/templates/報告書テンプレート_公文書_白紺_全レイアウト見本.pptx");
const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #453 の repro（実名 pin の表紙）。メタ行ありは従来も meta 昇格で title 名前空間に
// なる（実測）ので、受け入れの本丸はメタ無し表紙（従来 idx 15/16 に落ちていた形）。
const COVER_META = "<!-- slide: 00_表紙 -->\n# 月次報告\n## 2026年9月\nCategory: 情報セキュリティ";
const COVER_NOMETA = "<!-- slide: 00_表紙 -->\n# 月次報告\n## 2026年9月";

let tpl: TemplateData;
let catalog: LayoutCatalog;
let mdTpl: TemplateData;
let mdCatalog: LayoutCatalog;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(KOUBUNSHO));
  catalog = buildCatalog(tpl);
  mdTpl = await loadTemplate(readFileSync(MIDNIGHT));
  mdCatalog = buildCatalog(mdTpl);
});

const idxText = (s: SlideIR) =>
  Object.fromEntries(s.placeholders.map((p) => [p.idx, p.paragraphs.map((pp) => pp.segments.map((x) => x.text).join("")).join("\n")]));

describe("slide-roles — catalog の role による title 名前空間判定 (#453)", () => {
  // 最小の構造的 lookup（LayoutCatalog は name/role を持つのでそのまま渡せる）。
  const lookup = [
    { name: "00_表紙", role: "title" },
    { name: "06_まとめ", role: "closing" },
    { name: "02_本文（1カラム）", role: "content" },
  ];

  it("role=title / closing の実名 pin → title 名前空間（catalog あり）", () => {
    expect(isTitleNamespace("00_表紙", false, lookup)).toBe(true);
    expect(isTitleNamespace("06_まとめ", false, lookup)).toBe(true);
    expect(titleSubtitleIdx("00_表紙", false, lookup)).toEqual({ title: "0", subtitle: "1" });
  });

  it("role=content の実名 pin・未知名・auto は従来どおり（catalog があっても昇格しない）", () => {
    expect(isTitleNamespace("02_本文（1カラム）", false, lookup)).toBe(false);
    expect(isTitleNamespace("この名前は無い", false, lookup)).toBe(false);
    expect(isTitleNamespace("auto", false, lookup)).toBe(false);
    // meta 昇格・正規名照合は catalog の有無に依らず不変。
    expect(isTitleNamespace("auto", true, lookup)).toBe(true);
    expect(isTitleNamespace("Title.1Title.Single", false, lookup)).toBe(true);
  });

  it("catalog なしは既定不変（実名 pin は名前照合のみ）", () => {
    expect(isTitleNamespace("00_表紙", false)).toBe(false);
    expect(titleSubtitleIdx("00_表紙", false)).toEqual({ title: "15", subtitle: "16" });
  });
});

describe("parseMd(md, catalog) — 実名 pin の表紙 (#453 受け入れ基準)", () => {
  it("00_表紙 pin ＋ catalog → Category: が idx 10・## が subtitle（idx 1）・# が idx 0", () => {
    const s = parseMd(COVER_META, catalog).slides[0];
    expect(idxText(s)).toEqual({ "0": "月次報告", "1": "2026年9月", "10": "情報セキュリティ" });
  });

  it("メタ無し表紙（従来 idx 15/16 に落ちていた形）も title 名前空間になる", () => {
    const s = parseMd(COVER_NOMETA, catalog).slides[0];
    expect(idxText(s)).toEqual({ "0": "月次報告", "1": "2026年9月" });
  });

  it("role=closing の実名 pin も Closing. 正規名と同じ扱い（isTitleLayout との対称）", () => {
    const s = parseMd("<!-- slide: 06_まとめ -->\n# まとめ", catalog).slides[0];
    expect(idxText(s)).toEqual({ "0": "まとめ" });
  });

  it("catalog なしのパースは従来どおり（テンプレ無しの既定不変）", () => {
    expect(idxText(parseMd(COVER_NOMETA).slides[0])).toEqual({ "15": "月次報告", "16": "2026年9月" });
  });

  it("正規名 pin・auto・content 実名 pin は catalog を渡しても byte-identical（不変条件）", () => {
    const mds = [
      "<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ", // 正規名 pin（Midnight に実在）
      "# 表紙\n## サブ\nCategory: X", // auto ＋ meta 昇格
      "# 内容\n\n- 要点", // auto の content
      "<!-- slide: 02_本文（1カラム） -->\n# 内容\n\n- 要点", // role=content の実名 pin
      "<!-- slide: title-centered -->\n# T\n## S", // 未知名 pin（どの catalog にも無い）
    ].join("\n\n---\n\n");
    for (const cat of [catalog, mdCatalog]) {
      expect(parseMd(mds, cat)).toEqual(parseMd(mds));
    }
  });
});

describe("round-trip — 実名 pin の表紙が往復で安定 (#453)", () => {
  it("parse(catalog) → serialize(tpl) → parse(catalog) で placeholders が一致（meta あり/なし）", () => {
    const st = { catalog, layouts: tpl.layouts };
    for (const md of [COVER_META, COVER_NOMETA]) {
      const deck = parseMd(md, catalog);
      const out = serializeMd(deck, st);
      expect(parseMd(out, catalog).slides[0].placeholders).toEqual(deck.slides[0].placeholders);
    }
  });

  it("テンプレ無し serialize（legacy 読み出し）でも往復が安定", () => {
    for (const md of [COVER_META, COVER_NOMETA]) {
      const deck = parseMd(md, catalog);
      const out = serializeMd(deck); // legacy はスライド自身の idx から名前空間を読む
      expect(parseMd(out, catalog).slides[0].placeholders).toEqual(deck.slides[0].placeholders);
    }
  });
});

describe("ミラー — ai-reconcile / ai-validate も同じ規則で判定する (#453)", () => {
  it("reconcileEdit: 実名 pin 表紙のタイトル落ちを idx 0 に復元する（catalog あり）", () => {
    const old = parseMd(COVER_NOMETA, catalog).slides[0];
    const edited = parseMd("<!-- slide: 00_表紙 -->\n## 2026年9月", catalog).slides[0];
    const rec = reconcileEdit(old, edited, catalog);
    expect(idxText(rec)["0"]).toBe("月次報告");
  });

  it("validateStructure: 実名 pin 表紙のタイトル喪失を検知する（catalog あり）", () => {
    const old = parseMd(COVER_NOMETA, catalog).slides[0];
    const edited = parseMd("<!-- slide: 00_表紙 -->\n## 2026年9月", catalog).slides[0];
    const v = validateStructure(old, edited, "condense", catalog);
    expect(v.violations.some((x) => x.detail.includes("タイトル"))).toBe(true);
  });
});

describe("MCP session — applySlideMarkdown が catalog 込みでパースする (#453)", () => {
  it("00_表紙 pin のメタ無し表紙を適用 → title 名前空間で保持される", () => {
    const s = S.createSession(null);
    s.deck = parseMd("# 仮", catalog);
    s.template = tpl;
    s.catalog = catalog;
    const r = S.applySlideMarkdown(s, 0, COVER_NOMETA);
    expect(r.ok).toBe(true);
    expect(idxText(s.deck!.slides[0])).toEqual({ "0": "月次報告", "1": "2026年9月" });
  });
});
