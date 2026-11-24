/**
 * mixed-ops-reject-764.test.ts — #764: an ops array that MIXES op families (e.g. setCell = data with
 * setField = field) is rejected, not rewritten into the slide body as the array's text.
 *
 * Before #764 such an array matched no route and fell to the full-Markdown path ("fallback"), so the JSON
 * string became the slide's text. Ruling (Issue #764, fix 1): an array that PARSES but names ops of 2+
 * families → route "rejected", slide unchanged, the notice names the families. One judge (R8) —
 * mixedOpsNotice in slide-edit-route.ts — is used by every door (GUI routeSlideEdit, refine/batch
 * routeOpsReply, MCP set_slide_markdown); the MCP returns it as {ok:false, code:"invalid-argument"}.
 * A string that does NOT parse as an array keeps the Markdown path (a ```json block in a body is legit).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as S from "../src/mcp/session";
import * as E from "../src/mcp/slide-edit";
import * as G from "../src/mcp/guides";
import { buildServer } from "../src/mcp/server";
import type { MetricsRecorder } from "../src/mcp/metrics-sink";
import type { MetricsRecord } from "../src/mcp/metrics";
import { GuardError } from "../src/mcp/guard-errors";
import { routeSlideEdit, routeOpsReply, previewRoutedEdit, editNoticeOf, mixedOpsNotice } from "../src/engine/slide-edit-route";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { autoSelectLayout, loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { batchEditDeck } from "../src/engine/refine";
import type { SlideIR } from "../src/engine/slide-schema";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

const DECK = [
  "# 表紙",
  "# 中身\n\n- 一\n- 二\n- 三",
  "# 表\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |",
  "# 図\n\n- 説明\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: 受付\n  - id: b\n    label: 処理\nedges:\n  - from: a\n    to: b\n```",
].join("\n\n---\n\n");
const bodyOf = (sl: SlideIR) => sl.placeholders.find((p) => p.idx !== "0" && p.idx !== "15")!.idx;

async function twin() {
  const mk = async () => { const s = S.createSession(null); await S.newProject(s, templateBytes, DECK); return s; };
  return [await mk(), await mk()] as const;
}

// [name, slide index, ops, the "op（family）" fragments the notice must name]
const MIXED: Array<[string, number, (sl: SlideIR) => unknown[], string[]]> = [
  ["setCell (data) + setField (field) — the #764 repro", 2,
    () => [{ op: "setCell", row: 1, col: 1, text: "120" }, { op: "setField", idx: "0", text: "x" }], ["setCell（data）", "setField（field）"]],
  ["diagram + field", 3, (sl) => [{ op: "nodeUpdate", id: "a", label: "窓口" }, { op: "setField", idx: bodyOf(sl), text: "x" }], ["nodeUpdate（diagram）", "setField（field）"]],
  ["diagram + design (no fallback notice before #764 — silently became the body)", 3,
    () => [{ op: "setDirection", direction: "LR" }, { op: "relayout", direction: "LR" }], ["setDirection（diagram）", "relayout（design）"]],
  ["three families: each named once, by its first op", 3,
    (sl) => [{ op: "setCard", index: 0, value: "1" }, { op: "setCell", row: 0, col: 0, text: "y" }, { op: "setField", idx: bodyOf(sl), text: "x" }, { op: "emphasize", nodeId: "a" }],
    ["setCard（data）", "setField（field）", "emphasize（design）"]],
];

describe("#764 engine: mixed op families → route 'rejected' (slide unchanged, families named)", () => {
  for (const [name, i, ops, frags] of MIXED) {
    it(name, async () => {
      const [s] = await twin();
      const old = s.deck!.slides[i];
      const raw = JSON.stringify(ops(old));
      const r = routeSlideEdit(old, raw);
      expect(r.route).toBe("rejected");
      expect(r.slide).toBeNull();
      expect(r.skipped).toBe(0);
      expect(r.notices).toEqual([mixedOpsNotice(raw)]);
      expect(r.warnings).toEqual(r.notices);
      for (const f of frags) expect(r.notices[0], f).toContain(f);
      expect(r.notices[0]).toContain("op の系統が混在");
      // GUI apply: the banner shows the notice; nothing is committed (slide null).
      expect(editNoticeOf(r)).toBe(r.notices[0]);
      // refine/batch door routes the same reply the same way.
      expect(routeOpsReply(old, raw)).toEqual(r);
    });
  }
  it("the #764 repro notice names the families in order of first appearance", () => {
    const raw = JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }, { op: "setField", idx: "1", text: "x" }]);
    expect(mixedOpsNotice(raw)).toContain("op の系統が混在: setCell（data）と setField（field）");
  });
  it("a ```json-fenced mixed array is rejected the same way (bareArray accepts the fence)", () => {
    const old = parseMd("# 中身\n\n- 一").slides[0];
    const raw = "```json\n" + JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "1" }, { op: "setField", idx: "1", text: "x" }]) + "\n```";
    expect(routeSlideEdit(old, raw).route).toBe("rejected");
  });
  it("GUI review (previewRoutedEdit): the slide as it is (no change) + the notice as the warning", () => {
    const old = parseMd("# 中身\n\n- 一\n- 二").slides[0];
    const raw = JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "1" }, { op: "setField", idx: "1", text: "x" }]);
    const r = routeSlideEdit(old, raw);
    const afterMd = serializeMd({ slides: [{ ...old, layout: autoSelectLayout(old, 1, 3) }] });
    expect(previewRoutedEdit(old, raw, r, { index: 1, total: 3 })).toEqual({ afterMd, warnings: r.notices });
  });
});

describe("#764 invariant: only a PARSEABLE mixed array is rejected; everything else keeps its pre-#764 route", () => {
  const TEXT = parseMd("# 中身\n\n- 一\n- 二\n- 三").slides[0];
  const body = bodyOf(TEXT);
  it("a string that does not parse as an array keeps the Markdown path (route 'markdown', never rejected)", () => {
    for (const raw of [
      "[ここは JSON ではない]",
      "```json\n{ \"op\": \"setCell\" }\n```",
      "# 中身\n\n```json\n[{\"op\":\"setCell\"},{\"op\":\"setField\"}]\n```\n\n- 本文に JSON を書く正当な用途",
    ]) {
      expect(mixedOpsNotice(raw), raw).toBeNull();
      expect(routeSlideEdit(TEXT, raw).route, raw).toBe("markdown");
    }
  });
  it("a single-family malformed array keeps the pre-#764 fallback (Markdown + notice), not reject", () => {
    for (const raw of [
      JSON.stringify([{ op: "setField", idx: body }]),
      JSON.stringify([{ op: "setCell", row: -1, col: 1, text: "x" }]),
      JSON.stringify([{ op: "setField", idx: body }, { op: "notAnOp" }]), // an unknown op name is no family
    ]) {
      expect(mixedOpsNotice(raw), raw).toBeNull();
      expect(routeSlideEdit(TEXT, raw).route, raw).toBe("fallback");
    }
  });
  it("a bare array no family claims keeps the Markdown path", () => {
    expect(mixedOpsNotice("[1, 2]")).toBeNull();
    expect(routeSlideEdit(TEXT, "[1, 2]").route).toBe("markdown");
  });
  it("'fallback' arises only from a parseable single-family malformed array — a mixed one is never fallback", () => {
    const mixed = JSON.stringify([{ op: "setField", idx: body }, { op: "setCell", row: 1, col: 1, text: "x" }]); // malformed AND mixed
    expect(routeSlideEdit(TEXT, mixed).route).toBe("rejected");
  });
});

describe("#764 MCP ≡ GUI: set_slide_markdown rejects a mixed array with the GUI's notice, deck untouched", () => {
  for (const [name, i, ops] of MIXED) {
    it(name, async () => {
      const [s, md] = await twin();
      const old = s.deck!.slides[i];
      const raw = JSON.stringify(ops(old));
      const gui = routeSlideEdit(old, raw);
      let err: unknown;
      try { E.applySlideEdit(s, i, raw); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(GuardError);
      expect((err as GuardError).code).toBe("invalid-argument");
      expect((err as GuardError).message).toBe(gui.notices[0]);
      expect(s.deck).toEqual(md.deck);
      expect(s.dirty).toBe(md.dirty);
    });
  }

  it("through the envelope: {ok:false, code:'invalid-argument', error = notice}; rev unchanged; call log = reject/route 'rejected'", async () => {
    const lines: string[] = [];
    let t = Date.parse("2026-11-24T00:00:00.000Z");
    const metrics: MetricsRecorder = { now: () => (t += 5), write: (l) => lines.push(l) };
    const server = buildServer(S.createSession(null), { metrics });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: "test", version: "1.0.0" });
    await c.connect(ct);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(((await c.callTool({ name, arguments: args })) as unknown as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;
    await call("new_project", { templateBase64: templateBytes.toString("base64"), markdown: DECK });
    const before = await call("get_slide_markdown", { index: 2 });
    const raw = JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }, { op: "setField", idx: "1", text: "x" }]);
    lines.length = 0;
    const r = await call("set_slide_markdown", { index: 2, markdown: raw });
    expect(r).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(r.error).toBe(mixedOpsNotice(raw));
    expect(await call("get_slide_markdown", { index: 2 })).toEqual(before);
    const rec = JSON.parse(lines[0]) as MetricsRecord;
    expect(rec).toMatchObject({ tool: "set_slide_markdown", outcome: "reject", code: "invalid-argument", route: "rejected", skipped: 0 });
    expect(lines[0]).not.toContain("120"); // the log never carries the payload
  });
});

describe("#764 batch edit: a mixed reply is not applied (recorded unapplied with the notice)", () => {
  it("batchEditDeck: no change, route record 'rejected' applied:false + notice (was: the JSON became the body)", async () => {
    const tpl = await loadTemplate(templateBytes);
    const catalog = buildCatalog(tpl);
    const deck = parseMd(DECK, catalog);
    const raw = JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }, { op: "setField", idx: "1", text: "x" }]);
    const res = await batchEditDeck(deck, catalog, { indices: [2], instruction: "売上を 120 に", aiFix: async () => ({ ok: true, markdown: raw }) });
    expect(res.changes).toEqual([]);
    expect(res.deck).toEqual(deck);
    expect(res.routes).toEqual([{ slideIndex: 2, route: "rejected", skipped: 0, applied: false, notices: [mixedOpsNotice(raw)] }]);
  });
});

describe("#764 bootstrap toolNotes.slideEdit tells the new behaviour (rejected, not rewritten)", () => {
  const note = (G.TOOL_NOTES as Record<string, string>).slideEdit ?? "";
  it("says a mixed array is rejected with invalid-argument and the slide is unchanged; no longer says it becomes the body", () => {
    expect(note).toContain("invalid-argument");
    expect(note).toMatch(/系統を混ぜた配列は[^。]*拒否/);
    expect(note).not.toContain("配列の文字列が本文になる");
  });
});
