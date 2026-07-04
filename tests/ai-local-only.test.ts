/**
 * ai-local-only.test.ts — the local-model-only egress guard.
 * The block lives in generateWithAI (the single choke every path routes through), so
 * submit/submitAndWait — which skip the UI-level canGenerate — still cannot leak the
 * deck to a cloud endpoint. These tests are network-free (the block rejects up front).
 */
import { describe, it, expect } from "vitest";
import { isLocalBaseURL, isLocalTarget, generateWithAI, assertValidBaseURL } from "../src/ipc/ai";

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

describe("assertValidBaseURL (F1 — reject insecure/invalid endpoints before the key is attached)", () => {
  it("accepts https cloud + any local (loopback/LAN may stay http)", () => {
    for (const u of [
      "https://api.openai.com/v1",
      "https://my-proxy.example.com/v1",
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234",
      "http://192.168.1.5:8080",
    ]) {
      expect(() => assertValidBaseURL(u)).not.toThrow();
    }
  });
  it("rejects http:// (or bare host) to a NON-local target — the Bearer key would leak in cleartext", () => {
    expect(() => assertValidBaseURL("http://evil.example.com/v1")).toThrow(/https/);
    expect(() => assertValidBaseURL("http://api.openai.com/v1")).toThrow(/https/);
    expect(() => assertValidBaseURL("evil.example.com")).toThrow(/https/); // bare host defaults to insecure http
  });
  it("rejects empty / malformed URLs", () => {
    expect(() => assertValidBaseURL("")).toThrow();
    expect(() => assertValidBaseURL("   ")).toThrow();
    expect(() => assertValidBaseURL("ht!tp://%%%")).toThrow();
  });
});

describe("generateWithAI — rejects an insecure custom endpoint before any network call", () => {
  it("throws on http:// to a remote host (key would leak in cleartext), even when localOnly is off", async () => {
    await expect(
      generateWithAI({ apiKey: "k", model: "m", mode: "slide", userRequest: "hi", provider: "custom", baseURL: "http://evil.example.com/v1" }),
    ).rejects.toThrow(/https/);
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
