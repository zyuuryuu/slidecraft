/**
 * project-filename.test.ts — projectTitleFromFileName / PROJECT_EXT: the one place the
 * `.scft` extension is derived, shared by the file picker and the OS launch-open path.
 * Guards the .slidecraft → .scft rename: a stray hard-coded `.slidecraft` regex would
 * fail to strip the new extension and surface it in the tab title.
 */
import { describe, it, expect } from "vitest";
import { projectTitleFromFileName, PROJECT_EXT } from "../src/engine/project-io";

describe("PROJECT_EXT", () => {
  it("is the short scft extension (no dot)", () => {
    expect(PROJECT_EXT).toBe("scft");
  });
});

describe("projectTitleFromFileName", () => {
  it("strips a trailing .scft (case-insensitive)", () => {
    expect(projectTitleFromFileName("四半期報告.scft")).toBe("四半期報告");
    expect(projectTitleFromFileName("Deck.SCFT")).toBe("Deck");
  });

  it("takes only the last path segment (accepts a full launch path)", () => {
    expect(projectTitleFromFileName("/home/u/Documents/売上.scft")).toBe("売上");
    expect(projectTitleFromFileName("C:\\Users\\u\\提案.scft")).toBe("提案");
  });

  it("leaves a name without the .scft extension untouched (incl. other extensions)", () => {
    expect(projectTitleFromFileName("notes.md")).toBe("notes.md");
    expect(projectTitleFromFileName("plain")).toBe("plain");
    // only a trailing .scft is stripped — an interior occurrence stays
    expect(projectTitleFromFileName("archive.scft.bak")).toBe("archive.scft.bak");
  });
});
