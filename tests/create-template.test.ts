/**
 * create-template.test.ts — Theme 3 / S2 增分1: template PROVISIONING (src/mcp/templates.ts). A bare
 * AI with no .pptx bytes must be able to mint a usable template from a spec (or the MIDNIGHT preset)
 * and hand it to new_project. Locks: empty spec → usable starter, partial spec fills from MIDNIGHT,
 * low-contrast text is deterministically fixed + noticed, the created bytes round-trip through
 * new_project, and non-JSON is rejected never-silently. See docs/design/mcp-brushup.md §G.
 */
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTemplate, getTemplateSpecGuide } from "../src/mcp/templates";
import { PALETTE_KEYS } from "../src/engine/template-layout-library";
import * as S from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

function bytesOf(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

describe("create_template — mint a usable template from a spec/preset", () => {
  it("an EMPTY spec yields a usable (non-rejected) MIDNIGHT starter", async () => {
    const r = await createTemplate();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.templateBase64.length).toBeGreaterThan(0);
    expect(r.health.status).not.toBe("rejected");
  });

  it("the created bytes round-trip through new_project into a usable deck (stdio bootstrapping)", async () => {
    const r = await createTemplate('{"name":"My Deck"}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = S.createSession(null);
    const created = await S.newProject(s, bytesOf(r.templateBase64), "# 表紙\n\n---\n\n# 中身\n\n- A\n- B");
    expect(created.slideCount).toBeGreaterThan(1);
    // the freshly-minted template is fully usable — its catalog resolves + has a body budget
    const cat = S.entriesAndBudget(s);
    expect(cat.entries.length).toBeGreaterThan(0);
  });

  it("low-contrast text pairs are deterministically fixed and reported in notices", async () => {
    // titleText nearly equals background (both very dark) → the harness must lift it to a readable colour
    const r = await createTemplate('{"palette":{"background":"111111","titleText":"1A1A1A"}}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notices.some((n) => /titleText/.test(n))).toBe(true);
    expect(r.health.status).not.toBe("rejected");
  });

  it("rejects input with no JSON never-silently", async () => {
    const r = await createTemplate("please make me a nice dark corporate template");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.length).toBeGreaterThan(0);
  });
});

describe("get_template_spec_guide — the L3 spec authoring guide + MIDNIGHT preset", () => {
  it("returns the spec format guide and the full 9-key MIDNIGHT preset", () => {
    const g = getTemplateSpecGuide();
    expect(g.guide.length).toBeGreaterThan(100);
    for (const key of PALETTE_KEYS) {
      expect(g.presets.midnight).toHaveProperty(key);
    }
  });

  it("returns an independent preset copy — mutating one call cannot poison the shared default", () => {
    const g1 = getTemplateSpecGuide();
    g1.presets.midnight.background = "MUTATED";
    const g2 = getTemplateSpecGuide();
    expect(g2.presets.midnight.background).not.toBe("MUTATED");
  });
});

describe("bootstrap discoverability — the acquire→use flow is reachable", () => {
  it("new_project's description points a bare AI to create_template, and both provisioning tools are registered", async () => {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "new_project")?.description).toContain("create_template");
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_template");
    expect(names).toContain("get_template_spec_guide");
  });
});
