/**
 * ai-apply-reconcile.test.ts — reconcileSlideEdit runs validation AT THE ADOPTION GATE:
 * it returns the reconciled (always-valid) slide + advisories to show in the review, so a
 * number/language change is SURFACED (reviewer decides 採用/却下) rather than blocking the preview
 * AFTER apply. This is the fix for "applied a valid edit but the preview went blank".
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { reconcileSlideEdit, figureFallbackTag } from "../src/engine/ai-apply";

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

// L4 (ADR-0019 observability): a figure slide whose per-slide edit fell to the full-Markdown path AND
// drifted → the model regenerated the whole slide (A) instead of emitting ops (B). Tag it so the
// otherwise-opaque "変更なし" rollback is legible. Benign (non-drift) edits are NOT tagged.
// C: a text-only edit that drops the ```diagram fence still keeps the figure (reconcileEdit carries it
// back), so its numbers must NOT be flagged as lost — but a real figure-number change is still surfaced.
describe("reconcileSlideEdit — figure numbers not falsely 'lost' on a figure-dropping text edit", () => {
  const OLD = `<!-- slide: Content.1Body.Single -->
# システム構成
- 現状のボトルネック
\`\`\`diagram
type: flowchart
nodes:
  - id: db
    label: Database
    value: 500
edges: []
\`\`\``;
  it("dropping the figure fence in a text edit does NOT warn 数値欠落 (figure is carried back)", () => {
    const old = parseMd(OLD).slides[0]!;
    const textEdit = `<!-- slide: Content.1Body.Single -->\n# システム構成\n- 現状のボトルネックを解消`;
    const rec = reconcileSlideEdit(old, textEdit)!;
    expect(rec.warnings.some((w) => /数値|欠落|500/.test(w))).toBe(false); // 500 is preserved, not lost
    expect(rec.slide.diagram).toBeDefined(); // figure carried back into the committed slide
  });
  it("but a real figure-number change (figure kept, 500→999) is still surfaced (fix is surgical)", () => {
    const old = parseMd(OLD).slides[0]!;
    const numDrift = `<!-- slide: Content.1Body.Single -->\n# システム構成\n- 現状のボトルネック\n\`\`\`diagram\ntype: flowchart\nnodes:\n  - id: db\n    label: Database\n    value: 999\nedges: []\n\`\`\``;
    const rec = reconcileSlideEdit(old, numDrift)!;
    expect(rec.warnings.some((w) => /数値|欠落|500/.test(w))).toBe(true);
  });
});

describe("figureFallbackTag", () => {
  it("prepends the fallback explanation only when a figure existed AND there is drift", () => {
    const w = ["⚠ 数値/言語が変化しています（…）"];
    const tagged = figureFallbackTag(true, w);
    expect(tagged.length).toBe(2);
    // The tag reflects the REAL trigger (couldn't parse as ops), NOT "the model returned full text" —
    // it also fires on prose-wrapped / malformed ops. So the wording is "opsとして受け取れ(ない)".
    expect(tagged[0]).toContain("opsフォールバック");
    expect(tagged[0]).toMatch(/ops.*受け取れ|受け取れ.*ops/);
    expect(tagged[0]).not.toContain("全文で返"); // no longer overclaims the model returned full text
    expect(tagged.slice(1)).toEqual(w); // original warnings preserved after the tag
  });
  it("does not tag a no-figure slide or a clean (no-warning) edit", () => {
    expect(figureFallbackTag(false, ["⚠ 数値/言語が変化しています（…）"])).toEqual(["⚠ 数値/言語が変化しています（…）"]);
    expect(figureFallbackTag(true, [])).toEqual([]);
  });
});
