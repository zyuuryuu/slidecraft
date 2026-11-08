/**
 * collab-pull-plan.ts — CollabProjection.tick の「この tick で何を pull するか」の判定（純関数）。
 * collab-projection.ts が R1（400 行）に達したため切り出した。I/O は持たない。
 *
 * #616: template-only rev（AI の augment/adjust_template。list_documents で `templateRev === rev`）は deck が
 * 変わっていないので deck を再適用しない（再適用すると GUI undo に空エントリが積まれる）。
 * D1（PR #619 レビュー）: ただし GUI 編集が拒否/失敗した直後（forceDeckPull）は、GUI が楽観適用した編集が
 * host に無いまま画面に残っているので、template-only rev でも deck を pull して host の真値へ戻す。
 */
export interface PullPlanInput {
  /** 前回適用した doc と同じ doc か（false = 初回採用 or 切替）。 */
  sameDoc: boolean;
  /** host の現在 rev（list_documents）。 */
  rev: number;
  /** GUI が適用済みの rev。 */
  lastRev: number;
  /** host の templateRev（無ければ 0）。 */
  templateRev: number;
  /** GUI が既に持っているテンプレの templateRev（無ければ 0）。 */
  templateRevSeen: number;
  /** onTemplate が配線されているか（未配線ならテンプレは pull しない）。 */
  pullsTemplates: boolean;
  /** 直前の GUI 送信が拒否/失敗した（楽観適用を host の真値で戻す必要がある）。 */
  forceDeckPull: boolean;
}

export interface PullPlan {
  /** 何もしない（既にこの rev を適用済み）。 */
  skip: boolean;
  needDeck: boolean;
  needTemplate: boolean;
}

export function planPull(i: PullPlanInput): PullPlan {
  const needTemplate = i.pullsTemplates && i.templateRev > i.templateRevSeen;
  if (i.sameDoc && i.rev <= i.lastRev && !needTemplate) return { skip: true, needDeck: false, needTemplate: false };
  // 新しい rev がテンプレ変更 1 つだけ → deck は適用済みのものと同じ。
  const templateOnly = i.sameDoc && i.rev === i.lastRev + 1 && i.templateRev === i.rev;
  const needDeck = !i.sameDoc || (i.rev > i.lastRev && (!templateOnly || i.forceDeckPull));
  return { skip: false, needDeck, needTemplate };
}
