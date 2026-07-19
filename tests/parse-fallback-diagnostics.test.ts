/**
 * parse-fallback-diagnostics.test.ts — #148 acceptance: previously-silent parse-time fallbacks
 * (2nd+ table, 2nd+ image, unrecognized `Key:` line, distill auto-split) now show up in
 * get_deck_issues. Synthetic template fixture (ADR-0030's stated policy for this "層2"
 * plumbing/observation class of bug — see binding-diagnostics.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import * as S from "../src/mcp/session";

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

// One slide carrying all three previously-silent fallbacks at once (the issue's stated acceptance shape).
const FALLBACK_MD = `# フォールバック検証

Meta: 補足情報です

![一枚目](${DATA_URI})
![二枚目](${DATA_URI})

| a | b |
| --- | --- |
| 1 | 2 |

| c | d |
| --- | --- |
| 3 | 4 |`;

describe("#148 — new_project → get_deck_issues surfaces all 3 parse-time fallbacks", () => {
  it("get_deck_issues carries a table / image / meta-key notice", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await defaultTemplateBytes(), FALLBACK_MD);
    const { issues } = S.getDiagnostics(s);
    expect(issues.some((x) => x.message.includes("表"))).toBe(true);
    expect(issues.some((x) => x.message.includes("画像"))).toBe(true);
    expect(issues.some((x) => x.message.includes("Meta"))).toBe(true);
  });

  it("new_project's OWN returned diagnostics already carry all 3 (no blind spot before the first get_deck_issues call)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), FALLBACK_MD);
    expect(r.diagnostics.some((x) => x.message.includes("表"))).toBe(true);
    expect(r.diagnostics.some((x) => x.message.includes("画像"))).toBe(true);
    expect(r.diagnostics.some((x) => x.message.includes("Meta"))).toBe(true);
  });

  it("the table-drop notice SURVIVES a later get_deck_issues call (persisted, not reconstructed from DeckIR)", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await defaultTemplateBytes(), FALLBACK_MD);
    const first = S.getDiagnostics(s).issues.filter((x) => x.message.includes("表"));
    const second = S.getDiagnostics(s).issues.filter((x) => x.message.includes("表"));
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
  });
});

// Review feedback on PR #197: apply_slide_markdown/visualize_key_value only ever APPLY block 0 of a
// (possibly multi-block, `---`-separated) Markdown string — but parseMdReport's notices span every
// block it parsed. Blindly re-tagging ALL of them onto the target slide misattributes a 2nd block's
// own fallback (which was silently discarded, same as its content) to the slide that's actually there.
describe("#148 — apply_slide_markdown doesn't misattribute a discarded 2nd block's notices", () => {
  it("only block 0's notices attach to the target slide; a table-drop in a DISCARDED 2nd block is not surfaced", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await defaultTemplateBytes(), "# クリーン\n\n- a\n- b");
    const droppedBlock2Md = `# クリーン更新\n\n- a\n- b\n\n---\n\n# 表\n\n${"| a | b |\n| --- | --- |\n| 1 | 2 |"}\n\n${"| c | d |\n| --- | --- |\n| 3 | 4 |"}`;
    await S.applySlideMarkdown(s, 0, droppedBlock2Md);
    expect(S.getDiagnostics(s).issues.some((x) => x.message.includes("2つ目以降の表"))).toBe(false);
  });
});

describe("#148 — healthy sample decks gain ZERO new false-positive fallback warnings", () => {
  const samplesDir = resolve(__dirname, "../samples");
  const deckFiles = readdirSync(samplesDir).filter((f) => /^deck-0[1-4]/.test(f));

  for (const file of deckFiles) {
    it(`${file}: no table/image/meta fallback diagnostic fires`, async () => {
      const md = readFileSync(resolve(samplesDir, file), "utf-8");
      const s = S.createSession(null);
      const { diagnostics } = await S.newProject(s, await defaultTemplateBytes(), md);
      const { issues } = S.getDiagnostics(s);
      for (const list of [diagnostics, issues]) {
        expect(list.some((x) => x.message.includes("画像記法"))).toBe(false);
        expect(list.some((x) => /^「.*」は認識されない/.test(x.message))).toBe(false);
        expect(list.some((x) => x.message.includes("2つ目以降の表"))).toBe(false);
      }
    });
  }
});

describe("#148 — distill auto-split surfaces an info diagnostic", () => {
  it("new_project reports which slide(s) an overflowing intake was split into", async () => {
    const bullets = Array.from({ length: 40 }, (_, i) => `- 項目${i} の説明テキストをそれなりの長さで書いてオーバーフローさせる`).join("\n");
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), `# 詰め込み\n\n${bullets}`);
    expect(r.slideCount).toBeGreaterThan(1); // the split actually happened
    expect(r.diagnostics.some((x) => x.level === "info" && /分割/.test(x.message))).toBe(true);
  });

  it("a deck that fits in one slide gets no split-info diagnostic", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), "# まとめ\n\n- 速い\n- 安い");
    expect(r.diagnostics.some((x) => /分割/.test(x.message))).toBe(false);
  });

  // Review feedback on PR #197: contiguous-run grouping over `newIndices` alone can't tell two
  // back-to-back split originals apart from one bigger split — [0,1,2,3] from two 2-part splits looks
  // identical to one 4-part split. Two ADJACENT overflowing slides is the realistic case (a bullet dump
  // that overflows tends to overflow across consecutive slides), so this must report TWO infos, not one.
  it("two ADJACENT overflowing slides each get their OWN split-info diagnostic (not fused into one)", async () => {
    const bullets = Array.from({ length: 40 }, (_, i) => `- 項目${i} の説明テキストをそれなりの長さで書いてオーバーフローさせる`).join("\n");
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), `# 一\n\n${bullets}\n\n---\n\n# 二\n\n${bullets}`);
    const splits = r.diagnostics.filter((x) => x.level === "info" && /分割/.test(x.message));
    expect(splits.length).toBe(2);
    expect(new Set(splits.map((x) => x.slideIndex)).size).toBe(2); // two DISTINCT origin slides
  });
});
