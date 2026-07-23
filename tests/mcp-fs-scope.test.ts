// fs-scope.ts — ADR-0035 stage 1 (output-side scoped fs). Guards the invariants: writes stay
// confined to the scope root (never-silent on traversal/absolute/symlink escape), and the happy
// path produces a real, readable file + an ABSOLUTE file:// reference (not a bare
// `file:///<filename>`, which RFC 8089/`new URL()` parse as the absolute path "/<filename>" — a
// standards-conformant client would look at the fs root instead of the scope root, #299 follow-up).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScopeRoot, writeScopedFile, readScopedFile, readScopedTemplate, listScopedTemplates, SCOPED_TEMPLATES_SUBDIR, acquireScopedOrBase64, defaultScopedFilename } from "../src/mcp/fs-scope";
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
  it("writes bytes under root and returns an ABSOLUTE file:// URI that resolves to the real file", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]); // PK.. zip magic
    const res = writeScopedFile(dir, "deck.pptx", "pptx", bytes);
    const absPath = join(dir, "deck.pptx");
    expect(res.absPath).toBe(absPath);
    expect(res.uri).toBe(`file://${absPath}`);
    // Standards-conformant resolution (new URL().pathname / fileURLToPath) must land on the SAME
    // file that was actually written — not a bare-root misread of "/deck.pptx".
    expect(new URL(res.uri).pathname).toBe(absPath);
    expect(fileURLToPath(res.uri)).toBe(absPath);
    expect(readFileSync(fileURLToPath(res.uri))).toEqual(Buffer.from(bytes));
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

describe("readScopedFile — happy path (ADR-0035 stage 3, #299)", () => {
  it("reads back bytes written by writeScopedFile — write→read round-trip", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
    writeScopedFile(dir, "deck.pptx", "pptx", bytes);
    expect(readScopedFile(dir, "deck.pptx", "pptx")).toEqual(bytes);
  });

  it("NFC-normalizes the filename the same way writeScopedFile does", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const composed = "デッキ.pptx"; // デッキ.pptx, already NFC
    writeScopedFile(dir, composed, "pptx", bytes);
    const decomposed = composed.normalize("NFD");
    expect(readScopedFile(dir, decomposed, "pptx")).toEqual(bytes);
  });
});

describe("readScopedFile — never-silent rejections (ADR-0035 invariants)", () => {
  it("rejects a missing file with code scope-file-not-found (not scope-violation)", () => {
    expect(() => readScopedFile(dir, "nope.pptx", "pptx")).toThrow(GuardError);
    try {
      readScopedFile(dir, "nope.pptx", "pptx");
    } catch (e) {
      expect((e as GuardError).code).toBe("scope-file-not-found");
    }
  });

  it("rejects ../ traversal, a nested path, an absolute path, and a bad extension — same as write", () => {
    writeFileSync(join(dir, "real.pptx"), "x"); // exists, but every path below is malformed anyway
    expect(() => readScopedFile(dir, "../real.pptx", "pptx")).toThrow(GuardError);
    expect(() => readScopedFile(dir, "sub/real.pptx", "pptx")).toThrow(GuardError);
    expect(() => readScopedFile(dir, "/etc/passwd", "pptx")).toThrow(GuardError);
    expect(() => readScopedFile(dir, "real.txt", "pptx")).toThrow(GuardError);
  });

  it("rejects reading THROUGH a symlink that points outside the scope — no information leak", () => {
    const outside = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-outside-"));
    try {
      const secretPath = join(outside, "secret.pptx");
      writeFileSync(secretPath, "top-secret-bytes-outside-scope");
      symlinkSync(secretPath, join(dir, "innocuous.pptx"));
      let caught: unknown;
      try {
        readScopedFile(dir, "innocuous.pptx", "pptx");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(GuardError);
      expect((caught as GuardError).code).toBe("scope-violation");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects reading through a symlink even when it points INSIDE the scope", () => {
    writeFileSync(join(dir, "real.pptx"), "real-bytes");
    symlinkSync(join(dir, "real.pptx"), join(dir, "alias.pptx"));
    expect(() => readScopedFile(dir, "alias.pptx", "pptx")).toThrow(GuardError);
  });
});

// #324 / proposal #1: <root>/templates/*.{pptx,potx} discovery for a GUI-less stdio client. The read
// half reuses the exact no-follow hardening as readScopedFile; the list half never follows a symlink.
describe("listScopedTemplates — <root>/templates/ discovery", () => {
  function templatesDir(): string {
    const d = join(dir, SCOPED_TEMPLATES_SUBDIR);
    mkdirSync(d);
    return d;
  }

  it("returns bare *.pptx / *.potx names, sorted, and ignores other extensions", () => {
    const t = templatesDir();
    writeFileSync(join(t, "b-report.potx"), "x");
    writeFileSync(join(t, "a-report.pptx"), "x");
    writeFileSync(join(t, "notes.txt"), "x"); // non-template ext ignored
    writeFileSync(join(t, "deck.scft"), "x"); // .scft is a deck, not a template — ignored
    expect(listScopedTemplates(dir)).toEqual(["a-report.pptx", "b-report.potx"]);
  });

  it("returns [] when there is no templates/ sub-directory (a legitimate empty, never a throw)", () => {
    expect(listScopedTemplates(dir)).toEqual([]);
  });

  it("skips sub-directories inside templates/", () => {
    const t = templatesDir();
    mkdirSync(join(t, "nested.pptx")); // a directory that merely looks like a template
    writeFileSync(join(t, "real.pptx"), "x");
    expect(listScopedTemplates(dir)).toEqual(["real.pptx"]);
  });

  it("never lists a symlink (even one pointing at a real template)", () => {
    const t = templatesDir();
    const outside = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-outside-"));
    try {
      writeFileSync(join(outside, "secret.pptx"), "x");
      symlinkSync(join(outside, "secret.pptx"), join(t, "linked.pptx"));
      writeFileSync(join(t, "real.pptx"), "x");
      expect(listScopedTemplates(dir)).toEqual(["real.pptx"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("readScopedTemplate — reads under templates/ with the same hardening as readScopedFile", () => {
  function templatesDir(): string {
    const d = join(dir, SCOPED_TEMPLATES_SUBDIR);
    mkdirSync(d);
    return d;
  }

  it("reads a .pptx and a .potx placed under templates/", () => {
    const t = templatesDir();
    writeFileSync(join(t, "a.pptx"), Buffer.from([1, 2, 3]));
    writeFileSync(join(t, "b.potx"), Buffer.from([4, 5, 6]));
    expect(readScopedTemplate(dir, "a.pptx")).toEqual(new Uint8Array([1, 2, 3]));
    expect(readScopedTemplate(dir, "b.potx")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects a missing template with scope-file-not-found", () => {
    templatesDir();
    try {
      readScopedTemplate(dir, "nope.pptx");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GuardError);
      expect((e as GuardError).code).toBe("scope-file-not-found");
    }
  });

  it("rejects ../ traversal, an absolute path, and a wrong extension (scope-violation)", () => {
    templatesDir();
    for (const bad of ["../deck.pptx", "sub/deck.pptx", "/etc/passwd", "deck.txt", "deck.scft"]) {
      try {
        readScopedTemplate(dir, bad);
        throw new Error(`should have rejected ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(GuardError);
        expect((e as GuardError).code).toBe("scope-violation");
      }
    }
  });

  it("never reads THROUGH a symlink under templates/ — no information leak (scope-violation)", () => {
    const t = templatesDir();
    const outside = mkdtempSync(join(tmpdir(), "slidecraft-fs-scope-outside-"));
    try {
      writeFileSync(join(outside, "secret.pptx"), "top-secret-outside-scope");
      symlinkSync(join(outside, "secret.pptx"), join(t, "innocuous.pptx"));
      try {
        readScopedTemplate(dir, "innocuous.pptx");
        throw new Error("should have rejected the symlink");
      } catch (e) {
        expect(e).toBeInstanceOf(GuardError);
        expect((e as GuardError).code).toBe("scope-violation");
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("acquireScopedOrBase64 — the open_project/new_project acquire step", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");

  it("no scope (root:null): base64 works, path is scope-not-configured", () => {
    expect(acquireScopedOrBase64(null, b64("hello"), undefined, "pptx")).toEqual(new TextEncoder().encode("hello"));
    expect(() => acquireScopedOrBase64(null, undefined, "deck.pptx", "pptx")).toThrow(GuardError);
    try {
      acquireScopedOrBase64(null, undefined, "deck.pptx", "pptx");
    } catch (e) {
      expect((e as GuardError).code).toBe("scope-not-configured");
    }
  });

  it("scope configured: path reads the real scoped file", () => {
    writeScopedFile(dir, "deck.pptx", "pptx", new Uint8Array([7, 7, 7]));
    expect(acquireScopedOrBase64(dir, undefined, "deck.pptx", "pptx")).toEqual(new Uint8Array([7, 7, 7]));
  });

  it("scope configured: base64 still works (not scope-only)", () => {
    expect(acquireScopedOrBase64(dir, b64("hi"), undefined, "pptx")).toEqual(new TextEncoder().encode("hi"));
  });

  it("both dataBase64 and path given — ambiguous-input, never a silent pick", () => {
    expect(() => acquireScopedOrBase64(dir, b64("x"), "deck.pptx", "pptx")).toThrow(GuardError);
    try {
      acquireScopedOrBase64(dir, b64("x"), "deck.pptx", "pptx");
    } catch (e) {
      expect((e as GuardError).code).toBe("ambiguous-input");
    }
  });

  it("neither given — missing-input", () => {
    expect(() => acquireScopedOrBase64(dir, undefined, undefined, "pptx")).toThrow(GuardError);
    try {
      acquireScopedOrBase64(dir, undefined, undefined, "pptx");
    } catch (e) {
      expect((e as GuardError).code).toBe("missing-input");
    }
  });

  it("path traversal still rejected end-to-end through acquireScopedOrBase64", () => {
    expect(() => acquireScopedOrBase64(dir, undefined, "../escape.pptx", "pptx")).toThrow(GuardError);
    try {
      acquireScopedOrBase64(dir, undefined, "../escape.pptx", "pptx");
    } catch (e) {
      expect((e as GuardError).code).toBe("scope-violation");
    }
  });
});
