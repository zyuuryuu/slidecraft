/**
 * arch-census.test.ts — スモークのみ（G3 は fail ゲートではない。ADR-0031「やらないこと」）。
 * 「実行してクラッシュしない」ことだけを検証する。hotspot 順位・コピペ検出結果の値は assert しない
 * （census は傾向観測であり、閾値化すると Goodhart の法則で数字合わせを誘発するため）。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("arch-census.ts（スモーク）", () => {
  it("--since を渡して実行するとクラッシュせず出力する", () => {
    const out = execFileSync(
      "npx",
      ["tsx", "scripts/arch-census.ts", "--since", "2026-06-01", "--top", "5"],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect(out).toContain("arch-census");
    expect(out).toContain("hotspot");
    expect(out).toContain("凍結リスト");
  }, 120_000);

  it("--since 無しだと使い方を表示して非ゼロ終了する", () => {
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/arch-census.ts"], { encoding: "utf8" }),
    ).toThrow();
  });
});
