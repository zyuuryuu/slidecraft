/**
 * templates.ts — template PROVISIONING for the upstream AI (Theme 3, S2). Lets an AI that has no
 * .pptx bytes acquire one: create_template builds a fresh template from an AI-authored TemplateSpec,
 * and get_template_spec_guide teaches that spec's format. Both are session-INDEPENDENT (they mint a
 * template, they don't touch the open deck) and both work in stdio + host.
 *
 * harness-over-model (ADR-0014): the AI only PROPOSES the spec (name + fonts + a 9-colour palette);
 * the deterministic harness normalises it, fills gaps from the MIDNIGHT preset, contrast-guards the
 * text/background pairs, and writes the PPTX. Pure MCP-layer wiring over src/engine. See
 * docs/design/mcp-brushup.md §G.
 */
import { parseTemplateSpecResponse, templateSpecSystemPrompt } from "../engine/template-spec-prompts";
import { writeTemplate, MIDNIGHT_PALETTE } from "../engine/template-writer";
import { loadTemplate } from "../engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../engine/template-catalog";
import { listScopedTemplates, readScopedTemplate, SCOPED_TEMPLATES_SUBDIR } from "./fs-scope";
import { GuardError } from "./guard-errors";
import type { TemplateStore, TemplateInfo } from "./host-core";

/** Build a template-only PPTX from an AI-authored TemplateSpec JSON (name + fonts + 9-colour palette;
 *  layouts default to the canonical 30). Missing/invalid fields fall back to the MIDNIGHT preset and
 *  low-contrast text pairs are deterministically fixed — so an EMPTY spec yields a usable starter,
 *  which is how a bare stdio AI bootstraps (create_template → hand templateBase64 to new_project). The
 *  written template is re-read through the normal loader to report `health`, and `notices` surfaces
 *  every deterministic fix (#12/#13 spirit). */
export async function createTemplate(specJson?: string) {
  const parse = parseTemplateSpecResponse(specJson && specJson.trim() ? specJson : "{}");
  if (!parse.ok) return { ok: false as const, error: parse.error };
  const bytes = await writeTemplate(parse.spec);
  const health = assessTemplateHealth(buildCatalog(await loadTemplate(bytes)));
  // Fail-closed: never hand back a structurally-unusable template (unreachable with the default 30
  // layouts, but load-bearing if a caller ever supplies TemplateSpec.layouts). Mirrors intake reject.
  if (health.status === "rejected") {
    const reason = health.findings.filter((f) => f.level === "block").map((f) => f.message).join(" ");
    return { ok: false as const, error: `生成したテンプレートが使用できません: ${reason}` };
  }
  return { ok: true as const, templateBase64: Buffer.from(bytes).toString("base64"), health, notices: parse.notices };
}

/** L3 guide — how to author the TemplateSpec create_template consumes, plus the MIDNIGHT preset values
 *  as a concrete starting palette to tweak (preset + override). Paired with create_template. */
export function getTemplateSpecGuide() {
  // Copy the shared MIDNIGHT_PALETTE const (codebase convention) so a caller can't alias/poison the
  // global default that every gap-filled createTemplate() falls back to.
  return { guide: templateSpecSystemPrompt(), presets: { midnight: { ...MIDNIGHT_PALETTE } } };
}

/** #298: the SOLO (no GUI, no `register_templates`) fallback for `list_templates`/`use_template` —
 *  so a bare stdio AI's natural first move ("list → pick → start") closes instead of hitting
 *  `template-registry-unavailable`. Built-in ids mirror the presets `get_template_spec_guide`
 *  already documents (today: MIDNIGHT). Minting reuses `createTemplate` (R8: one generation path,
 *  never a second one for the solo case). */
export interface BuiltinTemplateInfo {
  id: string;
  name: string;
  builtin: true;
}
export const BUILTIN_TEMPLATES: BuiltinTemplateInfo[] = [{ id: "midnight", name: "Midnight", builtin: true }];

/** The built-in template's PPTX bytes (or undefined for an unknown id), built through the exact same
 *  contrast-guard + MIDNIGHT-fallback harness as an explicit `create_template` call. */
export async function createBuiltinTemplate(id: string): Promise<Uint8Array | undefined> {
  if (!BUILTIN_TEMPLATES.some((t) => t.id === id)) return undefined;
  const created = await createTemplate(); // no spec → MIDNIGHT preset (never "rejected" with the default 30 layouts)
  if (!created.ok) throw new Error(created.error);
  return new Uint8Array(Buffer.from(created.templateBase64, "base64"));
}

// ── #324 / proposal #1: scope-directory template discovery ── a GUI-less stdio client (Cursor, Claude
// Code CLI) has no register_templates push, so list_templates/use_template used to see ONLY the
// built-ins. When the server runs with `--root`, `<root>/templates/*.{pptx,potx}` is reflected into the
// registry too, so "list → pick → start" reaches the user's OWN templates without a GUI. The GUI's
// register_templates registry (collab) and this scope scan are independent paths that never coexist:
// --root only takes effect in SOLO mode (cli.ts ignores it while forwarding to a live host).

/** The `file:` id prefix a scope-discovered template carries — use_template routes on it to read the
 *  named file from `<root>/templates/` instead of minting a built-in. */
export const FILE_TEMPLATE_ID_PREFIX = "file:";

/** One `list_templates` row for a scope-discovered template. `path` mirrors the bare filename
 *  new_project(templatePath) already accepts, so a client can cross-reference the two entry points. */
export interface ScopedTemplateInfo {
  id: string;
  name: string;
  builtin: false;
  path: string;
}

const stripTemplateExt = (filename: string): string => filename.replace(/\.(pptx|potx)$/i, "");

/** Map bare filenames discovered under `<root>/templates/` to list_templates rows. Pure shaping — the
 *  fs readdir lives in fs-scope.listScopedTemplates. */
export function scopedTemplateInfos(filenames: string[]): ScopedTemplateInfo[] {
  return filenames.map((f) => ({ id: `${FILE_TEMPLATE_ID_PREFIX}${f}`, name: stripTemplateExt(f), builtin: false as const, path: f }));
}

/** The single template-registry-unavailable GuardError (R8: one message/code, shared by server.ts's
 *  requireTemplates and listTemplates below, not re-typed in two places). */
export function templateRegistryUnavailable(): GuardError {
  return new GuardError("テンプレレジストリが利用できません。create_template でテンプレートを生成するか、new_project に .pptx を渡してください。", "template-registry-unavailable");
}

export interface TemplateListResult {
  templates: (TemplateInfo | BuiltinTemplateInfo | ScopedTemplateInfo)[];
  note?: string;
}

/** Resolve `list_templates`: the GUI registry when one is pushed (register_templates); else, in solo
 *  mode, the built-in presets PLUS any `<root>/templates/*.{pptx,potx}` when `--root` is set; else
 *  (no registry, not solo) never-silent template-registry-unavailable. `note` guides a solo client
 *  that would otherwise see only built-ins toward surfacing its own templates (proposal #2). */
export function listTemplates(registry: TemplateStore | undefined, solo: boolean, scopeRoot: string | null): TemplateListResult {
  if (registry) return { templates: registry.list() };
  if (!solo) throw templateRegistryUnavailable();
  const scoped = scopeRoot ? scopedTemplateInfos(listScopedTemplates(scopeRoot)) : [];
  const templates = [...BUILTIN_TEMPLATES, ...scoped];
  return scoped.length ? { templates } : { templates, note: soloTemplateNote(scopeRoot) };
}

/** Proposal #2: when a solo client would see only built-ins, tell it HOW to surface its own
 *  templates (the discovery is real but silent otherwise). */
function soloTemplateNote(scopeRoot: string | null): string {
  return scopeRoot
    ? `カスタムテンプレートは --root 配下の \`${SCOPED_TEMPLATES_SUBDIR}/\` に .pptx/.potx を置くと list_templates に現れます。`
    : `GUI 未接続のため builtin のみです。--root <dir> 起動＋その配下の \`${SCOPED_TEMPLATES_SUBDIR}/\` に .pptx/.potx を置くと一覧に現れます（または new_project(templatePath) で直接指定）。`;
}

/** Resolve a solo (GUI-less) use_template id to template bytes + a display name. A `file:` id names a
 *  discovered template under `<root>/templates/` (needs `--root`); anything else must be a built-in
 *  preset minted through the create_template harness (R8: one generation path). Never-silent: an
 *  unknown/absent id throws a GuardError the tool surfaces as { ok:false, code }. */
export async function resolveSoloTemplate(id: string, scopeRoot: string | null): Promise<{ bytes: Uint8Array; name: string }> {
  if (id.startsWith(FILE_TEMPLATE_ID_PREFIX)) {
    if (!scopeRoot) throw new GuardError(`file: テンプレートは --root（scope）起動時のみ使用できます: ${id}`, "scope-not-configured");
    const filename = id.slice(FILE_TEMPLATE_ID_PREFIX.length);
    return { bytes: readScopedTemplate(scopeRoot, filename), name: stripTemplateExt(filename) }; // scope-violation / scope-file-not-found (never-silent)
  }
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  const bytes = builtin && (await createBuiltinTemplate(builtin.id));
  if (!bytes) throw new GuardError(`テンプレが見つかりません: ${id}（list_templates で id を確認）`, "unknown-template");
  return { bytes, name: builtin!.name };
}
