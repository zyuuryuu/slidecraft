/**
 * split-index-map.test.ts — #243: split_overflowing_slides の戻りに「旧→新」index 対応表
 * (indexMap) を含める。distillDeckReport が既に持つ offsets（newIndices と同一源、R8）から
 * before→after を導出する。分割が起きない（changed:false）ケースは空 indexMap（不変条件）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

async function opened() {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# 表紙");
  return s;
}

describe("distill() — indexMap（旧→新 index 対応表, #243）", () => {
  it("分割が起きない場合は空の indexMap", async () => {
    const s = await opened();
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(false);
    expect(r.indexMap).toEqual([]);
  });

  it("分割された元スライドと、その後続の旧→新 index が indexMap に載る", async () => {
    const s = await opened();
    const bullets = Array.from({ length: 40 }, (_, i) => `- 長い箇条書き項目${i}：容量を超過させるための十分に長いテキストをここに置きます`).join("\n");
    // 旧index: 0=表紙(不変), 1=中身(分割対象), 2=末尾(分割によって後方へシフトする)
    S.applyDeckMarkdown(s, `# 表紙\n\n---\n\n# 中身\n\n${bullets}\n\n---\n\n# 末尾\n\n- 最後の項目`);
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.changedSlides.length).toBeGreaterThan(1); // 中身 が複数スライドに分割された

    // 分割元スライド（旧index=1）のエントリが載る。after は最初のパートの新 index。
    const splitSourceEntry = r.indexMap.find((e) => e.before === 1);
    expect(splitSourceEntry).toBeTruthy();
    expect(splitSourceEntry!.after).toBe(r.changedSlides[0]);

    // 後続スライド（旧index=2 の「末尾」）は分割の分だけ後方にシフトする。
    const tailEntry = r.indexMap.find((e) => e.before === 2);
    expect(tailEntry).toBeTruthy();
    expect(tailEntry!.after).toBe(r.after - 1); // 分割後デッキの末尾に位置する
    expect(tailEntry!.after).not.toBe(2); // 実際にずれている

    // 表紙（旧index=0）は分割の影響を受けないので indexMap に不要なエントリを持たない。
    expect(r.indexMap.some((e) => e.before === 0)).toBe(false);
  });

  it("indexMap の after を使った set_slide_markdown が正しい（シフト後の）スライドに当たる — 再 get_deck 不要", async () => {
    const s = await opened();
    const bullets = Array.from({ length: 40 }, (_, i) => `- 長い箇条書き項目${i}：容量を超過させるための十分に長いテキストをここに置きます`).join("\n");
    S.applyDeckMarkdown(s, `# 表紙\n\n---\n\n# 中身\n\n${bullets}\n\n---\n\n# 末尾\n\n- 最後の項目`);
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const tailEntry = r.indexMap.find((e) => e.before === 2)!;
    // 分割前に取得した旧index=2 ではなく、indexMap の after をそのまま set_slide_markdown に使う。
    const applied = S.applySlideMarkdown(s, tailEntry.after, "# 末尾（更新）\n\n- 更新済みの項目");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.changed).toBe(true);
    expect(applied.afterMd).toContain("末尾（更新）");

    // 分割で生成された継続スライド（changedSlides の各 index）は無傷のまま。
    for (const idx of r.changedSlides) {
      expect(S.getSlideMarkdown(s, idx)).not.toContain("末尾（更新）");
    }
  });
});
