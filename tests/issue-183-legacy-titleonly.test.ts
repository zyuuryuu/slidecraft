/**
 * issue-183-legacy-titleonly.test.ts — #183: template-less legacy 経路で先頭のタイトルのみ
 * スライドが空にシリアライズされる（#144 系の残り）。
 *
 * root cause: パーサは title-only スライドを content 名前空間（idx 15）に置くが、
 * `serializeLegacy` は `autoSelectLayout` が catalog 無しで解決した名前（"Title.1Title.Single"）を
 * `isTitleNamespace` に渡すため TITLE_NS（idx 0）から読んでしまい、実データの無い idx を読んで消える。
 * fix はレイアウト名でなく実際に埋まっている placeholder idx から名前空間を判定する。
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";

describe("#183 — template-less legacy 経路: 先頭 title-only スライドの round-trip", () => {
  it("単独スライド「# 表紙」がタイトルを保持し round-trip する", () => {
    const deck = parseMd("# 表紙");
    const out = serializeMd(deck);
    expect(out).toContain("# 表紙");
  });

  it("3枚デッキでも先頭スライドのタイトルが欠落しない", () => {
    const md = "# 表紙\n\n---\n\n# 中身\n\n- a\n\n---\n\n# 終わり";
    const deck = parseMd(md);
    const out = serializeMd(deck);
    expect(out).toContain("# 表紙");
    expect(out).toContain("# 中身");
    expect(out).toContain("# 終わり");
  });
});
