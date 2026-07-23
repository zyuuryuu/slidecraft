/**
 * fs-scope.ts — ADR-0035: scoped filesystem I/O for the MCP tools when the server is started with
 * `--root <dir>`. Confines every read/write to that ONE directory (resolved to its canonical,
 * symlink-free form once at startup) — no `../` traversal, no absolute-path escape, no reading/
 * writing THROUGH a pre-existing symlink. R2: this is the ONLY module under src/mcp that touches
 * node:fs for deck bytes — src/engine/* stays fs-free.
 *
 * Single chokepoint (ADR-0007 residual): a target filename is NFC-normalized, restricted to a bare
 * basename (no separators → no subdirectory surface to traverse), extension-allowlisted, and opened
 * with O_NOFOLLOW so an existing symlink at the target atomically fails the open (ELOOP) instead of
 * being written through / read through — no stat-then-open TOCTOU window on POSIX. A pre-emptive
 * lstat check gives a clearer rejection message and backstops platforms where O_NOFOLLOW is a no-op
 * (Windows). Stage 1 (output, #299/PR #304-305) added the write half; stage 3 (input, #299) below
 * adds the symmetric read half for open_project/new_project.
 */
import { closeSync, constants as fsConstants, existsSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
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
  /** The ABSOLUTE file:// URI for `absPath` (`pathToFileURL(absPath).href` — never a bare
   *  `file:///${filename}`, which RFC 8089 parses as the absolute path "/${filename}" and misleads
   *  any standards-conformant client, e.g. `new URL(uri).pathname`, into looking at the fs root
   *  instead of the scope root. `root` came from the caller's OWN `--root`, so echoing its absolute
   *  form back is not a leak (ADR-0035 follow-up, #299). */
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
  return { filename, absPath, uri: pathToFileURL(absPath).href };
}

/** Read a file back from under `root` (already realpath-resolved by resolveScopeRoot) by bare
 *  `filenameRaw`. Symmetric hardening to writeScopedFile — same bare-name/extension checks, plus a
 *  read-specific concern: a symlink at the target (pointing anywhere, in- or out-of-scope) is REJECTED
 *  outright rather than followed, so scope can never be used to read arbitrary files by planting a
 *  link (`lstat` first — distinguishes "missing" from "symlink" precisely — then O_NOFOLLOW open as
 *  the atomic POSIX backstop against a TOCTOU swap). Never-silent: "scope-violation" for a bad/escaping
 *  name, "scope-file-not-found" for a genuinely absent target. */
export function readScopedFile(root: string, filenameRaw: string, ext: string): Uint8Array {
  const filename = filenameRaw.normalize("NFC");
  if (!isBareFilename(filename)) {
    throw new GuardError(`scope 外のファイル名です（サブディレクトリ・絶対パス・"../" は不可）: ${JSON.stringify(filenameRaw)}`, "scope-violation");
  }
  assertScopedExt(filename, ext);
  return readNoFollow(join(root, filename), filename);
}

/** The read core shared by readScopedFile and readScopedTemplate (R8: one no-follow read path, not
 *  two). `absPath` is already scope-joined and `filename` already bare/extension-validated by the
 *  caller. A symlink at the target (in- or out-of-scope) is REJECTED rather than followed — lstat
 *  first for a precise "missing vs symlink" message, then O_NOFOLLOW open as the atomic POSIX
 *  backstop against a TOCTOU swap. Never-silent: "scope-violation" / "scope-file-not-found". */
function readNoFollow(absPath: string, filename: string): Uint8Array {
  let st;
  try {
    st = lstatSync(absPath);
  } catch {
    throw new GuardError(`scope 内にファイルが見つかりません: ${filename}`, "scope-file-not-found");
  }
  if (st.isSymbolicLink()) {
    throw new GuardError(`symlink 越えは拒否されます（読み取り不可）: ${filename}`, "scope-violation");
  }
  let fd: number;
  try {
    fd = openSync(absPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new GuardError(`symlink 越えは拒否されます（読み取り不可）: ${filename}`, "scope-violation");
    if (code === "ENOENT") throw new GuardError(`scope 内にファイルが見つかりません: ${filename}`, "scope-file-not-found");
    throw e;
  }
  try {
    return new Uint8Array(readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

/** The FIXED sub-directory under `--root` that holds AI-discoverable templates (#324 / proposal #1):
 *  `list_templates` reflects `<root>/templates/*.{pptx,potx}` so a GUI-less stdio client (Cursor,
 *  Claude Code CLI) can pick its OWN templates without the GUI's register_templates. A LITERAL name,
 *  never caller-controlled, so it adds no traversal surface — only the filenames WITHIN it are user
 *  input, and those stay bare-name + extension-allowlisted + O_NOFOLLOW like every other scoped read. */
export const SCOPED_TEMPLATES_SUBDIR = "templates";
/** Templates carry .pptx OR .potx (both are the same OOXML package; .potx is the PowerPoint template
 *  content-type). Decks written back to the scope are .pptx/.scft directly under `<root>`, so the
 *  dedicated sub-directory keeps an exported deck from masquerading as a template. */
const TEMPLATE_EXTS = ["pptx", "potx"] as const;

function hasTemplateExt(filename: string): boolean {
  return TEMPLATE_EXTS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`));
}

/** Discover bare `*.pptx` / `*.potx` filenames under `<root>/templates/`. Symlinks (Dirent.isFile()
 *  is false for a link), sub-directories, and non-allowlisted extensions are skipped; the read half
 *  (readScopedTemplate) re-rejects a symlink via O_NOFOLLOW even if one slips the listing. A missing
 *  `templates/` directory is a legitimate EMPTY (returns []), never an error. Sorted for a stable
 *  list_templates order. */
export function listScopedTemplates(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(join(root, SCOPED_TEMPLATES_SUBDIR), { withFileTypes: true });
  } catch {
    return []; // no templates/ sub-directory → nothing to discover
  }
  return entries
    .filter((e) => e.isFile()) // excludes sub-directories AND symlinks (a link's Dirent.isFile() is false)
    .map((e) => e.name.normalize("NFC"))
    .filter((name) => isBareFilename(name) && hasTemplateExt(name))
    .sort();
}

/** Read a discovered template's bytes from `<root>/templates/<filename>`. Symmetric hardening to
 *  readScopedFile (bare name, symlink rejected, O_NOFOLLOW) but with the .pptx/.potx allowlist and the
 *  templates/ sub-directory. Never-silent: "scope-violation" for a bad/escaping name or a symlink,
 *  "scope-file-not-found" for an absent target. */
export function readScopedTemplate(root: string, filenameRaw: string): Uint8Array {
  const filename = filenameRaw.normalize("NFC");
  if (!isBareFilename(filename)) {
    throw new GuardError(`scope 外のテンプレート名です（サブディレクトリ・絶対パス・"../" は不可）: ${JSON.stringify(filenameRaw)}`, "scope-violation");
  }
  if (!hasTemplateExt(filename)) {
    throw new GuardError(`テンプレートの拡張子が不正です（.pptx / .potx のいずれか）: ${filename}`, "scope-violation");
  }
  return readNoFollow(join(root, SCOPED_TEMPLATES_SUBDIR, filename), filename);
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

/** open_project / new_project's acquire step (ADR-0035 stage 3, #299) — symmetric to
 *  persistScopedOrBase64. `dataBase64` and `path` are MUTUALLY EXCLUSIVE (never-silent
 *  "ambiguous-input" if both, "missing-input" if neither) — there is no default precedence to
 *  silently pick between them. `path` (a bare filename under the scope) is only valid when the
 *  server has a `--root` scope configured; base64 stays valid unconditionally (the byte-identical
 *  default). Called BEFORE a Session exists — takes the server's scope root directly, not `s.root`. */
export function acquireScopedOrBase64(root: string | null, dataBase64: string | undefined, path: string | undefined, ext: "pptx" | "scft"): Uint8Array {
  if (dataBase64 !== undefined && path !== undefined) {
    throw new GuardError("dataBase64 と path は同時に指定できません（どちらか一方）。", "ambiguous-input");
  }
  if (path !== undefined) {
    if (!root) throw new GuardError("path は --root（scope）起動時のみ指定できます（scope 未設定では dataBase64 のみ）。", "scope-not-configured");
    return readScopedFile(root, path, ext);
  }
  if (dataBase64 === undefined) {
    throw new GuardError("dataBase64 または path のいずれかが必要です。", "missing-input");
  }
  return new Uint8Array(Buffer.from(dataBase64, "base64"));
}
