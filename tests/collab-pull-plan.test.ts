/**
 * collab-pull-plan.test.ts — CollabProjection.tick の pull 判定（planPull）の判定表。
 * 統合での挙動は collab-template-sync.test.ts / collab-projection.test.ts が見る。ここは分岐ごとの期待値を固定する。
 */
import { describe, it, expect } from "vitest";
import { planPull, type PullPlanInput } from "../src/ipc/collab-pull-plan";

const base: PullPlanInput = { sameDoc: true, rev: 0, lastRev: 0, templateRev: 0, templateRevSeen: 0, pullsTemplates: true, forceDeckPull: false };
const plan = (o: Partial<PullPlanInput>) => planPull({ ...base, ...o });

describe("planPull", () => {
  it("同じ doc・同じ rev・テンプレ既知 → skip", () => {
    expect(plan({})).toEqual({ skip: true, needDeck: false, needTemplate: false });
  });

  it("初回採用（別 doc）→ deck を pull（rev が進んでいなくても）", () => {
    expect(plan({ sameDoc: false, lastRev: 5, rev: 0 })).toEqual({ skip: false, needDeck: true, needTemplate: false });
  });

  it("deck 編集の新 rev → deck だけ pull", () => {
    expect(plan({ rev: 1 })).toEqual({ skip: false, needDeck: true, needTemplate: false });
  });

  it("#616 template-only rev（rev===lastRev+1 && templateRev===rev）→ テンプレだけ pull・deck は再適用しない", () => {
    expect(plan({ rev: 1, templateRev: 1 })).toEqual({ skip: false, needDeck: false, needTemplate: true });
  });

  it("D1: 送信拒否の直後（forceDeckPull）は template-only rev でも deck を pull する", () => {
    expect(plan({ rev: 1, templateRev: 1, forceDeckPull: true })).toEqual({ skip: false, needDeck: true, needTemplate: true });
  });

  it("forceDeckPull でも rev が進んでいなければ deck は pull しない（従来どおり）", () => {
    expect(plan({ forceDeckPull: true })).toEqual({ skip: true, needDeck: false, needTemplate: false });
  });

  it("onTemplate 未配線 → テンプレは pull しない（template-only rev は何もしない）", () => {
    expect(plan({ rev: 1, templateRev: 1, pullsTemplates: false })).toEqual({ skip: false, needDeck: false, needTemplate: false });
  });

  it("テンプレ変更の後に deck 編集が続いた（templateRev < rev）→ 両方 pull", () => {
    expect(plan({ rev: 2, templateRev: 1 })).toEqual({ skip: false, needDeck: true, needTemplate: true });
  });
});
