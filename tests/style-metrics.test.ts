/**
 * style-metrics.test.ts — #597 受け入れ (c): 評価スクリプト scripts/style-metrics.ts が
 * 3 テンプレ × 1 原稿（samples/deck-05-report-form.md）で JSON を出し、committed fixture だけで回る
 * （ブラウザ不要＝必須 CI ジョブ `test` で走る）。各指標が配置・診断の既存計算から取れていることも確かめる。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { runCli, styleMetrics, evaluateTargets, measureTemplate, DEFAULT_TEMPLATES, STYLE_TARGETS } from "../scripts/style-metrics";

const DECK = resolve(__dirname, "../samples/deck-05-report-form.md");
const GIJUTSU = DEFAULT_TEMPLATES[0];
const read = (p: string) => new Uint8Array(readFileSync(p));
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("(c) style-metrics: 3 templates × the report baseline deck → JSON", () => {
  it("the CLI prints one JSON report with an entry per shipped template", async () => {
    const r = await runCli([DECK], read);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.manuscript).toBe("deck-05-report-form.md");
    expect(report.templates.map((t: { template: string }) => t.template)).toEqual(DEFAULT_TEMPLATES.map((p) => p.split("/").pop()));
    for (const t of report.templates) {
      expect(t.slides).toBe(7);
      expect(t.perSlide).toHaveLength(t.slides);
      for (const k of ["charsPerSlide", "imageAreaRatio", "whitespaceRatio", "lossIssues", "autoSplit", "rescued"]) expect(Number.isFinite(t[k])).toBe(true);
      expect(t.whitespaceRatio).toBeGreaterThan(0);
      expect(t.whitespaceRatio).toBeLessThan(1);
    }
  });

  it("the baseline deck loses nothing and is not auto-split on any shipped template (report band)", async () => {
    const report = await styleMetrics("deck-05", readFileSync(DECK, "utf8"), DEFAULT_TEMPLATES.map((p) => ({ name: p, bytes: read(p) })));
    for (const t of report.templates) {
      expect(t.lossIssues).toBe(0);
      expect(t.autoSplit).toBe(0);
      expect(t.imageAreaRatio).toBe(0); // the report form carries no image
    }
    expect(evaluateTargets(report, "report").every((e) => e.misses.length === 0)).toBe(true);
  });

  it("is deterministic (same input → byte-identical JSON)", async () => {
    const a = await runCli([DECK, "--template", GIJUTSU], read);
    const b = await runCli([DECK, "--template", GIJUTSU], read);
    expect(a.stdout).toBe(b.stdout);
  });

  it("--style adds the target band and per-template misses (pitch: chars ≤ 60 → the report deck misses it)", async () => {
    const r = JSON.parse((await runCli([DECK, "--template", GIJUTSU, "--style", "pitch"], read)).stdout);
    expect(r.targets).toEqual(STYLE_TARGETS.pitch);
    expect(r.evaluation[0].misses.some((m: string) => m.startsWith("charsPerSlide"))).toBe(true);
  });

  it("bad arguments are a usage error, not a crash", async () => {
    expect((await runCli([], read)).code).toBe(2);
    expect((await runCli([DECK, "--style", "nope"], read)).code).toBe(2);
    expect((await runCli([DECK, "--bogus"], read)).code).toBe(2);
  });
});

describe("metrics read off the export's own computations", () => {
  it("imageArea: a full-bleed behind image covers the whole slide; whitespace drops with it", async () => {
    const md = `# 表紙\n\n---\n\n# 夕凪\n\n![](data:image/png;base64,${PNG_1x1}){x=0,y=0,w=13.333,h=7.5,fit=cover,behind=1}\n\n---\n\n# 文字だけ\n\n- a`;
    const t = await measureTemplate(md, "gijutsu", read(GIJUTSU));
    expect(t.perSlide[1].imageArea).toBeCloseTo(1, 2);
    expect(t.perSlide[1].whitespace).toBeLessThan(0.01);
    expect(t.perSlide[2].imageArea).toBe(0);
  });

  it("lossIssues counts content that does not reach the output (a Takeaway on cards has no fallback)", async () => {
    const md = "# 表紙\n\n---\n\n# 3 つ\n\n<!-- card -->\n### A\n- a\n\n<!-- card -->\n### B\n- b\n\nTakeaway: 結論";
    const t = await measureTemplate(md, "gijutsu", read(GIJUTSU));
    expect(t.lossIssues).toBe(1);
  });

  it("chars counts title + body + table cells (whitespace excluded)", async () => {
    const t = await measureTemplate("# 表紙\n\n---\n\n# ab\n\n| c | d |\n|---|---|\n| e f | g |", "gijutsu", read(GIJUTSU));
    expect(t.perSlide[1].chars).toBe(2 + 5);
  });
});
