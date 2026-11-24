/**
 * claude-key-verify-followups-712.test.ts — #712: Claude のキー検証（#691・PR #700）の残所見。
 *
 *  1. 失敗結果のキャッシュ：確定的な結果（成功・401・403）だけを「同じキー＋接続先では再確認しない」
 *     キャッシュに入れる。通信不可・5xx・429 は入れない（回線が戻れば次の切替・再表示で再確認が走る）。
 *  2. ローカルモデル限定のとき：i18n の文字列を modelsError に流す番兵をやめ、computeConnection に
 *     「確認を省いた（local）」と明示して渡す。表示は「接続できません」と言わない。
 *  3. Claude の枝のヒントは辞書経由（生のエラー文をそのままヒントにしない）・重複キー checkModelName を廃止。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeConnection } from "../src/components/ai-generation-types";
import { planModelsQuery, cacheKeyAfter, settledModelsState } from "../src/components/useProviderModels";
import i18n from "../src/i18n"; // ja default

const SRC = resolve(__dirname, "../src");
const read = (p: string) => readFileSync(resolve(SRC, p), "utf8");

describe("#712-1 確定的な結果だけキャッシュする", () => {
  const base = { provider: "claude" as const, baseURL: "", apiKey: "sk-ant-x", localOnly: false, force: false };
  /** 1 回問い合わせて結果 error を得たあと、同じキー＋接続先でもう一度計画したときの kind。 */
  const replanAfter = (error: string | null) => {
    const first = planModelsQuery({ ...base, cachedKey: null });
    if (first.kind !== "fetch") throw new Error("expected fetch");
    return planModelsQuery({ ...base, cachedKey: cacheKeyAfter(first, error) }).kind;
  };

  it("通信不可の後は、同じキー＋接続先でも再確認が走る", () => {
    expect(replanAfter("Could not reach the Claude API")).toBe("fetch");
  });
  it("5xx・429 の後も再確認が走る", () => {
    expect(replanAfter("HTTP 500")).toBe("fetch");
    expect(replanAfter("HTTP 503")).toBe("fetch");
    expect(replanAfter("HTTP 429")).toBe("fetch");
  });
  it("401・403・成功の後は再確認しない（cached）", () => {
    expect(replanAfter("HTTP 401")).toBe("cached");
    expect(replanAfter("HTTP 403")).toBe("cached");
    expect(replanAfter(null)).toBe("cached");
  });
  it("他プロバイダの問い合わせ（cacheKey なし）はキャッシュしない", () => {
    const p = planModelsQuery({ ...base, provider: "openai", cachedKey: null });
    expect(cacheKeyAfter(p, null)).toBeNull();
  });
});

describe("#712-2 ローカルモデル限定のときは「確認を省いた」と明示して渡す", () => {
  it("skip-local の状態はエラー文を持たず、skipped: local を持つ（番兵の文字列を流さない）", () => {
    const s = settledModelsState({ kind: "skip-local" }, null);
    expect(s).toEqual({ models: [], error: null, skipped: "local" });
  });
  it("キー未入力（skip-nokey）は従来どおり空・エラーなし・省略印なし", () => {
    expect(settledModelsState({ kind: "skip-nokey" }, null)).toEqual({ models: [], error: null, skipped: null });
  });
  it("useProviderModels は表示文言を作らない（i18n を import しない）", () => {
    expect(read("components/useProviderModels.ts")).not.toMatch(/from "\.\.\/i18n"|localOnlyNoCheck/);
  });

  it("computeConnection は「接続できません」を含まないラベル／ヒントを返し、緑にしない", () => {
    const c = computeConnection({
      provider: "claude", preset: { native: true, keyRequired: true }, cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "sk-ant-x" },
      builtinStatus: { kind: "idle" }, weightsPresent: null, builtinModel: null,
      modelsLoading: false, modelsError: null, models: [], modelsSkipped: "local",
    });
    expect(c).toMatchObject({ ok: false, tone: "warn", label: i18n.t("aiStatus.localOnlyNoCheck") });
    expect(`${c.label} ${c.hint ?? ""}`).not.toContain(i18n.t("aiStatus.cantConnect"));
    expect(c.label).toContain("クラウドへの接続確認はしません");
  });

  // 統括レビュー（PR #759）: ローカル限定を OFF にした直後は fetch 中。「確認中」が skipped より勝つ（main と同じ順）。
  it("modelsLoading のときは skipped より「確認中」が勝つ（トグル OFF 直後に古いラベルを出さない）", () => {
    const c = computeConnection({
      provider: "claude", preset: { native: true, keyRequired: true }, cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "sk-ant-x" },
      builtinStatus: { kind: "idle" }, weightsPresent: null, builtinModel: null,
      modelsLoading: true, modelsError: null, models: [], modelsSkipped: "local",
    });
    expect(c).toMatchObject({ tone: "checking", label: i18n.t("aiStatus.checkingConnection") });
  });
});

describe("#712-3 Claude の枝のヒントは辞書経由", () => {
  const claude = (modelsError: string) => computeConnection({
    provider: "claude", preset: { native: true, keyRequired: true }, cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "sk-ant-x" },
    builtinStatus: { kind: "idle" }, weightsPresent: null, builtinModel: null,
    modelsLoading: false, modelsError, models: [],
  });

  it("通信不可・429 のヒントは checkEndpointHint で包む（他プロバイダと同じ）", () => {
    for (const e of ["Could not reach the Claude API", "HTTP 429"]) {
      expect(claude(e).hint).toBe(i18n.t("aiStatus.checkEndpointHint", { error: e }));
    }
  });
  it("生のエラー文をそのままヒントにする箇所が無い（grep 0）", () => {
    expect(read("components/ai-generation-types.ts").match(/hint:\s*(modelsError|error)\b/g) ?? []).toEqual([]);
  });
  it("重複キー aiStatus.checkModelName は辞書に無く、コードからも参照しない（checkModelNameHint に統一）", () => {
    for (const lang of ["ja", "en"]) {
      const dict = JSON.parse(read(`i18n/locales/${lang}.json`)) as { aiStatus: Record<string, string> };
      expect(dict.aiStatus).not.toHaveProperty("checkModelName");
      expect(dict.aiStatus).toHaveProperty("checkModelNameHint");
    }
    expect(read("components/ai-generation-types.ts")).not.toMatch(/aiStatus\.checkModelName"/);
  });
});
