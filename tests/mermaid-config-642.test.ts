// #642: mermaid 12 switched the default layout to ELK and the default look to "neo", which re-lays out
// flowchart/state/class/ER. MERMAID_CONFIG pins the mermaid-11 rendering (dagre/classic) and stays the
// ONE config every initialize() uses (R8: the preview and both exports must render identically).
// The node positions themselves are pinned by tests/e2e/mermaid-layout-642.spec.ts (needs a browser).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MERMAID_CONFIG } from "../src/components/mermaid";

const root = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("MERMAID_CONFIG (#642)", () => {
  it("pins the mermaid-11 layout and look (dagre / classic), not the v12 defaults (ELK / neo)", () => {
    expect(MERMAID_CONFIG.layout).toBe("dagre");
    expect(MERMAID_CONFIG.look).toBe("classic");
  });

  it("keeps the security and label settings unchanged", () => {
    expect(MERMAID_CONFIG.securityLevel).toBe("strict");
    expect(MERMAID_CONFIG.flowchart?.htmlLabels).toBe(false);
    expect(MERMAID_CONFIG.theme).toBe("dark");
  });

  it("every mermaid initialize() in src/ passes MERMAID_CONFIG (preview, PPTX export, HTML export)", () => {
    const calls = sourceFiles(join(root, "src")).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\b(\w+)\.initialize\(([^)]*)\)/g)]
        .filter((m) => /mermaid/i.test(m[1]))
        .map((m) => ({ file: relative(root, f), arg: m[2].trim() })),
    );
    expect(calls.map((c) => c.file).sort()).toEqual([
      "src/components/SlidePreview.tsx",
      "src/components/deck-export.ts",
      "src/components/deck-html-export.tsx",
    ]);
    for (const c of calls) expect(c.arg, c.file).toBe("MERMAID_CONFIG");
  });
});
