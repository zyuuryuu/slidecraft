/**
 * sequence-region-fit.test.ts — #388: a sequence diagram embedded BESIDE body text (region-fitted)
 * used to scale its text down without bound (paintFitted → TransformedTarget scales fonts uniformly,
 * and the layout always spread participants across the FULL slide width with a fixed 0.5in message
 * gap) — real decks landed at ~4pt, user-reported down to 1pt. The fix makes computeSequenceLayout
 * accept the fit target (region w×h) and compact itself toward the region's aspect (tighter gaps,
 * clamped column width), so the uniform fit keeps fonts legible. The SOLO (no-region) layout is
 * unchanged — those slides must stay byte-identical.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import * as S from "../src/mcp/session";
import { DiagramSpecSchema } from "../src/engine/schema";
import { computeSequenceLayout } from "../src/engine/diagram-sequence";
import { SLIDE_W } from "../src/engine/layout-engine";

const SPEC = DiagramSpecSchema.parse({
  type: "sequence",
  direction: "TB",
  nodes: [
    { id: "U", label: "ユーザー" },
    { id: "F", label: "フロントエンド" },
    { id: "A", label: "認証サービス" },
    { id: "D", label: "データベース" },
  ],
  edges: [
    { from: "U", to: "F", label: "ログイン画面を開く" },
    { from: "F", to: "A", label: "認証リクエストを送信する" },
    { from: "A", to: "D", label: "ユーザー情報を照会する" },
    { from: "D", to: "A", label: "ユーザーレコードを返す", style: { dash: true } },
    { from: "A", to: "F", label: "認証トークンを発行して返却する", style: { dash: true } },
    { from: "F", to: "U", label: "ダッシュボードを表示する", style: { dash: true } },
    { from: "U", to: "F", label: "レポート作成を依頼する" },
    { from: "F", to: "A", label: "トークンの有効性を検証する" },
    { from: "A", to: "F", label: "検証結果を返す", style: { dash: true } },
    { from: "F", to: "D", label: "レポート用データを取得する" },
    { from: "D", to: "F", label: "集計済みデータを返す", style: { dash: true } },
    { from: "F", to: "U", label: "完成したレポートを表示する", style: { dash: true } },
  ],
});

describe("computeSequenceLayout — no fit target (solo, unchanged geometry)", () => {
  it("keeps the historical full-slide spread and 0.5in message gap (byte-identity guard)", () => {
    const lay = computeSequenceLayout(SPEC, 0.8);
    const n = SPEC.nodes.length;
    const colW = (SLIDE_W - 2 * 0.6) / n;
    expect(lay.parts[0].cx).toBeCloseTo(0.6 + colW / 2, 6);
    expect(lay.parts[n - 1].cx).toBeCloseTo(0.6 + colW * (n - 1) + colW / 2, 6);
    expect(lay.msgs[1].y - lay.msgs[0].y).toBeCloseTo(0.5, 6);
    expect(lay.boxH).toBeCloseTo(0.5, 6);
  });
});

describe("computeSequenceLayout — with a fit target (#388)", () => {
  const FIT = { w: 5.7, h: 5.3 }; // ≈ the body-placeholder region of the repro deck

  it("compacts the message gap and narrows the participant spread toward the region aspect", () => {
    const solo = computeSequenceLayout(SPEC, 0.8);
    const fitted = computeSequenceLayout(SPEC, 0.8, FIT);
    // vertical compaction: per-message advance strictly below the solo 0.5in
    expect(fitted.msgs[1].y - fitted.msgs[0].y).toBeLessThan(0.5);
    // horizontal compaction: total spread narrower than the full-slide spread
    const spread = (l: typeof solo) => l.parts[l.parts.length - 1].cx - l.parts[0].cx;
    expect(spread(fitted)).toBeLessThan(spread(solo));
    // the compact bbox must beat the solo bbox on fit scale (that IS the font size)
    const scale = (l: typeof solo) =>
      Math.min(FIT.w / (l.bbox.maxX - l.bbox.minX), FIT.h / (l.bbox.maxY - l.bbox.minY));
    expect(scale(fitted)).toBeGreaterThan(scale(solo) * 1.2);
  });

  it("never narrows columns below the legibility floor (long message labels keep room)", () => {
    const fitted = computeSequenceLayout(SPEC, 0.8, { w: 2, h: 8 }); // absurdly tall+narrow region
    const colW = fitted.parts[1].cx - fitted.parts[0].cx;
    expect(colW).toBeGreaterThanOrEqual(1.8 - 1e-6);
  });

  it("message order / self-message flags survive the compaction", () => {
    const fitted = computeSequenceLayout(SPEC, 0.8, FIT);
    expect(fitted.msgs).toHaveLength(SPEC.edges.length);
    for (let i = 1; i < fitted.msgs.length; i++) expect(fitted.msgs[i].y).toBeGreaterThan(fitted.msgs[i - 1].y);
  });
});

// ── End-to-end: the repro deck (#388) ──

const MERMAID = [
  "```mermaid",
  "sequenceDiagram",
  "  participant U as ユーザー",
  "  participant F as フロントエンド",
  "  participant A as 認証サービス",
  "  participant D as データベース",
  "  U->>F: ログイン画面を開く",
  "  F->>A: 認証リクエストを送信する",
  "  A->>D: ユーザー情報を照会する",
  "  D-->>A: ユーザーレコードを返す",
  "  A-->>F: 認証トークンを発行して返却する",
  "  F-->>U: ダッシュボードを表示する",
  "  U->>F: レポート作成を依頼する",
  "  F->>A: トークンの有効性を検証する",
  "  A-->>F: 検証結果を返す",
  "  F->>D: レポート用データを取得する",
  "  D-->>F: 集計済みデータを返す",
  "  F-->>U: 完成したレポートを表示する",
  "```",
].join("\n");

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

/** All run sizes (sz, pt×100) of runs whose text contains `needle`. */
function runSizes(slideXml: string, needle: string): number[] {
  const out: number[] = [];
  for (const m of slideXml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    if (m[1].includes(needle)) {
      const sz = m[1].match(/\bsz="(\d+)"/);
      if (sz) out.push(parseInt(sz[1]));
    }
  }
  return out;
}

describe("PPTX export — sequence diagram beside body text stays legible (#388)", () => {
  it("message labels land well above the pre-fix ~4pt; the solo slide keeps its exact 9pt/11pt", async () => {
    const md = [
      "# 表紙",
      "---",
      "# 認証フロー（図のみ）",
      MERMAID,
      "---",
      "# 認証フロー（本文と併置）",
      "- ログインからレポート表示までの流れ",
      "- 認証サービスがトークンを検証する",
      MERMAID,
    ].join("\n\n");
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, md);
    const { bytes } = await S.exportPptxBytes(s);
    const zip = await JSZip.loadAsync(bytes);
    const solo = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const beside = await zip.file("ppt/slides/slide3.xml")!.async("string");

    // solo (no region): untouched base sizes — the byte-identity invariant made visible
    expect(runSizes(solo, "ログイン画面を開く")).toEqual([900]);
    expect(runSizes(solo, "ユーザー")).toContain(1100);

    // beside text (region-fitted): was 398 (#388) — must now clear a legibility floor
    const label = runSizes(beside, "ログイン画面を開く");
    expect(label).toHaveLength(1);
    expect(label[0]).toBeGreaterThanOrEqual(550);
    const participant = runSizes(beside, "フロントエンド");
    expect(participant.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...participant)).toBeGreaterThanOrEqual(650);
  }, 30_000);
});
