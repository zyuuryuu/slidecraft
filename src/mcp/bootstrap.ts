/**
 * bootstrap.ts — ADR-0037 D2: the cold (once-per-session) procurement tools consolidated into ONE
 * call, so a fresh session reads its whole authoring contract in a single round trip instead of 6.
 * Each section is composed FROM THE SAME functions the legacy tools call (G.* / S.getCatalog /
 * T.listTemplates) — no second generation path (R8); tests/mcp-bootstrap.test.ts holds a deep-equal
 * agreement test per section. The legacy 6 stay registered with unchanged I/O (ADR-0008 floor:
 * no read-tool removal; they are the aliases ADR-0037 D4 keeps).
 *
 * Per-type diagram guides are deliberately NOT bundled: 12 types × ~1,900 chars ≈ 22,400 chars
 * measured (#464), while a typical deck uses ≤2 types — so bootstrap carries the TYPE MENU
 * (diagramTypes) and points at get_diagram_guide(type) for the per-type pull.
 */
import type { Session } from "./session";
import * as S from "./session";
import * as G from "./guides";
import * as T from "./templates";
import type { TemplateStore } from "./host-core";
import { GuardError, guardEnvelope } from "./guard-errors";

/** A section answers EXACTLY like its legacy tool: the value on success, the modeled
 *  { ok:false, error, code } guard envelope on a precondition failure (e.g. no project open yet —
 *  bootstrap's natural calling moment) — so one cold section failing never blanks the others, and
 *  the per-section deep-equal with the legacy tool holds in BOTH states. Unmodeled crashes still
 *  propagate to the server's fail() like any other tool. */
const section = (fn: () => unknown): unknown => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GuardError) return guardEnvelope(e);
    throw e;
  }
};

/** Compose the one-shot cold response. `resolveSession` is the server's own doc resolution
 *  (explicit docId → active → sole doc, never-silent) deferred into each doc-scoped section, so a
 *  not-yet-selected/loaded doc degrades that section to its guard envelope instead of failing the
 *  whole call. */
export function getBootstrap(resolveSession: () => Session, templates: TemplateStore | undefined, solo: boolean, scopeRoot: string | null) {
  return {
    authoringGuide: section(() => G.getAuthoringGuide(resolveSession())),
    diagramTypes: G.getDiagramTypes(),
    diagramGuides: { note: "各図タイプの構文＋JSON例は get_diagram_guide(type) で個別取得（type は diagramTypes 節から選ぶ）。全12種の同梱は実測約22,400字のため見送り（#464）" },
    templateSpecGuide: T.getTemplateSpecGuide(),
    templateCapabilities: section(() => S.getCatalog(resolveSession())),
    templates: section(() => T.listTemplates(templates, solo, scopeRoot)),
  };
}
