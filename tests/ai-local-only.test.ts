/**
 * ai-local-only.test.ts — the local-model-only egress guard.
 * The block lives in generateWithAI (the single choke every path routes through), so
 * submit/submitAndWait — which skip the UI-level canGenerate — still cannot leak the
 * deck to a cloud endpoint. These tests are network-free (the block rejects up front).
 */
import { describe, it, expect } from "vitest";
import { isLocalBaseURL, isLocalTarget, generateWithAI } from "../src/ipc/ai";

describe("isLocalBaseURL", () => {
  it("accepts loopback / localhost / LAN (RFC1918)", () => {
    for (const u of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234",
      "http://192.168.1.5:8080",
      "http://10.0.0.2",
      "http://172.16.0.1",
      "http://[::1]:11434",
      "ollama.localhost",
    ]) {
      expect(isLocalBaseURL(u)).toBe(true);
    }
  });
  it("rejects cloud / public hosts", () => {
    for (const u of [
      "https://api.openai.com/v1",
      "https://openrouter.ai/api/v1",
      "https://example.com",
      "http://8.8.8.8",
      "http://172.32.0.1", // just outside the 172.16/12 private block
      "",
    ]) {
      expect(isLocalBaseURL(u)).toBe(false);
    }
  });
});

describe("isLocalTarget", () => {
  it("native Claude is never local; others follow the actual baseURL host", () => {
    expect(isLocalTarget("claude", "")).toBe(false);
    expect(isLocalTarget("ollama", "http://localhost:11434/v1")).toBe(true);
    expect(isLocalTarget("openai", "https://api.openai.com/v1")).toBe(false);
    expect(isLocalTarget("custom", "http://localhost:1234/v1")).toBe(true);
    expect(isLocalTarget("custom", "https://my-cloud.example.com/v1")).toBe(false);
  });
});

describe("generateWithAI — local-only block (cannot be bypassed by submit/submitAndWait)", () => {
  const base = { apiKey: "", model: "m", mode: "slide" as const, userRequest: "hi", localOnly: true };
  it("blocks cloud Claude before any network call", async () => {
    await expect(generateWithAI({ ...base, provider: "claude", baseURL: "" })).rejects.toThrow(/ローカルモデル限定/);
  });
  it("blocks a cloud OpenAI-compatible endpoint", async () => {
    await expect(generateWithAI({ ...base, provider: "openai", baseURL: "https://api.openai.com/v1" })).rejects.toThrow(/ローカルモデル限定/);
  });
  it("blocks a custom CLOUD endpoint (free-text host is the real risk)", async () => {
    await expect(generateWithAI({ ...base, provider: "custom", baseURL: "https://evil.example.com/v1" })).rejects.toThrow(/ローカルモデル限定/);
  });
});
