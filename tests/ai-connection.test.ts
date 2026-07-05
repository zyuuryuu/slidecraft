/**
 * ai-connection.test.ts — the builtin (llamafile) connection UX: the ephemeral baseURL must never
 * persist (else a stale port defeats auto-start-on-generate), and an unreachable builtin must surface
 * an ACTIONABLE message ("起動 で再起動 / 生成で自動起動") instead of the generic "接続できません".
 */
import { describe, it, expect } from "vitest";
import { computeConnection, freshBuiltin, defaultConfigs } from "../src/components/ai-generation-types";

type ConnArgs = Parameters<typeof computeConnection>[0];
const builtinArgs = (over: Partial<ConnArgs> = {}): ConnArgs => ({
  provider: "builtin",
  preset: { native: false, keyRequired: false },
  cfg: { baseURL: "", model: "granite", apiKey: "" },
  builtinStatus: { kind: "idle" },
  weightsPresent: true,
  builtinModel: null,
  modelsLoading: false,
  modelsError: null,
  models: [],
  ...over,
});

describe("freshBuiltin", () => {
  it("blanks the builtin baseURL (ephemeral per-run port), leaves other providers untouched", () => {
    const cfgs = {
      ...defaultConfigs(),
      builtin: { baseURL: "http://127.0.0.1:63428", model: "granite", apiKey: "" },
      claude: { baseURL: "https://api.anthropic.com", model: "opus", apiKey: "sk-x" },
    };
    const out = freshBuiltin(cfgs);
    expect(out.builtin.baseURL).toBe(""); // stale port cleared → auto-start-on-generate can fire
    expect(out.builtin.model).toBe("granite"); // model kept
    expect(out.claude).toEqual({ baseURL: "https://api.anthropic.com", model: "opus", apiKey: "sk-x" });
  });
});

describe("computeConnection — builtin surfaces the FIX, not just the error", () => {
  it("baseURL set but unreachable → 'オフラインAIが応答しません' + a 起動 resolution (not generic 接続できません)", () => {
    const c = computeConnection(builtinArgs({
      cfg: { baseURL: "http://127.0.0.1:63428", model: "granite", apiKey: "" },
      modelsError: "error sending request for url",
    }));
    expect(c.ok).toBe(false);
    expect(c.tone).toBe("err");
    expect(c.label).toContain("応答しません");
    expect(c.label).not.toContain("接続できません"); // not the generic message
    expect(c.hint).toMatch(/起動/); // the resolution is presented inline
  });

  it("baseURL empty (fresh) → '未起動' with the auto-start resolution", () => {
    const c = computeConnection(builtinArgs());
    expect(c.label).toContain("未起動");
    expect(c.hint).toMatch(/自動で起動/);
  });

  it("weights not downloaded → '未取得' with the download resolution", () => {
    const c = computeConnection(builtinArgs({ weightsPresent: false }));
    expect(c.label).toContain("未取得");
    expect(c.hint).toMatch(/ダウンロード/);
  });
});
