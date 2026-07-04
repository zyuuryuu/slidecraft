/**
 * egress-consent.test.ts — the BYOK egress consent policy (F1 — ADR-0016). Pure functions
 * (the trusted list is passed in) so they run in the node test env without localStorage.
 * A non-preset, non-local cloud host must be explicitly trusted before the API key is sent.
 */
import { describe, it, expect } from "vitest";
import { hostOf, isPresetHost, needsEgressConsent } from "../src/ipc/egress-consent";

describe("egress-consent policy (F1 — ADR-0016)", () => {
  it("hostOf lowercases + strips scheme/brackets, null on garbage", () => {
    expect(hostOf("https://API.OpenAI.com/v1")).toBe("api.openai.com");
    expect(hostOf("my-proxy.example.com")).toBe("my-proxy.example.com"); // bare host
    expect(hostOf("http://[::1]:1234")).toBe("::1");
    expect(hostOf("")).toBeNull();
    expect(hostOf("ht!tp://%%%")).toBeNull();
  });

  it("preset cloud hosts never need consent", () => {
    expect(isPresetHost("api.anthropic.com")).toBe(true);
    for (const u of ["https://api.anthropic.com", "https://api.openai.com/v1", "https://openrouter.ai/api/v1"]) {
      expect(needsEgressConsent(u, [])).toBe(false);
    }
  });

  it("local / loopback / LAN never needs consent", () => {
    for (const u of ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://192.168.1.9:8080", "http://[::1]:11434"]) {
      expect(needsEgressConsent(u, [])).toBe(false);
    }
  });

  it("a non-preset cloud host needs consent until it is trusted", () => {
    expect(needsEgressConsent("https://evil-proxy.example.com/v1", [])).toBe(true);
    expect(needsEgressConsent("https://evil-proxy.example.com/v1", ["evil-proxy.example.com"])).toBe(false);
    // trust is host-scoped, not path/port-scoped in a way that lets a different host sneak through
    expect(needsEgressConsent("https://other.example.com/v1", ["evil-proxy.example.com"])).toBe(true);
  });
});
