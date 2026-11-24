/**
 * mcp-batch4-followups-714.test.ts — #714（MCP 第 4 バッチの残所見）のうちコードで固定するもの。
 *
 *  所見 4: contract（open/new/select の返り値に毎回載る著作契約の要約＝guides.ts contractDigest）の
 *          `marker-layout-missing` の説明が statement／quote だけでなく section（章扉・#662）も言う。
 *  所見 3: ops 語彙（set_slide_markdown に渡せる差分 op）を MCP エージェントへ案内する経路として、
 *          bootstrap の toolNotes に `slideEdit` を置く（set_slide_markdown の説明文は既に「書式は bootstrap」と
 *          指している＝tools/list・inputSchema は不変）。語彙は engine の op スキーマと一致（R8 agreement）。
 *
 * いずれも tool の返り値の文面で、tools/list（tests/mcp-tool-descriptions.test.ts の文字数 ratchet）と
 * tests/__snapshots__/mcp-tool-schemas.json には載らない。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";
import { getBootstrap } from "../src/mcp/bootstrap";
import { FieldEditOpsSchema } from "../src/engine/field-edit-ops";
import { DataEditOpsSchema } from "../src/engine/chart-edit-ops";
import { DiagramEditOpsSchema } from "../src/engine/diagram-edit-ops";
import { DesignIntentSchema } from "../src/engine/design-intent";

const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

describe("#714 所見 4: contract の marker-layout-missing の説明が 3 役（statement／quote／section）を言う", () => {
  it("marker-layout-missing を述べる括弧書きに statement・quote・section が揃う", async () => {
    const s = S.createSession(null);
    await S.newProject(s, readFileSync(TEMPLATE));
    const d = G.contractDigest(s);
    const all = Object.values(d).filter((v): v is string => typeof v === "string");
    const clauses = all.flatMap((t) => t.split(/[（）]/)).filter((c) => c.includes("marker-layout-missing"));
    expect(clauses).toHaveLength(1);
    for (const role of ["statement", "quote", "section"]) expect(clauses[0], role).toContain(role);
  });
});

/** zod の op 判別共用体から op 名を取り出す（配列 → 要素 → 判別共用体の options か単一 object）。 */
function opNames(arr: { element: unknown }): string[] {
  const el = arr.element as { options?: Array<{ shape: { op: { value: string } } }>; shape?: { op: { value: string } } };
  const objs = el.options ?? (el.shape ? [el as { shape: { op: { value: string } } }] : []);
  return objs.map((o) => String(o.shape.op.value));
}

describe("#714 所見 3: bootstrap.toolNotes.slideEdit が set_slide_markdown の ops 語彙を案内する", () => {
  const note = (G.TOOL_NOTES as Record<string, string>).slideEdit ?? "";

  it("bootstrap の toolNotes に載る（ドキュメント未オープンでも読める）", () => {
    const b = getBootstrap(() => S.createSession(null), undefined, true, null);
    expect((b.toolNotes as Record<string, string>).slideEdit).toBe(note);
    expect(note).toContain("set_slide_markdown");
  });

  it("engine の op スキーマの全 op 名を語る（R8 agreement: 語彙が増えたらここが赤）", () => {
    const names = [
      ...opNames(FieldEditOpsSchema),
      ...opNames(DataEditOpsSchema),
      ...opNames(DiagramEditOpsSchema),
      ...opNames(DesignIntentSchema),
    ];
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const n of names) expect(note, `op ${n} が toolNotes.slideEdit に無い`).toContain(n);
  });

  it("フェンス受理・応答の route／skipped（数）／notices・setField の idx の在処を言う", () => {
    expect(note).toContain("```json");
    for (const w of ["route", "skipped", "notices", "数", "placeholders[].idx"]) expect(note, w).toContain(w);
  });
});
