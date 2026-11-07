/**
 * layout-augment-xml.test.ts — #568 段 2: lstStyle への sz 書き込みの境界（スキーマ順・lstStyle 無し・自己終了要素）。
 */
import { describe, it, expect } from "vitest";
import { setLevelSizes, stripRunSizes, explicitLevelSize } from "../src/engine/layout-augment-xml";

const sp = (tx: string) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/></p:nvSpPr><p:spPr/>${tx}</p:sp>`;
const m = (e: Array<[number, number]>) => new Map(e);

describe("setLevelSizes", () => {
  it("existing lvl with defRPr sz → replaced; missing lvl inserted in schema order", () => {
    const out = setLevelSizes(sp('<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1600" b="0"/></a:lvl1pPr><a:lvl3pPr/></a:lstStyle><a:p/></p:txBody>'), m([[1, 12], [2, 11], [3, 10.5]]));
    expect(out).toContain('<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200" b="0"/></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="1100"/></a:lvl2pPr><a:lvl3pPr><a:defRPr sz="1050"/></a:lvl3pPr></a:lstStyle>');
  });

  it("defRPr without sz gets one; defRPr goes before a level's extLst", () => {
    const out = setLevelSizes(sp('<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr b="1"/></a:lvl1pPr><a:lvl2pPr><a:buNone/><a:extLst/></a:lvl2pPr></a:lstStyle></p:txBody>'), m([[1, 9], [2, 8]]));
    expect(out).toContain('<a:defRPr sz="900" b="1"/>');
    expect(out).toContain('<a:lvl2pPr><a:buNone/><a:defRPr sz="800"/><a:extLst/></a:lvl2pPr>');
  });

  it("no lstStyle / empty lstStyle / no txBody", () => {
    expect(setLevelSizes(sp("<p:txBody><a:bodyPr/><a:p/></p:txBody>"), m([[1, 12]]))).toContain('<a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p/>');
    expect(setLevelSizes(sp("<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>"), m([[1, 12]]))).toContain('<a:lstStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle>');
    expect(setLevelSizes(sp(""), m([[1, 12]]))).toMatch(/<p:txBody><a:bodyPr\/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1200"\/><\/a:lvl1pPr><\/a:lstStyle><a:p><a:endParaRPr\/><\/a:p><\/p:txBody><\/p:sp>$/);
  });
});

describe("stripRunSizes / explicitLevelSize", () => {
  it("drops sz from prompt-text runs only (lstStyle untouched)", () => {
    const x = sp('<p:txBody><a:bodyPr/><a:lstStyle><a:lvl5pPr><a:defRPr sz="1000"/></a:lvl5pPr></a:lstStyle><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="ja-JP" sz="1800"/><a:t>x</a:t></a:r><a:endParaRPr sz="1800"/></a:p></p:txBody>');
    const out = stripRunSizes(x);
    expect(out).toContain('<a:rPr lang="ja-JP"/>');
    expect(out).toContain("<a:endParaRPr/>");
    expect(explicitLevelSize(out, 5)).toBe(10);
    expect(explicitLevelSize(out, 2)).toBeUndefined();
  });
});
