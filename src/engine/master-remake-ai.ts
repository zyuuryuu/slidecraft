/**
 * master-remake-ai.ts — Phase-0 of the AI (non-deterministic) Re-make, option C "structure mapping".
 * See docs/design/ai-remake.md.
 *
 * The AI's ONLY job is a classifier: map each SOURCE master layout to the best-fitting CANONICAL
 * layout (from BUILTIN_LAYOUTS) and, optionally, rename it to the source's own name. Because the target
 * is a clean, canonically-TYPED layout, the placeholder roles are correct BY CONSTRUCTION — this is
 * what dissolves the runtime role/layout inconsistency (ADR-0025, layout Tier1/2) at import time.
 *
 * Everything else is deterministic (harness over model, ADR-0005): theme extraction stays
 * masterToTemplateSpec; geometry/style come from the canonical layout library; and a broken/empty AI
 * response falls back to the deterministic Re-make (the built-in 30) so it is never worse.
 *
 * Pure logic (R2): no DOM / Tauri / network. The caller runs the model and passes the raw text in.
 */
import type { TemplateData } from "./template-loader";
import { buildCatalog, layoutRole, placeholderRole, type LayoutRole } from "./template-catalog";
import { BUILTIN_LAYOUTS, type LayoutDef } from "./template-layout-library";
import { masterToTemplateSpec } from "./master-remake";
import type { TemplateSpec, LogoSpec } from "./template-writer";
import { parseJsonLoose } from "./json-salvage";

// ── The canonical vocabulary the AI maps INTO ──

export interface VocabEntry {
  name: string; // exact canonical LayoutDef name (the AI must return one of these as `base`)
  role: LayoutRole; // title / section / content / columns / kpi / chart / table / compare / process / closing / …
  family: "dark" | "light";
  regions: number; // number of content body regions (helps the AI match "2-column" etc.)
}

/** The canonical layout catalog as a compact vocabulary (derived from BUILTIN_LAYOUTS). */
export function remakeVocabulary(): VocabEntry[] {
  return BUILTIN_LAYOUTS.map((l) => ({
    name: l.name,
    role: layoutRole(l.name),
    family: l.family,
    regions: l.placeholders.filter((p) => p.type === "body" && /^[1-9]$/.test(String(p.idx))).length,
  }));
}
const VOCAB_NAMES = new Set(BUILTIN_LAYOUTS.map((l) => l.name));

// ── The source master's layout inventory (the AI's INPUT) ──

export interface SourcePhSummary { idx: string; type: string; role: string; box: { x: number; y: number; w: number; h: number } }
export interface SourceLayoutSummary {
  name: string;
  role: LayoutRole; // our best deterministic guess (classifyLayout) — a hint, not authoritative
  family: "dark" | "light";
  bodyCount: number;
  hasLogo: boolean;
  phs: SourcePhSummary[];
}

const isDark = (hex: string | undefined): boolean => {
  if (!hex) return false;
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128; // simple luma
};

/** Deterministic per-layout summary of the SOURCE master — what the AI reasons over. */
export function masterToLayoutInventory(tpl: TemplateData): SourceLayoutSummary[] {
  const catalog = buildCatalog(tpl);
  const roleByName = new Map(catalog.map((e) => [e.name, { role: e.role, bodyCount: e.bodyCount } as const]));
  return tpl.layouts.map((l) => {
    const cat = roleByName.get(l.name);
    return {
      name: l.name,
      role: cat?.role ?? "other",
      family: isDark(l.background ?? tpl.masterBgColor) ? "dark" : "light",
      bodyCount: cat?.bodyCount ?? 0,
      hasLogo: (l.images?.length ?? 0) > 0,
      phs: l.placeholders.map((p) => ({ idx: p.idx, type: p.type, role: placeholderRole(p), box: { x: p.style.x, y: p.style.y, w: p.style.w, h: p.style.h } })),
    };
  });
}

// ── The prompt (option C: source inventory + vocab → base-selection mapping) ──

export function remakeSystemPrompt(inventory: SourceLayoutSummary[]): string {
  const vocab = remakeVocabulary();
  const byRole = new Map<string, string[]>();
  for (const v of vocab) (byRole.get(v.role) ?? byRole.set(v.role, []).get(v.role)!).push(`${v.name} (${v.family}, ${v.regions} body region${v.regions === 1 ? "" : "s"})`);
  const vocabList = [...byRole.entries()].map(([role, names]) => `- ${role}:\n    ${names.join("\n    ")}`).join("\n");
  const inv = inventory.map((s, i) => `${i + 1}. "${s.name}" — role≈${s.role}, ${s.family}, bodies=${s.bodyCount}, logo=${s.hasLogo}, placeholders=[${s.phs.map((p) => `${p.role}@${p.idx}`).join(", ")}]`).join("\n");
  return `You map a company's messy slide-master layouts onto a set of CLEAN canonical layouts. For EACH source layout, pick the single best-fitting canonical layout by intent + structure (role, family, number of body regions). Keep the source's name so it feels familiar.

Output ONLY one JSON object — no prose, no code fence:

{ "layouts": [ { "base": "<exact canonical name>", "rename": "<source layout name>", "reason": "<why this base, one short line>" }, ... ] }

Rules:
- "base" MUST be one of the canonical names listed below, copied EXACTLY.
- Produce one entry per source layout, in the source order. Skip a source layout only if nothing fits.
- Prefer the same role and body-region count; match dark/light family; a cover→title, a divider→section, a bullets slide→content, a 2-up→columns, a closing/summary→closing/summary.
- "reason": one short line naming the deciding cue (role, family, body-region count, or a placeholder pattern). Keep it to a dozen words.

## Canonical layouts (choose "base" from these)

${vocabList}

## Source master layouts (map each)

${inv}`;
}

// ── Defensive parse + vocabulary validation (harness) ──

export interface MappedLayout { base: string; rename?: string; reason?: string }
export type RemakeMappingParse =
  | { ok: true; layouts: MappedLayout[]; dropped: number }
  | { ok: false; error: string };

/** Parse the model's mapping. Drops any entry whose `base` isn't a real canonical name (hallucination
 *  guard). ok:false when nothing usable survives → the caller falls back to the deterministic Re-make. */
export function parseRemakeMapping(raw: string): RemakeMappingParse {
  const parsed = parseJsonLoose(raw);
  if (!parsed.ok) return { ok: false, error: `not JSON: ${parsed.error}` };
  const obj = parsed.value as { layouts?: unknown };
  if (!obj || !Array.isArray(obj.layouts)) return { ok: false, error: "no `layouts` array" };
  const layouts: MappedLayout[] = [];
  let dropped = 0;
  for (const e of obj.layouts) {
    const base = (e as { base?: unknown })?.base;
    if (typeof base !== "string" || !VOCAB_NAMES.has(base)) { dropped++; continue; }
    const rename = (e as { rename?: unknown })?.rename;
    const reason = (e as { reason?: unknown })?.reason;
    layouts.push({
      base,
      rename: typeof rename === "string" && rename.trim() ? rename.trim() : undefined,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : undefined,
    });
  }
  if (layouts.length === 0) return { ok: false, error: `all ${dropped} entries invalid (base not in vocabulary)` };
  return { ok: true, layouts, dropped };
}

/**
 * best-of-N: given several raw model responses (e.g. N sampled generations), pick the single BEST
 * one — the parse that maps the MOST source layouts, tie-broken by FEWEST hallucinated drops. Returns
 * the winning raw string (so the caller re-parses via the normal path), or null when none parse. A
 * local small model varies run-to-run; this cheaply lifts the floor without any scoring heuristic
 * beyond "covered more, hallucinated less". Deterministic (no clock/rng) — stable under resume.
 */
export function pickBestRawMapping(raws: (string | null | undefined)[]): string | null {
  let best: { raw: string; layouts: number; dropped: number } | null = null;
  for (const raw of raws) {
    if (!raw) continue;
    const p = parseRemakeMapping(raw);
    if (!p.ok) continue;
    if (!best || p.layouts.length > best.layouts || (p.layouts.length === best.layouts && p.dropped < best.dropped)) {
      best = { raw, layouts: p.layouts.length, dropped: p.dropped };
    }
  }
  return best?.raw ?? null;
}

// ── Compose the final spec (theme is deterministic; layouts are the AI-selected canonical bases) ──

/**
 * Build the LayoutDef[] for the mapping: each source layout becomes its OWN layout on the chosen
 * canonical base, named after the source (rename) — so the source's layout SET is preserved (e.g.
 * Segue 白/紺/空 → three SectionNav-geometry layouts), not collapsed to one. Geometry/placeholders
 * always come from the canonical base (the AI only picked the base). Dedup only on a genuine NAME
 * collision (LayoutDef names must be unique in the template), keeping the first.
 */
export function composeRemakeLayouts(mapping: MappedLayout[]): LayoutDef[] {
  const byName = new Map(BUILTIN_LAYOUTS.map((l) => [l.name, l] as const));
  const seenNames = new Set<string>();
  const out: LayoutDef[] = [];
  for (const m of mapping) {
    const base = byName.get(m.base);
    if (!base) continue;
    const name = m.rename?.trim() || m.base; // the layout's name = the source name, else the base name
    if (seenNames.has(name)) continue; // genuine name collision → keep the first
    seenNames.add(name);
    out.push({ ...base, name });
  }
  return out;
}

/**
 * The AI Re-make spec: deterministic THEME (masterToTemplateSpec) + the AI-selected canonical LAYOUTS.
 * A broken/empty AI response (or one whose bases all hallucinated) falls back to the deterministic
 * Re-make (theme only → built-in 30) — never worse than today. `logo` is threaded in by the caller
 * (async zip read) like the deterministic path does.
 */
export interface AiRemakeResult {
  spec: TemplateSpec;
  usedAi: boolean;
  note: string;
  /** The AI's per-source-layout decisions (base + reason), for surfacing "why" to the user. */
  mappings?: MappedLayout[];
}

export function aiRemakeSpec(
  tpl: TemplateData,
  aiRaw: string | null | undefined,
  opts: { name?: string; logo?: LogoSpec } = {},
): AiRemakeResult {
  const theme = masterToTemplateSpec(tpl, { name: opts.name });
  const base: TemplateSpec = { ...theme, ...(opts.logo ? { logo: opts.logo } : {}) };
  if (!aiRaw) return { spec: base, usedAi: false, note: "no AI response — deterministic Re-make (built-in 30)" };
  const m = parseRemakeMapping(aiRaw);
  if (!m.ok) return { spec: base, usedAi: false, note: `AI response unusable (${m.error}) — deterministic fallback` };
  const layouts = composeRemakeLayouts(m.layouts);
  if (layouts.length === 0) return { spec: base, usedAi: false, note: "no canonical layouts composed — deterministic fallback" };
  return {
    spec: { ...base, layouts },
    usedAi: true,
    note: `AI Re-make: ${layouts.length} layouts mapped (${m.dropped} dropped)`,
    mappings: m.layouts,
  };
}
