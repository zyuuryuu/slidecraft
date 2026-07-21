// fs-scope.ts — ADR-0035 stage 1 (output-side scoped fs). Guards the invariants: writes stay
// confined to the scope root (never-silent on traversal/absolute/symlink escape), and the happy
// path produces a real, readable file + a stable file:// reference.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveScopeRoot, writeScopedFile, defaultScopedFilename } from "../src/mcp/fs-scope";
import { GuardError } from "../src/mcp/guard-errors";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveScopeRoot", () => {
  it("returns the canonical (realpath) form of an existing directory", () => {
    expect(resolveScopeRoot(dir)).toBe(dir); // mkdtemp already yields a real path on this platform
  });

  it("throws (plain Error) for a missing directory — never-silent", () => {
    expect(() => resolveScopeRoot(join(dir, "does-not-exist"))).toThrow(/見つかりません/);
  });

  it("throws for a path that is a file, not a directory", () => {
    const filePath = join(dir, "a-file.txt");
    writeFileSync(filePath, "x");
    expect(() => resolveScopeRoot(filePath)).toThrow(/ディレクトリを指定/);
  });
});

describe("writeScopedFile — happy path", () => {
  it("writes bytes under root and returns a file:// reference relative to it", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]); // PK.. zip magic
    const res = writeScopedFile(dir, "deck.pptx", "pptx", bytes);
    expect(res.uri).toBe("file:///deck.pptx");
    expect(res.absPath).toBe(join(dir, "deck.pptx"));
    expect(readFileSync(res.absPath)).toEqual(Buffer.from(bytes));
  });

  it("auto-generated filenames (defaultScopedFilename) are themselves valid scoped filenames", () => {
    const name = defaultScopedFilename("My Deck: Q3 Review!", "scft");
    expect(name).toMatch(/^[A-Za-z0-9_-]+\.scft$/);
    const res = writeScopedFile(dir, name, "scft", new Uint8Array([1, 2, 3]));
    expect(existsSync(res.absPath)).toBe(true);
  });

  it("overwrites an existing plain file at the target (re-export / re-save)", () => {
    writeScopedFile(dir, "deck.pptx", "pptx", new Uint8Array([1]));
    const res = writeScopedFile(dir, "deck.pptx", "pptx", new Uint8Array([2, 2, 2]));
    expect(readFileSync(res.absPath)).toEqual(Buffer.from([2, 2, 2]));
  });
});

describe("writeScopedFile — never-silent rejections (ADR-0035 invariants)", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it("rejects ../ traversal", () => {
    expect(() => writeScopedFile(dir, "../escape.pptx", "pptx", bytes)).toThrow(GuardError);
    try {
      writeScopedFile(dir, "../escape.pptx", "pptx", bytes);
    } catch (e) {
      expect((e as GuardError).code).toBe("scope-violation");
    }
  });

  it("rejects a nested path (subdirectory traversal)", () => {
    expect(() => writeScopedFile(dir, "sub/deck.pptx", "pptx", bytes)).toThrow(GuardError);
  });

  it("rejects an absolute path", () => {
    expect(() => writeScopedFile(dir, "/etc/passwd", "pptx", bytes)).toThrow(GuardError);
  });

  it("rejects the bare '..' / '.' components", () => {
    expect(() => writeScopedFile(dir, "..", "pptx", bytes)).toThrow(GuardError);
    expect(() => writeScopedFile(dir, ".", "pptx", bytes)).toThrow(GuardError);
  });

  it("rejects a wrong/missing extension", () => {
    expect(() => writeScopedFile(dir, "deck.txt", "pptx", bytes)).toThrow(GuardError);
  });

  it("rejects writing through a pre-existing symlink that escapes the scope", () => {
    const outside = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-outside-"));
    try {
      const linkPath = join(dir, "evil.pptx");
      symlinkSync(join(outside, "target.pptx"), linkPath);
      expect(() => writeScopedFile(dir, "evil.pptx", "pptx", bytes)).toThrow(GuardError);
      expect(existsSync(join(outside, "target.pptx"))).toBe(false); // never wrote through the link
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked directory used as a traversal vector even without '..' in the name", () => {
    const outside = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-outside-"));
    try {
      mkdirSync(join(dir, "link-dir"));
      rmSync(join(dir, "link-dir"), { recursive: true });
      symlinkSync(outside, join(dir, "link-dir"));
      // A filename can't contain a separator at all, so "link-dir/x.pptx" is already rejected as a
      // bare-filename violation before any symlink is even consulted.
      expect(() => writeScopedFile(dir, "link-dir/x.pptx", "pptx", bytes)).toThrow(GuardError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
