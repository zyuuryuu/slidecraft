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
