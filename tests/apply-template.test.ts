/**
 * apply-template.test.ts — the shared gated "apply a master" path (Slice 1a).
 * A valid master is applied (setTemplateData + name); invalid bytes surface a parse error and
 * are NOT applied — the gate is never bypassed regardless of which UI path picks the master.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { applyTemplateBytes } from "../src/components/apply-template";

const CANONICAL = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

function setters() {
  return {
    setTemplateData: vi.fn(),
    setTemplateName: vi.fn(),
    setParseError: vi.fn(),
  };
}

describe("applyTemplateBytes (shared master-apply gate)", () => {
  it("applies a valid master and strips the .pptx from the name", async () => {
    const s = setters();
    const buf = readFileSync(CANONICAL).buffer as ArrayBuffer;
    const res = await applyTemplateBytes(buf, "Midnight Executive.pptx", s);

    expect(res.ok).toBe(true);
    expect(res.health?.status).not.toBe("rejected");
    expect(s.setTemplateData).toHaveBeenCalledOnce();
    expect(s.setTemplateName).toHaveBeenCalledWith("Midnight Executive");
    expect(s.setParseError).not.toHaveBeenCalled();
  });

  it("does NOT apply unreadable bytes — surfaces an error instead", async () => {
    const s = setters();
    const res = await applyTemplateBytes(new Uint8Array([1, 2, 3, 4]).buffer, "broken.pptx", s);

    expect(res.ok).toBe(false);
    expect(s.setTemplateData).not.toHaveBeenCalled();
    expect(s.setParseError).toHaveBeenCalledOnce();
  });
});
