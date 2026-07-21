/**
 * fs-scope.ts — ADR-0035 stage 1 (output side): scoped filesystem writes for export_pptx /
 * save_project when the server is started with `--root <dir>`. Confines every write to that ONE
 * directory (resolved to its canonical, symlink-free form once at startup) — no `../` traversal,
 * no absolute-path escape, no writing THROUGH a pre-existing symlink. R2: this is the ONLY module
 * under src/mcp that touches node:fs for deck bytes — src/engine/* stays fs-free.
 *
 * Single chokepoint (ADR-0007 residual): a target filename is NFC-normalized, restricted to a bare
 * basename (no separators → no subdirectory surface to traverse), extension-allowlisted, and opened
 * with O_NOFOLLOW so an existing symlink at the target atomically fails the open (ELOOP) instead of
 * writing through it — no stat-then-write TOCTOU window on POSIX. A pre-emptive lstat check gives a
 * clearer rejection message and backstops platforms where O_NOFOLLOW is a no-op (Windows).
 */
import { closeSync, constants as fsConstants, existsSync, lstatSync, openSync, realpathSync, statSync, writeSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { GuardError } from "./guard-errors";
import { deckTitle } from "../engine/md-serializer";
import type { Session } from "./session";

/** Validate `--root` at startup: must exist and be a directory. Returns its canonical
 *  (symlink-resolved) absolute path — every later write is confined under THIS, so a symlinked
 *  scope root itself can't smuggle writes anywhere the caller didn't explicitly point --root at.
 *  Throws a plain Error (not GuardError — this runs before a Session/MCP tool exists). */
export function resolveScopeRoot(dir: string): string {
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new Error(`--root に指定されたディレクトリが見つかりません: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`--root にはディレクトリを指定してください（ファイルが指定されました）: ${dir}`);
  }
  return realpathSync(dir);
}

/** A bare filename: no path separators (posix or win32), no ".."/"." alone, not absolute. This
 *  alone removes the `../` and subdirectory-escape surface — the write target's directory is
 *  always exactly `root`. */
function isBareFilename(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !isAbsolute(name) && !name.includes("/") && !name.includes("\\") && basename(name) === name;
}

function assertScopedExt(filename: string, ext: string): void {
  if (!filename.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    throw new GuardError(`ファイル名の拡張子が不正です（.${ext} である必要があります）: ${filename}`, "scope-violation");
  }
}

export interface ScopedWrite {
  filename: string;
  absPath: string;
  /** A reference relative to the scope root, formatted as a file:// URI (ADR-0035: the JSON-RPC
   *  reply carries a REFERENCE, not bytes — the caller resolves it against the same --root it knows). */
  uri: string;
}

/** Write `bytes` under `root` (already realpath-resolved by resolveScopeRoot) as `filenameRaw`.
 *  Never-silent: every rejection throws a GuardError with code "scope-violation". */
export function writeScopedFile(root: string, filenameRaw: string, ext: string, bytes: Uint8Array): ScopedWrite {
  const filename = filenameRaw.normalize("NFC");
  if (!isBareFilename(filename)) {
    throw new GuardError(`scope 外のファイル名です（サブディレクトリ・絶対パス・"../" は不可）: ${JSON.stringify(filenameRaw)}`, "scope-violation");
  }
  assertScopedExt(filename, ext);
  const absPath = join(root, filename);
  if (existsSync(absPath) && lstatSync(absPath).isSymbolicLink()) {
    throw new GuardError(`symlink 越えは拒否されます: ${filename}`, "scope-violation");
  }
  let fd: number;
  try {
    fd = openSync(absPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ELOOP") {
      throw new GuardError(`symlink 越えは拒否されます: ${filename}`, "scope-violation");
    }
    throw e;
  }
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  return { filename, absPath, uri: `file:///${filename}` };
}

function sanitizeStem(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || "slidecraft";
}

/** ISO timestamp with filesystem-safe separators (no ":" — invalid on Windows). */
function timestampStem(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Auto-generate a scoped filename when the caller doesn't supply one: `<title-slug>-<timestamp>.<ext>`. */
export function defaultScopedFilename(title: string | undefined, ext: string): string {
  return `${sanitizeStem(title ?? "slidecraft")}-${timestampStem()}.${ext}`;
}

/** export_pptx / save_project's persist step (ADR-0035 stage 1, #299). No scope (`s.root` null, the
 *  default) → byte-identical base64 envelope (non-breaking). Scope configured (`--root`) → write
 *  under it and return a reference instead (bytes never ride the JSON-RPC channel). A `filename`
 *  supplied with no scope configured is a client error, not a silently-ignored no-op. */
export function persistScopedOrBase64(s: Session, bytes: Uint8Array, ext: "pptx" | "scft", filename: string | undefined): { dataBase64: string } | { path: string } {
  if (!s.root) {
    if (filename !== undefined) throw new GuardError("filename は --root（scope）起動時のみ指定できます（scope 未設定では base64 のみ）。", "scope-not-configured");
    return { dataBase64: Buffer.from(bytes).toString("base64") };
  }
  const name = filename ?? defaultScopedFilename(deckTitle(s.deck) ?? s.meta.templateName, ext);
  return { path: writeScopedFile(s.root, name, ext, bytes).uri };
}
