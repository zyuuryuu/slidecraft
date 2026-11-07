/**
 * apply-template-adjust.test.ts — #570 段 2: 「テンプレ調整」の適用経路。派生 bytes を faithful Re-make と
 * 同じゲート（loadTemplate → assessTemplateHealth）で TemplateData として適用し、元 bytes は書き換えない。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { applyTemplateBytesAsAdjusted } from "../src/components/apply-template";
import type { TemplateData } from "../src/engine/template-loader";

const CANONICAL = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

function setters() {
  return { setTemplateData: vi.fn<(t: TemplateData) => void>(), setTemplateName: vi.fn<(n: string) => void>(), setParseError: vi.fn<(e: string | null) => void>() };
}

describe("applyTemplateBytesAsAdjusted", () => {
  it("applies the derived template through the gate and returns its bytes; the source is untouched", async () => {
    const src = readFileSync(CANONICAL);
    const before = Buffer.from(src);
    const s = setters();
    const r = await applyTemplateBytesAsAdjusted(src, { scale: { title: 0.9, body: 0.9, other: 0.9 } }, "Midnight（調整）", s);
    expect(r.ok).toBe(true);
    expect(r.adjustedBytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.compare(Buffer.from(r.adjustedBytes!), src)).not.toBe(0);
    expect(Buffer.compare(src, before)).toBe(0); // source bytes never modified
    expect(s.setTemplateData).toHaveBeenCalledTimes(1);
    expect(s.setTemplateData.mock.calls[0][0].masterTitleStyle.fontSize).toBe(39.5); // 44 × 0.9 = 39.6 → 39.5
    expect(s.setTemplateName).toHaveBeenCalledWith("Midnight（調整）");
    expect(r.summary?.status).not.toBe("rejected");
    expect(s.setParseError).not.toHaveBeenCalled();
  });

  it("a no-op recipe yields bytes identical to the source", async () => {
    const src = readFileSync(CANONICAL);
    const r = await applyTemplateBytesAsAdjusted(src, {}, "Midnight", setters());
    expect(r.ok).toBe(true);
    expect(Buffer.compare(Buffer.from(r.adjustedBytes!), src)).toBe(0);
  });

  it("an invalid factor surfaces a parse error and applies nothing", async () => {
    const s = setters();
    const r = await applyTemplateBytesAsAdjusted(readFileSync(CANONICAL), { scale: { title: -1 } }, "x", s);
    expect(r.ok).toBe(false);
    expect(s.setTemplateData).not.toHaveBeenCalled();
    expect(s.setParseError).toHaveBeenCalledTimes(1);
  });
});
