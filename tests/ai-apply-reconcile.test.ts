/**
 * ai-apply-reconcile.test.ts — reconcileSlideEdit runs validation AT THE ADOPTION GATE:
 * it returns the reconciled (always-valid) slide + advisories to show in the review, so a
 * number/language change is SURFACED (reviewer decides 採用/却下) rather than blocking the preview
 * AFTER apply. This is the fix for "applied a valid edit but the preview went blank".
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { reconcileSlideEdit } from "../src/engine/ai-apply";

const OLD_MD = `<!-- slide: Content.1Body.Single -->
# 売上サマリ
- 第1四半期: 100万円
- 第2四半期: 150万円`;

describe("reconcileSlideEdit — validation at the adoption gate", () => {
  it("surfaces a number change as an advisory, and the reconciled slide stays valid (renders)", () => {
    const old = parseMd(OLD_MD).slides[0]!;
    const edited = `<!-- slide: Content.1Body.Single -->
# 売上サマリ
- 第1四半期: 200万円
- 第2四半期: 150万円`;
    const rec = reconcileSlideEdit(old, edited);
    expect(rec).not.toBeNull();
    expect(rec!.warnings.some((w) => /数値.*変化/.test(w))).toBe(true); // 100 dropped → reviewer sees it
    expect(rec!.slide.placeholders.length).toBeGreaterThan(0); // still a valid, renderable slide
  });

  it("a clean rephrase (no number/structure loss) has no warnings", () => {
    const old = parseMd(OLD_MD).slides[0]!;
    const edited = `<!-- slide: Content.1Body.Single -->
# 売上まとめ
- 第1四半期: 100万円
- 第2四半期: 150万円`;
    expect(reconcileSlideEdit(old, edited)!.warnings).toEqual([]);
  });

  it("restores a dropped title as an advisory (structure preservation), still valid", () => {
    const old = parseMd(OLD_MD).slides[0]!;
    const edited = `<!-- slide: Content.1Body.Single -->\n- 第1四半期: 100万円\n- 第2四半期: 150万円`; // title dropped
    const rec = reconcileSlideEdit(old, edited)!;
    expect(rec.warnings.some((w) => /構造|復元|タイトル/.test(w))).toBe(true);
  });
});
