/**
 * mcp-tool-descriptions.test.ts — Issue #513 (ADR-0037 D2「ホットは最小・低トークンを死守」/ D3「契約はサーバが語る」).
 *
 * tools/list は毎セッション丸ごと送られる固定費。ホット系 16 本（毎指示で使う著作/構造/診断/per-slide read —
 * docs/design/mcp-value-realign.md §7.3 の温度表）の説明文を圧縮し、削った契約情報は bootstrap /
 * get_authoring_guide / get_diagram_guide へ**移動**した（削除ではない）。このファイルが固定するもの:
 *   1. size     — ホット 16 本と全ツールの tools/list（compact JSON）の文字数上限（ratchet: 下げるのは自由・上げるのは宣言付き PR）
 *   2. shape    — 全ツールの名前と inputSchema の形（description を除いた JSON）が圧縮前のスナップショットと不変
 *   3. pointers — 説明文が名指しするツール名（snake_case と bootstrap）が全て実在（TOOL_PROFILES）
 *   4. checklist— 説明文から削った項目が移動先（bootstrap 応答 / get_diagram_guide）に存在し、
 *                 二重持ちをやめた項目（JSON 例・共通の注意書き）は tools/list から消えている（R8）
 *   5. agreement— bootstrap が語る design-intent の op 文法が DesignIntentSchema（engine の真実）と一致（R8）
 *
 * 文字数は o200k トークンの代理指標（依存追加なしで決定論）。トークン実測は PR 本文に載せる（#466 と同じ測り方）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { DesignIntentSchema } from "../src/engine/design-intent";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, MemTemplateStore, type HostContext } from "../src/mcp/host-core";
import { TOOL_PROFILES } from "../src/mcp/tool-profiles";

/** ホット 16 本（mcp-value-realign.md §7.3「ホット」表と同一の集合）。 */
const HOT_TOOLS = [
  "set_slide_diagram",
  "apply_design_intent",
  "insert_slide",
  "move_slide",
  "set_slide_markdown",
  "duplicate_slide",
  "delete_slide",
  "convert_bullets_to_table",
  "set_deck_markdown",
  "get_slide",
  "get_slide_image",
  "get_slide_html",
  "split_overflowing_slides",
  "get_slide_fix_request",
  "get_slide_markdown",
  "get_deck_issues",
];

/** 文字数 ratchet（tools/list の各ツールを JSON.stringify した長さの合計）。
 *  圧縮前（main a6dd400）→ #513 後の実測: ホット 10,857 → 7,927 字・collab-gui 全 41 本 → 17,577 字。
 *  o200k ではホット 3,660 → 2,314 tok。Issue の目標 2,000 tok は未達 — 残りの最大項は SDK 生成の整数境界
 *  （"minimum":-9007199254740991 等・ホットだけで 456 tok）で、これは inputSchema の形の変更になるため
 *  本 Issue の不変条件の外（Issue #513 を閉じる PR の統括相談を参照）。上限は実測値に僅かな余裕だけ乗せた ratchet。 */
const HOT_CHAR_LIMIT = 7950;
// #554（export_pptx の引数 `charts` 追加・意図した inputSchema の拡張）で全体 17,577 → 17,752 字。宣言して上限を更新。
// #247（set_review_rules 追加・意図したツール面の拡張。id の enum は schema に載せずサーバ側検証＝+450 字に抑えた）で
// 全体 17,752 → 18,202 字。宣言して上限を更新。
const ALL_CHAR_LIMIT = 18250;

type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type CallRes = { content: Array<{ text?: string }>; isError?: boolean };

function collabGuiHost(): HostContext {
  return { registry: new DocRegistry(), active: () => undefined, setActive: () => {}, sharedOnly: false, templates: new MemTemplateStore() };
}

async function connect(host?: HostContext): Promise<Client> {
  const server = buildServer(createSession(null), host ? { host, registerResources: false } : {});
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

const jsonChars = (ts: Tool[]): number => ts.reduce((n, t) => n + JSON.stringify(t).length, 0);

/** inputSchema から description だけを再帰的に剥がした形（= 型・必須・enum・境界）。 */
function shapeOf(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shapeOf);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "description") out[k] = shapeOf(x);
    return out;
  }
  return v;
}

/** ツールの全説明文（ツール description ＋ 各パラメータ description）。 */
function allDescriptions(t: Tool): string {
  const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
  return [t.description ?? "", ...Object.values(props).map((p) => p.description ?? "")].join("\n");
}

let tools: Tool[] = []; // collab-gui ＝ 全ツールの上位集合（solo/collab-ai はその部分集合 — mcp-tool-profiles.test.ts）
let bootstrapText = "";
let flowchartGuide = "";

beforeAll(async () => {
  tools = (await (await connect(collabGuiHost())).listTools()).tools as Tool[];
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  const bytes = await bundleProject(parseMd("# 表紙\n\n---\n\n# 中身\n\n- 速度: 0.8秒"), template, { templateName: "T", savedAt: "2026-06-28T00:00:00Z" });
  const client = await connect();
  await client.callTool({ name: "open_project", arguments: { dataBase64: Buffer.from(bytes).toString("base64") } });
  const b = (await client.callTool({ name: "bootstrap", arguments: {} })) as unknown as CallRes;
  expect(b.isError).toBeFalsy();
  bootstrapText = b.content[0]?.text ?? "";
  const g = (await client.callTool({ name: "get_diagram_guide", arguments: { type: "flowchart" } })) as unknown as CallRes;
  flowchartGuide = (JSON.parse(g.content[0]?.text ?? "{}") as { guide?: string }).guide ?? "";
});

const hot = (): Tool[] => tools.filter((t) => HOT_TOOLS.includes(t.name));
const toolNamed = (name: string): Tool => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t;
};

describe("固定費 ratchet（#513: ホット説明文の圧縮）", () => {
  it("ホット 16 本が全て登録されている（集合のずれは温度表の更新を伴うこと）", () => {
    expect(hot().map((t) => t.name).sort()).toEqual([...HOT_TOOLS].sort());
  });
  it(`ホット 16 本の tools/list は ${HOT_CHAR_LIMIT} 字以下`, () => {
    expect(jsonChars(hot())).toBeLessThanOrEqual(HOT_CHAR_LIMIT);
  });
  it(`全ツール（collab-gui）の tools/list は ${ALL_CHAR_LIMIT} 字以下`, () => {
    expect(jsonChars(tools)).toBeLessThanOrEqual(ALL_CHAR_LIMIT);
  });
});

describe("ツール名・inputSchema の形は不変（説明文だけを変えた — ADR-0008 フロア）", () => {
  it("名前＋description を除いた inputSchema が圧縮前スナップショットと一致", async () => {
    const shapes = Object.fromEntries([...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.name, shapeOf(t.inputSchema)]));
    await expect(JSON.stringify(shapes, null, 2) + "\n").toMatchFileSnapshot("__snapshots__/mcp-tool-schemas.json");
  });
});

describe("説明文が名指しするツールは実在する（ポインタ切れ禁止）", () => {
  it("snake_case のツール名と bootstrap は全て TOOL_PROFILES にある", () => {
    const cited = new Set<string>();
    for (const t of tools) for (const m of allDescriptions(t).matchAll(/\b[a-z]+(?:_[a-z]+)+\b|\bbootstrap\b/g)) cited.add(m[0]);
    expect(cited.size).toBeGreaterThan(0);
    expect([...cited].filter((n) => !(n in TOOL_PROFILES)).sort()).toEqual([]);
  });
});

/** 説明文から削った項目 → 移動先で語られている証拠（needle）。where: bootstrap 応答 / get_diagram_guide("flowchart")。 */
const MOVED: Array<[tool: string, item: string, where: "bootstrap" | "diagramGuide", needle: string]> = [
  ["(共通) docId", "docId 省略時の解決順（選択 doc → 唯一 doc）", "bootstrap", "docId"],
  ["(共通) docId", "未選択は document-not-selected で拒否", "bootstrap", "document-not-selected"],
  ["(共通) opId", "opId は echo 抑制用（host のみ）", "bootstrap", "opId"],
  ["(共通) expectedRev", "expectedRev 不一致は stale 拒否（host のみ）", "bootstrap", "stale"],
  ["get_slide_markdown", "slide://{index}/markdown のミラー", "bootstrap", "slide://{index}/markdown"],
  ["get_deck_issues", "deck://issues のミラー", "bootstrap", "deck://issues"],
  ["get_slide", "返却項目の一覧（resolvedLayout…）", "bootstrap", "resolvedLayout"],
  ["get_slide", "hasFigure/figureKind・bulletCount", "bootstrap", "figureKind"],
  ["get_slide_fix_request", "packet は agent が LLM として埋める", "bootstrap", "LLM"],
  ["get_slide_image", "共有 HTML 描画・ネット遮断・使い捨てプロファイル", "bootstrap", "使い捨てプロファイル"],
  ["get_slide_html", "script ゼロ・CSP・フォント埋め込み", "bootstrap", "CSP"],
  ["set_slide_markdown", "入力は zod 検証", "bootstrap", "zod"],
  ["set_slide_diagram", "DiagramSpec の JSON 例", "diagramGuide", "\"nodes\""],
  ["set_slide_diagram", "placeholderIdx は multi-body 用", "bootstrap", "multi-body"],
  ["apply_design_intent", "regionSplit の arrangement 値", "bootstrap", "text-left"],
  ["apply_design_intent", "emphasize(nodeId)", "bootstrap", "nodeId"],
  ["apply_design_intent", "エンジンが座標を計算＋クランプ", "bootstrap", "クランプ"],
  ["insert_slide/move_slide/duplicate_slide", "他スライドの図/レイアウトは byte-identical（surgical）", "bootstrap", "surgical"],
  ["duplicate_slide", "structuredClone 複製", "bootstrap", "structuredClone"],
  ["move_slide", "from===to は no-op", "bootstrap", "from===to"],
];

/** 二重持ちをやめた文（R8: 例・共通注意は 1 箇所）— tools/list のどこにも残っていないこと。 */
const NO_LONGER_IN_TOOLS_LIST: Array<[item: string, needle: string]> = [
  ["set_slide_diagram の flowchart JSON 例", "\"nodes\":[{"],
  ["docId 省略規則の各ツール反復", "省略時は選択doc"],
  ["opId の各ツール反復", "echo 抑制"],
  ["expectedRev の各ツール反復", "stale 拒否"],
];

describe("圧縮は移動であって削除ではない（チェックリスト・#521 と同形）", () => {
  for (const [tool, item, where, needle] of MOVED) {
    it(`${tool}: ${item} → ${where}`, () => {
      const text = where === "bootstrap" ? bootstrapText : flowchartGuide;
      expect(text, `needle ${JSON.stringify(needle)} missing from ${where}`).toContain(needle);
    });
  }
  for (const [item, needle] of NO_LONGER_IN_TOOLS_LIST) {
    it(`tools/list から消えた: ${item}`, () => {
      expect(tools.map(allDescriptions).join("\n")).not.toContain(needle);
    });
  }
  it("説明文が移動先を指している: set_slide_diagram → get_diagram_guide・apply_design_intent → bootstrap", () => {
    expect(toolNamed("set_slide_diagram").description).toContain("get_diagram_guide");
    expect(toolNamed("apply_design_intent").description).toContain("bootstrap");
  });
});

describe("design-intent の op 文法は engine の DesignIntentSchema と一致（R8 agreement）", () => {
  it("全 op 名と全 enum 値が bootstrap で語られている", () => {
    const words: string[] = [];
    for (const opt of DesignIntentSchema.element.options) {
      const shape = opt.shape as Record<string, { options?: readonly string[]; value?: unknown; def?: { innerType?: { options?: readonly string[] } } }>;
      words.push(String(shape.op.value));
      for (const [k, f] of Object.entries(shape)) {
        if (k === "op") continue;
        words.push(k, ...(f.options ?? f.def?.innerType?.options ?? []));
      }
    }
    expect(words.length).toBeGreaterThan(8);
    for (const w of words) expect(bootstrapText, `design-intent の ${w} が bootstrap に無い`).toContain(w);
  });
});
