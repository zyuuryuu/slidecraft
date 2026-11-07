/**
 * deck-plan-retry.test.ts — Issue #107: 新規デッキ生成で書式違反（復元不能な \uXXXX）のあった枚だけを
 * 1 回だけ再生成して差し替える。
 *
 * 用語: floor＝最低限の安全網（違反した要素を除外して告知する既存の仕組み・stripViolations）。
 * LLM 呼び出しはスタブで固定する（再試行の判定・差し替えは engine の純関数、呼び出しは components）。
 */
import { describe, it, expect, vi } from "vitest";
import { extractDeckPlan, draftDeckPlan, deckPlanToDeck, type SlidePlan } from "../src/engine/deck-plan";
import { finalizeDeckDraft } from "../src/engine/deck-plan-violations";
import { slideRetryRequest, acceptSlideRetry } from "../src/engine/deck-plan-retry";
import { slideRetrySystemPrompt, deckPlanSystemPrompt } from "../src/engine/deck-plan-prompts";
import { systemPromptForMode } from "../src/engine/llm-prompts";
import { postProcessAiResult } from "../src/components/ai-generation-types";
import { postProcessWithRetry } from "../src/components/deck-retry";
import { serializeMd } from "../src/engine/md-serializer";

const HEALTHY = JSON.stringify({ slides: [
  { kind: "title", title: "表紙", subtitle: "副題" },
  { kind: "content", title: "課題", bullets: ["項目A", "項目B"] },
  { kind: "closing", title: "まとめ" },
] });
// 2 枚目の 2 つ目の bullet が不完全な \u エスケープ（json-salvage が U+FFFD にする → floor が除外）。
const ONE_BAD = String.raw`{"slides":[{"kind":"title","title":"表紙","subtitle":"副題"},{"kind":"content","title":"課題","bullets":["項目A","壊れた\u30cエスケープ"]},{"kind":"closing","title":"まとめ"}]}`;
// 2 枚目と 3 枚目に違反。
const TWO_BAD = String.raw`{"slides":[{"kind":"title","title":"表紙"},{"kind":"content","title":"課題","bullets":["\u30c壊"]},{"kind":"content","title":"対策\u30","bullets":["x"]},{"kind":"closing","title":"まとめ"}]}`;

const GOOD_RETRY = JSON.stringify({ kind: "content", title: "課題", bullets: ["項目A", "項目B（再生成）"] });
const BAD_RETRY = String.raw`{"kind":"content","title":"課題","bullets":["また\u30c壊れた"]}`;
const REQ = "新製品の社内説明資料を作って";

const noCall = () => vi.fn(async (): Promise<string> => { throw new Error("regenerate must not be called"); });

function floorPlan(raw: string): SlidePlan[] {
  const r = extractDeckPlan(raw);
  if (!r.ok) throw new Error(r.error);
  return r.plan.slides;
}

describe("engine: draft → finalize（floor の分解）", () => {
  it("違反のあった枚を index 付きで記録する（違反の無い枚は記録しない）", () => {
    const d = draftDeckPlan(ONE_BAD);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.draft.violations).toEqual([{ index: 1, dropped: 1 }]);
  });

  it("再試行なしの finalize は extractDeckPlan と一致する（floor 経路は 1 本・R8）", () => {
    for (const raw of [HEALTHY, ONE_BAD, TWO_BAD]) {
      const d = draftDeckPlan(raw);
      if (!d.ok) throw new Error(d.error);
      expect(finalizeDeckDraft(d.draft)).toEqual(extractDeckPlan(raw));
    }
  });

  it("acceptSlideRetry: 違反ゼロの 1 枚だけを合格にする", () => {
    expect(acceptSlideRetry(GOOD_RETRY)).toEqual({ kind: "content", title: "課題", bullets: ["項目A", "項目B（再生成）"] });
    expect(acceptSlideRetry(BAD_RETRY)).toBeNull(); // 再試行後も違反 → 不合格
    expect(acceptSlideRetry("sorry")).toBeNull(); // parse 不能 → 不合格
    expect(acceptSlideRetry(JSON.stringify({ kind: "section", title: "" }))).toBeNull(); // 空 → 不合格
  });

  it("slideRetryRequest: 依頼文・対象枚の位置と kind を含み、U+FFFD を含めない", () => {
    const d = draftDeckPlan(ONE_BAD);
    if (!d.ok) throw new Error(d.error);
    const req = slideRetryRequest(REQ, d.draft, 1);
    expect(req).toContain(REQ);
    expect(req).toContain("slide 2");
    expect(req).toContain('"content"');
    expect(req).not.toContain("�");
  });

  it("slide-retry の system prompt は 1 枚専用で、\\uXXXX 禁止を明記する", () => {
    expect(systemPromptForMode("slide-retry", "2026-01-01")).toBe(slideRetrySystemPrompt());
    expect(slideRetrySystemPrompt()).toContain("NEVER use \\uXXXX");
    expect(slideRetrySystemPrompt()).not.toBe(deckPlanSystemPrompt());
  });
});

describe("components: postProcessWithRetry（LLM スタブ）", () => {
  it("正常デッキ: 再試行を呼ばず、出力は従来経路と byte-identical", async () => {
    const regenerate = noCall();
    const pp = await postProcessWithRetry("slides", HEALTHY, undefined, { userRequest: REQ, regenerate });
    expect(regenerate).not.toHaveBeenCalled();
    expect(pp).toEqual(postProcessAiResult("slides", HEALTHY));
    expect(pp.notice).toBeUndefined();
  });

  it("違反を含む 1 枚だけが再生成され、他の枚は byte-identical", async () => {
    const regenerate = vi.fn(async () => GOOD_RETRY);
    const pp = await postProcessWithRetry("slides", ONE_BAD, undefined, { userRequest: REQ, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate.mock.calls[0][0]).toContain("slide 2");
    const floor = floorPlan(ONE_BAD);
    const expected = serializeMd(deckPlanToDeck({ slides: [floor[0], acceptSlideRetry(GOOD_RETRY)!, floor[2]] }));
    expect(pp.result).toBe(expected);
    // 告知: 再試行した事実と結果を残す（never-silent）。差し替え済みなので「除外しました」は出さない。
    expect(pp.notice).toContain("再生成");
    expect(pp.notice).not.toContain("除外しました");
  });

  it("再試行は最大 1 回。再試行後も違反なら floor の結果と告知が残る", async () => {
    const regenerate = vi.fn(async () => BAD_RETRY);
    const pp = await postProcessWithRetry("slides", ONE_BAD, undefined, { userRequest: REQ, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    const floor = postProcessAiResult("slides", ONE_BAD);
    expect(pp.result).toBe(floor.result);
    expect(pp.notice).toContain(floor.notice!); // floor の告知「1 か所を除外しました」が残る
    expect(pp.notice).toContain("再生成");
  });

  it("再試行の呼び出しが失敗しても floor の結果と告知が残る", async () => {
    const regenerate = vi.fn(async (): Promise<string> => { throw new Error("network down"); });
    const pp = await postProcessWithRetry("slides", ONE_BAD, undefined, { userRequest: REQ, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(1);
    const floor = postProcessAiResult("slides", ONE_BAD);
    expect(pp.result).toBe(floor.result);
    expect(pp.notice).toContain(floor.notice!);
  });

  it("違反枚が 2 枚なら各 1 回ずつ（計 2 回）。成功分だけ差し替え、失敗分は floor のまま告知", async () => {
    const regenerate = vi.fn()
      .mockResolvedValueOnce(GOOD_RETRY)
      .mockResolvedValueOnce(BAD_RETRY);
    const pp = await postProcessWithRetry("slides", TWO_BAD, undefined, { userRequest: REQ, regenerate });
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(regenerate.mock.calls[0][0]).toContain("slide 2");
    expect(regenerate.mock.calls[1][0]).toContain("slide 3");
    const d = draftDeckPlan(TWO_BAD);
    if (!d.ok) throw new Error(d.error);
    const expected = finalizeDeckDraft(d.draft, [{ index: 1, slide: acceptSlideRetry(GOOD_RETRY)! }, { index: 2 }]);
    if (!expected.ok) throw new Error(expected.error);
    expect(pp.result).toBe(serializeMd(deckPlanToDeck(expected.plan)));
    expect(pp.notice).toContain("1 か所を除外しました"); // 3 枚目（失敗）の除外は残る
    expect(pp.notice).toMatch(/2 枚.*再生成/);
  });

  it("キャンセル（abort）は再試行で握りつぶさず伝播する", async () => {
    const ac = new AbortController();
    const regenerate = vi.fn(async (): Promise<string> => { ac.abort(); throw new Error("cancelled"); });
    await expect(postProcessWithRetry("slides", ONE_BAD, undefined, { userRequest: REQ, regenerate, signal: ac.signal }))
      .rejects.toThrow("cancelled");
  });

  it("slides 以外のモードは従来の postProcessAiResult と同一（再試行なし）", async () => {
    const regenerate = noCall();
    const raw = "# 見出し\n\n- a\n";
    expect(await postProcessWithRetry("slide", raw, undefined, { userRequest: REQ, regenerate }))
      .toEqual(postProcessAiResult("slide", raw));
    expect(regenerate).not.toHaveBeenCalled();
  });
});
