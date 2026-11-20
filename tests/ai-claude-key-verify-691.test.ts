/**
 * ai-claude-key-verify-691.test.ts — #691: Claude の接続表示が API キーを一度も検証せずに緑になっていた。
 *
 *  1. listProviderModels("claude", …) は固定一覧を返さず、渡したキーで Models API（GET /v1/models）に
 *     認証付きで問い合わせる。401 は例外（"HTTP 401"）で、エラー文にキーを含めない（ADR-0016）。
 *  2. computeConnection の Claude の枝は、他プロバイダと同じ入力（modelsLoading／modelsError／models）で
 *     判定し、「一覧が取れていて今のモデルが一覧にある」ときだけ ok。401／403／通信不可は err。
 *  3. 問い合わせの計画（planModelsQuery）：Claude はキー入力が止まってから（デバウンス）、同じキー＋
 *     接続先では繰り返さない、ローカルのみ設定ではクラウドへ問い合わせない（ADR-0016 F3）。
 *     他プロバイダは従来どおり即時。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/ipc/app-fetch", () => ({ appFetch: vi.fn() }));

import { appFetch } from "../src/ipc/app-fetch";
import { listProviderModels } from "../src/ipc/ai";
import { computeConnection } from "../src/components/ai-generation-types";
import { planModelsQuery, CLAUDE_VERIFY_DEBOUNCE_MS } from "../src/components/useProviderModels";
import "../src/i18n"; // ja default

const fetchMock = vi.mocked(appFetch);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("listProviderModels('claude') — キーで認証付きの問い合わせをする（#691）", () => {
  it("Authorization: Bearer <key> を付けて /v1/models を呼び、モデル id を返す", async () => {
    fetchMock.mockResolvedValue(json(200, {
      data: [{ id: "claude-opus-4-8", type: "model" }, { id: "claude-sonnet-4-6", type: "model" }],
      has_more: false, first_id: "claude-opus-4-8", last_id: "claude-sonnet-4-6",
    }));
    const list = await listProviderModels("claude", "", "sk-ant-good");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit | undefined];
    expect(String(url)).toMatch(/\/v1\/models/);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-ant-good");
    expect(list).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("401 で例外（HTTP 401）になり、エラー文にキーを含めない", async () => {
    fetchMock.mockResolvedValue(json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    const err = await listProviderModels("claude", "", "sk-bogus-SECRET").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/\bHTTP 401\b/);
    expect((err as Error).message).not.toContain("sk-bogus-SECRET");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 確認用なので再試行しない
  });

  it("403 は HTTP 403、通信できないときは HTTP を含まない例外（再試行しない）", async () => {
    fetchMock.mockResolvedValue(json(403, { type: "error", error: { type: "permission_error", message: "no" } }));
    await expect(listProviderModels("claude", "", "sk-x")).rejects.toThrow(/\bHTTP 403\b/);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError("error sending request"));
    const err = await listProviderModels("claude", "", "sk-x").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/HTTP \d{3}/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("キーが空なら通信せずに例外", async () => {
    await expect(listProviderModels("claude", "", "  ")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

type ConnArgs = Parameters<typeof computeConnection>[0];
const claude = (over: Partial<ConnArgs> = {}): ConnArgs => ({
  provider: "claude",
  preset: { native: true, keyRequired: true },
  cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "sk-ant-x" },
  builtinStatus: { kind: "idle" },
  weightsPresent: null,
  builtinModel: null,
  modelsLoading: false,
  modelsError: null,
  models: ["claude-opus-4-8", "claude-sonnet-4-6"],
  ...over,
});

describe("computeConnection — Claude は検証結果でだけ緑になる（#691）", () => {
  it("一覧取得が 401 で失敗 → ok:false・err・「API キーが無効です」", () => {
    const c = computeConnection(claude({ modelsError: "HTTP 401", models: [] }));
    expect(c).toMatchObject({ ok: false, needsUserAction: true, tone: "err", label: "API キーが無効です" });
  });
  it("403 → err・「このキーではモデルを使えません」", () => {
    const c = computeConnection(claude({ modelsError: "HTTP 403", models: [] }));
    expect(c).toMatchObject({ ok: false, needsUserAction: true, tone: "err", label: "このキーではモデルを使えません" });
  });
  it("通信できない → err・「接続できません」", () => {
    const c = computeConnection(claude({ modelsError: "Could not reach the Claude API", models: [] }));
    expect(c).toMatchObject({ ok: false, needsUserAction: true, tone: "err", label: "接続できません" });
  });
  it("確認中 → checking・「接続を確認中…」（利用者の操作は要らない）", () => {
    const c = computeConnection(claude({ modelsLoading: true, models: [] }));
    expect(c).toMatchObject({ ok: false, needsUserAction: false, tone: "checking", label: "接続を確認中…" });
  });
  it("成功して今のモデルが一覧にある → ok のときだけ緑", () => {
    const c = computeConnection(claude());
    expect(c).toMatchObject({ ok: true, needsUserAction: false, tone: "ok", label: "claude-opus-4-8 を使用" });
  });
  it("成功したが今のモデルが一覧に無い → warn・「モデル名を確認」", () => {
    const c = computeConnection(claude({ cfg: { baseURL: "", model: "claude-typo", apiKey: "sk-ant-x" } }));
    expect(c).toMatchObject({ ok: false, needsUserAction: true, tone: "warn", label: "モデル名を確認" });
  });
  it("まだ一覧が無い（未確認）状態では緑にしない", () => {
    expect(computeConnection(claude({ models: [] })).ok).toBe(false);
  });
  it("キーが空 → 従来どおり warn「APIキー未設定」", () => {
    const c = computeConnection(claude({ cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "" }, models: [] }));
    expect(c).toMatchObject({ ok: false, needsUserAction: true, tone: "warn", label: "APIキー未設定" });
  });
  it("エラー文・ヒントにキーを出さない", () => {
    const c = computeConnection(claude({ cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "sk-ant-SECRET" }, modelsError: "HTTP 401", models: [] }));
    expect(JSON.stringify(c)).not.toContain("sk-ant-SECRET");
  });
});

describe("planModelsQuery — いつ問い合わせるか（#691）", () => {
  const base = { baseURL: "", apiKey: "sk-ant-x", localOnly: false, cachedKey: null as string | null, force: false };
  it("Claude はデバウンスして問い合わせる", () => {
    const p = planModelsQuery({ ...base, provider: "claude" });
    expect(p).toMatchObject({ kind: "fetch", delayMs: CLAUDE_VERIFY_DEBOUNCE_MS });
    expect(CLAUDE_VERIFY_DEBOUNCE_MS).toBeGreaterThan(0);
  });
  it("同じキー＋接続先では繰り返さない（cached）。↻（force）なら問い合わせ直す", () => {
    const first = planModelsQuery({ ...base, provider: "claude" });
    if (first.kind !== "fetch") throw new Error("expected fetch");
    expect(planModelsQuery({ ...base, provider: "claude", cachedKey: first.cacheKey }).kind).toBe("cached");
    expect(planModelsQuery({ ...base, provider: "claude", cachedKey: first.cacheKey, force: true }).kind).toBe("fetch");
    // キーが変われば問い合わせ直す
    expect(planModelsQuery({ ...base, provider: "claude", apiKey: "sk-ant-y", cachedKey: first.cacheKey }).kind).toBe("fetch");
  });
  it("ローカルのみ設定ではクラウドへ問い合わせない（ADR-0016 F3）", () => {
    expect(planModelsQuery({ ...base, provider: "claude", localOnly: true }).kind).toBe("skip-local");
  });
  it("キーが空なら問い合わせない", () => {
    expect(planModelsQuery({ ...base, provider: "claude", apiKey: " " }).kind).toBe("skip-nokey");
  });
  it("他プロバイダは従来どおり即時に問い合わせる（キャッシュもしない）", () => {
    for (const provider of ["openai", "openrouter", "ollama", "builtin", "custom"] as const) {
      expect(planModelsQuery({ ...base, provider, cachedKey: "x" })).toMatchObject({ kind: "fetch", delayMs: 0 });
    }
  });
});
