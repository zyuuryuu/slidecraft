/**
 * font-subset-plan.test.ts — gothic/mincho + bold → bundled source-font asset mapping (#193).
 */
import { describe, it, expect } from "vitest";
import { resolveFontSubsetSource } from "../src/engine/font-subset-plan";

describe("resolveFontSubsetSource", () => {
  it("maps gothic + regular to the Noto Sans JP asset at wght 400", () => {
    expect(resolveFontSubsetSource("gothic", false)).toEqual({
      assetPath: "/fonts/NotoSansJP-Variable.ttf",
      wght: 400,
    });
  });

  it("maps gothic + bold to the Noto Sans JP asset at wght 700", () => {
    expect(resolveFontSubsetSource("gothic", true)).toEqual({
      assetPath: "/fonts/NotoSansJP-Variable.ttf",
      wght: 700,
    });
  });

  it("maps mincho + regular to the Noto Serif JP asset at wght 400", () => {
    expect(resolveFontSubsetSource("mincho", false)).toEqual({
      assetPath: "/fonts/NotoSerifJP-Variable.ttf",
      wght: 400,
    });
  });

  it("maps mincho + bold to the Noto Serif JP asset at wght 700", () => {
    expect(resolveFontSubsetSource("mincho", true)).toEqual({
      assetPath: "/fonts/NotoSerifJP-Variable.ttf",
      wght: 700,
    });
  });
});
