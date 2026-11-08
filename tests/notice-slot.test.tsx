/**
 * notice-slot.test.tsx — #613: ツールバー直下に積み重なっていた帯（更新通知・取り込み結果・テンプレ調整）を
 * 1 つの通知枠（NoticeSlot）にまとめ、同時に出すのは 1 本だけにする。
 *
 *  1. 「今どの帯を出すか」は純関数 noticeSlotPlan だけが決める。優先順は テンプレ調整 ＞ 取り込み中・取り込み結果
 *     ＞ 更新通知。隠れた帯は優先順のまま `hidden` に並ぶ（8 通りを全部固定）。
 *  2. NoticeSlot はその計画どおりに 1 本だけ描き、隠れた数をバッジで示す — 計画と描画の一致テスト（R8）。
 *  3. 帯の中身は変えない: 出ている帯は従来の部品（UpdateBanner / IntakeSummaryBar / TemplateAdjustPanel）
 *     そのままの文言で描かれる。
 * 帯の本数の上限（1 本）は tests/ux-budget.test.tsx に集約（#648）。ここは優先順と計画・描画の一致を見る。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 master-menu.test.tsx）。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import NoticeSlot from "../src/components/NoticeSlot";
import { noticeSlotPlan, type NoticeKind } from "../src/components/notice-slot-plan";
import type { IntakeResult } from "../src/components/IntakeSummaryBar";
import type { AdjustSession } from "../src/components/useTemplateAdjust";

const noop = () => {};
const result: IntakeResult = {
  mode: "import",
  name: "会社.pptx",
  summary: { status: "ok", layoutCount: 13, findings: [] },
  ts: 1,
};
const session = {
  sourceName: "会社",
  slots: { major: { latin: "Arial", ea: "", jpan: "" }, minor: { latin: "Arial", ea: "", jpan: "" } },
} as unknown as AdjustSession;

/** All 8 on/off combinations of the three notices. */
const combos = [false, true].flatMap((adjusting) =>
  [false, true].flatMap((intake) => [false, true].map((update) => ({ adjusting, intake, update }))),
);

const render = (s: { adjusting: boolean; intake: boolean; update: boolean }) =>
  renderToStaticMarkup(
    <NoticeSlot
      update={s.update ? { latestVersion: "9.9.9", onDismiss: noop } : null}
      intake={{ busy: null, result: s.intake ? result : null, onDismiss: noop }}
      adjust={s.adjusting ? { session, busy: false, onPreview: noop, onApply: noop, onCancel: noop } : null}
    />,
  );

// The fixed text each band carries (unchanged band contents).
const UPDATE_TEXT = "新しいバージョン（v9.9.9）が利用可能です。";
const INTAKE_TEXT = "取り込み結果";
const ADJUST_TEXT = 'aria-label="テンプレ調整"';
const bandsIn = (html: string): NoticeKind[] =>
  [
    html.includes(ADJUST_TEXT) ? "adjust" : null,
    html.includes(INTAKE_TEXT) ? "intake" : null,
    html.includes(UPDATE_TEXT) ? "update" : null,
  ].filter((k): k is NoticeKind => k !== null);

describe("#613 noticeSlotPlan: 優先順 テンプレ調整 ＞ 取り込み ＞ 更新通知", () => {
  it("3 つ同時なら テンプレ調整 だけを出し、残り 2 つは優先順で隠す", () => {
    expect(noticeSlotPlan({ adjusting: true, intake: true, update: true })).toEqual({ shown: "adjust", hidden: ["intake", "update"] });
  });
  it("8 通りすべての組み合わせ", () => {
    const table = combos.map((s) => [s, noticeSlotPlan(s)] as const);
    expect(table.map(([s, p]) => `${+s.adjusting}${+s.intake}${+s.update} → ${p.shown ?? "-"} [${p.hidden.join(",")}]`)).toEqual([
      "000 → - []",
      "001 → update []",
      "010 → intake []",
      "011 → intake [update]",
      "100 → adjust []",
      "101 → adjust [update]",
      "110 → adjust [intake]",
      "111 → adjust [intake,update]",
    ]);
  });
});

describe("#613 NoticeSlot: 上に出る帯は 1 本だけ", () => {
  it("取り込み結果・テンプレ調整・更新通知が同時に起きても、描くのはテンプレ調整の帯 1 本と「+2」のバッジ", () => {
    const html = render({ adjusting: true, intake: true, update: true });
    expect(bandsIn(html)).toEqual(["adjust"]);
    expect(html).toMatch(/data-testid="notice-slot-hidden"[^>]*>\+2</);
  });

  it("取り込み結果と更新通知だけなら取り込み結果を出し、バッジは「+1」", () => {
    const html = render({ adjusting: false, intake: true, update: true });
    expect(bandsIn(html)).toEqual(["intake"]);
    expect(html).toMatch(/data-testid="notice-slot-hidden"[^>]*>\+1</);
  });

  it("1 つだけならバッジは出さない／何も無ければ枠ごと出さない", () => {
    const html = render({ adjusting: false, intake: false, update: true });
    expect(bandsIn(html)).toEqual(["update"]);
    expect(html).not.toContain("notice-slot-hidden");
    expect(render({ adjusting: false, intake: false, update: false })).toBe("");
  });

  it("取り込み中（進捗）も取り込みの帯として扱う", () => {
    const html = renderToStaticMarkup(
      <NoticeSlot update={{ latestVersion: "9.9.9", onDismiss: noop }} intake={{ busy: { mode: "import", phase: { phase: "loading" } }, result: null, onDismiss: noop }} adjust={null} />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain(UPDATE_TEXT);
  });

  it("バッジは隠れている帯の名前を優先順で示す", () => {
    const html = render({ adjusting: true, intake: true, update: true });
    expect(html).toContain('title="ほかに 2 件の通知があります（取り込み・更新のお知らせ）。いま出ている帯が終わると表示されます。"');
  });

  it("一致テスト（R8）: 8 通りすべてで、描いた帯・data-notice・バッジ数が noticeSlotPlan と一致する", () => {
    for (const s of combos) {
      const plan = noticeSlotPlan(s);
      const html = render(s);
      expect(bandsIn(html)).toEqual(plan.shown ? [plan.shown] : []);
      if (plan.shown) expect(html).toContain(`data-notice="${plan.shown}"`);
      const badge = html.match(/data-testid="notice-slot-hidden"[^>]*>\+(\d+)</)?.[1];
      expect(badge === undefined ? 0 : Number(badge)).toBe(plan.hidden.length);
    }
  });
});
