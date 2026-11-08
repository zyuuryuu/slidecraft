/**
 * server.ts — wires the engine Session (session.ts) to MCP as a tight set of tools. The upstream
 * agent IS the LLM; these tools are the deterministic engine ops, so the server never calls a
 * model. ONE control plane (ADR-0033 D1): every mutation resolves a DocEntry and commits through
 * `commitMutation` (per-doc undo history + a forward-only rev) — there is no second, direct-Session
 * mutate path. Two transports share this single registration path:
 *  - stdio (cli.ts): a SOLO HostContext (`createSoloHostContext`, host-core.ts) — exactly one doc,
 *    resolved via `soleDocId()`, no fan-out/notify, no token (OS-user trust boundary, ADR-0007).
 *  - host (host.ts, P2 collab): a DocRegistry of many docs; each tool resolves the connection's
 *    target doc (explicit docId → active doc → sole doc). The same deck tools work in both; WHICH
 *    tools each profile (solo / collab GUI / collab AI) sees is tool-profiles.ts's ONE table
 *    (ADR-0037 D2, #465 — doc-switching + register_templates stay collab-only).
 * Read-only deck state is ALSO exposed as MCP resources (deck://…) — a per-transport config flag
 * (`registerResources`), on by default (stdio), opt-out in collab (the GUI is the read surface there).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session";
import * as S from "./session";
import * as E from "./slide-edit";
import { registerResources } from "./resources";
import * as G from "./guides";
import * as T from "./templates";
import * as St from "./structure";
import * as R from "./reads";
import * as N from "./next-steps";
import * as TT from "./template-tools";
import { setReviewRules } from "./review-rules";
import type { DeckIssue } from "../engine/deck-diagnostics";
import { deckTitle } from "../engine/md-serializer";
import { type HostContext, type DocEntry, type TemplateStore, commitMutation, commitTemplateChange, changedIndicesOf, undoDoc, redoDoc, createSoloHostContext } from "./host-core";
import { GuardError } from "./guard-errors";
import { getBootstrap } from "./bootstrap";
import { gatedToolRegistrar } from "./tool-profiles";
import type { MetricsRecorder } from "./metrics-sink";
import { instrumentTool, noteDoc, noteChange } from "./metrics-probe";
import { registerVisualTools } from "./visual-tools";
import { persistScopedOrBase64, acquireScopedOrBase64 } from "./fs-scope";
// The ONE result envelope (tool-result.ts): ok / fail (GuardError → {ok:false,code}; else isError) / run.
import { type ToolResult, ok, fail, run } from "./tool-result";

const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

/** Attach deterministic next-step hints (MCP layer — references tool names) to any result carrying a
 *  post-edit `diagnostics` array, so a mutation's envelope tells the AI which tool fixes what (S6). */
const withHints = (v: unknown): unknown => {
  const r = v as { diagnostics?: unknown };
  return v && typeof v === "object" && Array.isArray(r.diagnostics) ? { ...(v as object), hints: N.nextStepHints(r.diagnostics as DeckIssue[]) } : v;
};

/** Build options. `onMutate` fires AFTER a mutating tool actually changed the deck — the seam the
 *  collab host uses to broadcast deckChanged. `host` supplies the control plane (DocRegistry +
 *  commitMutation); omit it and a SOLO one is minted around `session` (stdio's default — ADR-0033
 *  D1). `registerResources:false` drops the deck:// resources (collab opts out; stdio keeps them). */
export interface BuildServerOptions {
  onMutate?: (tool: string) => void;
  registerResources?: boolean;
  host?: HostContext;
  /** #512: 呼出ログの記録先。省略＝計測 OFF（handler は包まれず応答は byte-identical）。 */
  metrics?: MetricsRecorder;
}

export function buildServer(session: Session, opts: BuildServerOptions = {}): McpServer {
  const server = new McpServer({ name: "slidecraft", version: "0.5.0" });
  // ONE control plane always: an explicit host (collab) or a solo one minted around `session`
  // (stdio and any caller that doesn't bring its own multi-doc registry).
  const host: HostContext = opts.host ?? createSoloHostContext(session);
  // ADR-0037 D2 (#465): どのプロファイルに見せるかは tool-profiles.ts の表 1 箇所が決める（R8）— 以下の全登録はこのゲートを通る。
  // #512: 計測 ON のときだけ同じゲートで全 handler を包む（差し込み点はここ 1 箇所）。
  const rec = opts.metrics;
  const tool = gatedToolRegistrar(server, host, rec ? (name, profile, cfg, cb) => instrumentTool(name, profile, cfg.inputSchema !== undefined, cb, rec) : undefined);
  // ADR-0035 stage 1: the fs scope (--root) is a per-SERVER-PROCESS setting, not per-doc — every doc
  // minted later (open/new/use_template → S.createSession below) must inherit the SAME scope the
  // process was started with, not silently reset to --no-fs.
  const scopeRoot = session.root;
  const index = { index: z.number().int().describe("0-based slide index") };
  const doc = { docId: z.string().optional() }; // 解決規則は bootstrap.toolNotes.docId（#513: 全ツールへの反復をやめた）
  // Optional optimistic-concurrency fields (host mode, P2.5): a client-generated opId so the
  // originator can suppress its own deckChanged echo, and expectedRev so a stale edit (the doc moved
  // on under it) is rejected NEVER-SILENTLY. Absent on AI edits and in stdio (a solo doc has no
  // concurrent writer, so expectedRev is never stale there — but the field still round-trips).
  const cc = {
    opId: z.string().optional(), // GUI 用・意味は bootstrap.toolNotes.concurrency（#513）
    expectedRev: z.number().int().optional(),
  };

  // ── doc resolution ── explicit docId → connection active doc → the sole open doc; otherwise
  // never-silent ("select a document"). Solo stdio always has exactly one doc, so this always
  // resolves via soleDocId() without a docId/active().
  const entryOf = (extra: unknown, docId?: string): DocEntry => {
    const id = docId ?? host.active(extra) ?? host.registry.soleDocId();
    if (!id) throw new GuardError("ドキュメントが選択されていません（select_document か docId を指定してください）。", "document-not-selected");
    const entry = host.registry.get(id);
    noteDoc(entry.docId);
    return entry;
  };
  const sessionOf = (extra: unknown, docId?: string): Session => entryOf(extra, docId).session;

  // A deck MUTATION always commits through commitMutation (per-doc undo history + forward-only
  // rev) — there is no second, direct-Session mutate path (ADR-0033 D1). A {ok:false} reject never
  // bumps rev / fires onMutate.
  const mutate = async (
    extra: unknown,
    docId: string | undefined,
    tool: string,
    fn: (s: Session) => unknown | Promise<unknown>,
    cc?: { opId?: string; expectedRev?: number; index?: number }, // index: the tool's slide arg → changedIndices (#407)
  ): Promise<ToolResult> => {
    try {
      const entry = entryOf(extra, docId);
      // Optimistic-concurrency guard (P2.5): a human edit carries the rev it was based on; if the doc
      // moved on (e.g. an AI edit landed first), reject NEVER-SILENTLY so the client re-pulls — never
      // overwrite a newer rev.
      if (cc?.expectedRev !== undefined && cc.expectedRev !== entry.rev) {
        return ok({ ok: false as const, stale: true as const, expectedRev: cc.expectedRev, currentRev: entry.rev, docId: entry.docId });
      }
      const { result, changed, rev } = await commitMutation(entry, fn);
      const changedIndices = changed ? changedIndicesOf(tool, cc?.index, result) : undefined;
      noteChange("edit", changed, changedIndices); // #512: 増分性（D5-3）は GUI 追随と同じ写像から
      if (changed) {
        opts.onMutate?.(tool);
        host.onMutated?.(entry, tool, cc?.opId, changedIndices); // fan out deckChanged (opId: echo suppression; changedIndices: GUI follow #407); no-op in solo
      }
      if (changed && result && typeof result === "object") return ok(withHints({ ...(result as object), rev, docId: entry.docId, opId: cc?.opId }));
      return ok(withHints(result));
    } catch (e) {
      return fail(e);
    }
  };

  // #616: a TEMPLATE-only change (augment/adjust_template). The deck is untouched → no undo entry; rev advances
  // (forward-only) and collab fans out deckChanged{templateChanged}. The tool's response itself is unchanged.
  const mutateTemplate = (extra: unknown, docId: string | undefined, tool: string, fn: (s: Session) => Promise<{ changed?: boolean }>): Promise<ToolResult> =>
    run(async () => {
      const entry = entryOf(extra, docId);
      const res = await fn(entry.session);
      if (res.changed === true) {
        commitTemplateChange(entry);
        host.onTemplateChanged?.(entry, tool);
      }
      return res;
    });

  // open/new: MINTS a new doc (fresh Session + docId, its own seeded history) and notifies the GUI
  // to open a tab. In SOLO mode (`host.solo`), any other doc is swept out right after so the
  // registry keeps exactly one doc (soleDocId() keeps resolving; undo/redo/resources stay pinned to
  // it) — additive undo/redo for stdio without a second control plane.
  const openInHost = (tool: string, load: (s: Session) => Promise<unknown>, extra: unknown): Promise<ToolResult> =>
    run(async () => {
      const s = S.createSession(scopeRoot);
      const res = await load(s);
      // Tab name: the template name if known (open_project / use_template), else derive from the deck's
      // first-slide heading (an AI's new_project brings no template name → was always "Untitled"), else fall back.
      const entry = host.registry.create(s, s.meta.templateName || deckTitle(s.deck) || "Untitled", true); // AI-created = shared
      if (host.solo) {
        for (const d of host.registry.list()) if (d.docId !== entry.docId) host.registry.remove(d.docId);
      }
      host.setActive(extra, entry.docId);
      noteDoc(entry.docId);
      noteChange("mint", true);
      host.notifyOpened?.(entry);
      opts.onMutate?.(tool); // minting a doc always changes state — unlike an in-place edit, there's no no-op case here
      return { ...(res as object), docId: entry.docId };
    });

  // The authoring-contract digest rides EVERY path by which the AI enters a loaded doc: the stdio
  // open/new returns, the host open/new/select returns, AND list_documents — because in collab the AI
  // often lands on a GUI-opened doc via the sole-doc fallback (see entryOf) without ever calling
  // open/new/select. safeContract guards contractDigest's precondition (a fully loaded
  // deck+template+catalog) so a not-yet-loaded entry omits the contract instead of throwing.
  // Guide pull (get_authoring_guide) + the format anchors on the edit tools are the belt to this push.
  const safeContract = (s: Session) => (s.deck && s.template && s.catalog ? G.contractDigest(s) : undefined);
  const withContract = (load: (s: Session) => Promise<object>) => async (s: Session): Promise<object> => {
    const r = await load(s);
    const c = safeContract(s);
    return c ? { ...r, contract: c } : r;
  };

  // ── entry: open / new (base64 by default; scoped fs path when the server has --root, ADR-0035) ──
  tool(
    "open_project",
    { description: ".scft を開く（新しいドキュメントとして mint）。既定は base64（dataBase64）。--root（scope）起動時は代わりに path（scope 配下のファイル名）で渡せる（両方指定はエラー）", inputSchema: { dataBase64: z.string().optional(), path: z.string().optional().describe("scope 配下のファイル名（.scft・scope 起動時のみ有効・dataBase64 と排他）") } },
    (a, extra) => openInHost("open_project", withContract((s) => S.openProjectBytes(s, acquireScopedOrBase64(scopeRoot, a.dataBase64, a.path, "scft"))), extra),
  );
  tool(
    "new_project",
    { description: ".pptx テンプレートと（任意の）Markdown から新規作成（新ドキュメントを mint）。GUI の Draft と同じ整形。書式は get_authoring_guide・図は get_diagram_types。既定は base64（templateBase64）。--root（scope）起動時は代わりに templatePath（scope 配下のファイル名）で渡せる（両方指定はエラー）。テンプレ bytes が無ければ create_template で生成できる", inputSchema: { templateBase64: z.string().optional(), templatePath: z.string().optional().describe("scope 配下のテンプレファイル名（.pptx・scope 起動時のみ有効・templateBase64 と排他）"), markdown: z.string().optional() } },
    (a, extra) => openInHost("new_project", withContract((s) => S.newProject(s, acquireScopedOrBase64(scopeRoot, a.templateBase64, a.templatePath, "pptx"), a.markdown)), extra),
  );

  // ── reads ──
  tool("get_deck", { description: "現在の deck（DeckIR JSON）。resource `deck://current` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getDeck(sessionOf(extra, a.docId))));
  tool("get_deck_markdown", { description: "deck 全体を round-trip 可能な Markdown で。`deck://markdown` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getDeckMarkdown(sessionOf(extra, a.docId))));
  tool("get_slide_markdown", { description: "1スライドの Markdown（auto レイアウト解決済み）", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => S.getSlideMarkdown(sessionOf(extra, a.docId), a.index)));
  tool("get_slide", { description: "1スライドの構造化 read＝編集計画（capacity・predictedSplit・issues・markdown 等。項目は bootstrap）", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => R.getSlide(sessionOf(extra, a.docId), a.index)));
  tool("get_deck_issues", { description: "deck の診断（split/condense/visualize/title レバー・budget・次の一手 hints）。export 可否は validate_deck", inputSchema: doc }, (a, extra) => run(async () => { const s = sessionOf(extra, a.docId); const d = S.getDiagnostics(s); const h = await TT.withOverflowScaleHint(s, d.issues); return { ...d, issues: h.issues, hints: N.nextStepHints(h.issues, h.recipe) }; }));
  tool("get_template_capabilities", { description: "テンプレートの能力サマリ＋レイアウト一覧（生成のプロンプト文脈）。`deck://capabilities` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getCatalog(sessionOf(extra, a.docId))));
  tool("get_project_info", { description: "現在のプロジェクトのメタ情報。`deck://info` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getProjectMeta(sessionOf(extra, a.docId))));
  tool("get_slide_fix_request", { description: "1スライドの修正 packet（埋めて set_slide_markdown で適用）", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => S.getSlideFix(sessionOf(extra, a.docId), a.index)));
  // Visual reads (#109 get_slide_image / #242 get_slide_html / #522 get_deck_image+html) — one shared
  // rendering, one confined rasterizer; registered here so the profile table's order holds.
  registerVisualTools({ tool, sessionOf, index, doc });

  // ── authoring contract (self-describing surface; T3/S1) ── the single entry the AI reads BEFORE
  // authoring: how to write this template's slide Markdown, the body budget, and pointers to figures.
  tool("get_authoring_guide", { description: "スライド Markdown の書き方（このテンプレのレイアウト名に解決した書式・`<!-- col/kpi/step -->` 区切り・表(GFM)・コード）＋本文 budget＋図/テンプレ作成ガイドへの入口。スライドを書く前にまずこれを読む", inputSchema: doc }, (a, extra) => run(() => G.getAuthoringGuide(sessionOf(extra, a.docId))));
  // #247: レビュー規則の on/off（セッション＝doc 単位・deck には保存しない）。id の検証は review-rules.ts（REVIEW_RULES 由来・R8）。
  tool("set_review_rules", { description: "レビュー規則の on/off（例 rules:{\"touten-used\":\"off\"}・id は activeReviewRules）。off は get_deck_issues に出ない", inputSchema: { rules: z.record(z.string(), z.enum(["on", "off"])), ...doc } }, (a, extra) => run(() => setReviewRules(sessionOf(extra, a.docId), a.rules)));
  tool("get_diagram_types", { description: "図の種類メニュー（authorable な12種＝type/label/hint）。図を入れるならまずここで種類を選ぶ（flowchart 以外に11種ある）" }, () => run(() => G.getDiagramTypes()));
  tool("get_diagram_guide", { description: "選んだ図タイプの構文＋JSON例（```diagram に書く DiagramSpec）。class/state/ER/mindmap は type ではなく ```mermaid で描く", inputSchema: { type: z.string().describe("get_diagram_types の type") } }, (a) => run(() => G.getDiagramGuide(a.type)));

  // ── template provisioning (T3/S2) ── acquire a template with no bytes: create one from a spec (or the
  // MIDNIGHT preset). Session-independent; hand the returned templateBase64 to new_project to start.
  tool("create_template", { description: "TemplateSpec の JSON 文字列（name＋fonts＋9色 palette・layouts 既定30）からテンプレ PPTX を生成し base64 で返す。欠落は MIDNIGHT preset で補完＋低コントラストは自動修正（notices で告知）。書式は get_template_spec_guide。返した templateBase64 を new_project に渡して着手", inputSchema: { spec: z.string().optional().describe("TemplateSpec の JSON 文字列（オブジェクトではなく文字列で渡す・部分可・省略で MIDNIGHT preset）。例: spec: '{}'") } }, (a) => run(() => T.createTemplate(a.spec)));
  tool("get_template_spec_guide", { description: "create_template 用 TemplateSpec の書式ガイド＋MIDNIGHT preset 値（開始点）" }, () => run(() => T.getTemplateSpecGuide()));

  // ── cold bootstrap (ADR-0037 D2) ── ONE call returns the whole cold set; each section is composed
  // from the SAME functions as the 6 legacy tools (R8), which stay registered unchanged (ADR-0008 floor).
  tool("bootstrap", { description: "セッション開始時に1回：コールド系（調達・契約）を1レスポンスで返す＝authoringGuide・diagramTypes・templateSpecGuide・templateCapabilities・templates・toolNotes（ツール共通の約束）（各節は同名の旧 get_*/list_* ツールと同一内容・図タイプ別構文のみ get_diagram_guide(type) で個別取得）。doc 未オープン時は doc 依存節が {ok:false, code} で埋まる（他節は返る）", inputSchema: doc }, (a, extra) => run(() => getBootstrap(() => sessionOf(extra, a.docId), host.templates, !!host.solo, scopeRoot)));

  // ── deterministic mutations ──
  tool("set_slide_markdown", { description: "1スライドを Markdown で差し替え（図/表/コードは自動保持・不正は never-silent 拒否）。書式は bootstrap。ops の JSON 配列は差分適用", inputSchema: { ...index, markdown: z.string(), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "set_slide_markdown", (s) => E.applySlideEdit(s, a.index, a.markdown), { opId: a.opId, expectedRev: a.expectedRev, index: a.index }));
  tool("set_deck_markdown", { description: "⚠️ deck 全体を置換（スライド数が変わりうる・図は自動保持されない）。1枚なら set_slide_markdown", inputSchema: { markdown: z.string(), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "set_deck_markdown", (s) => S.applyDeckMarkdown(s, a.markdown), { opId: a.opId, expectedRev: a.expectedRev }));
  tool("split_overflowing_slides", { description: "決定論レバー: 溢れた本文スライドをフォント縮小なしで分割", inputSchema: { ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "split_overflowing_slides", (s) => S.distill(s), { opId: a.opId, expectedRev: a.expectedRev }));
  tool("convert_bullets_to_table", { description: "決定論レバー: key-value 箇条書きを GFM 表に", inputSchema: { ...index, ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "convert_bullets_to_table", (s) => S.visualizeKeyValue(s, a.index), { opId: a.opId, expectedRev: a.expectedRev, index: a.index }));
  tool(
    "set_slide_diagram",
    { description: "図の【中身】を DiagramSpec(yaml/json) か Mermaid の文字列で設定（既存図は置換・無ければ追加）。構文と例は get_diagram_guide・配置は apply_design_intent", inputSchema: { ...index, source: z.string().describe("文字列で渡す（オブジェクト不可）"), format: z.enum(["yaml", "json", "mermaid"]), placeholderIdx: z.string().optional().describe("body の 1-based 番号（既定 1）"), figure: z.number().optional().describe("何番目か（既定は図優先）"), ...doc, ...cc } },
    (a, extra) => mutate(extra, a.docId, "set_slide_diagram", (s) => S.setDiagram(s, a.index, a.source, a.format, a.placeholderIdx, a.figure), { opId: a.opId, expectedRev: a.expectedRev, index: a.index }),
  );
  tool(
    "apply_design_intent",
    {
      description: '図の【配置】を ops 配列の JSON 文字列で（例 [{"op":"relayout","direction":"LR"}]・op 一覧は bootstrap）。図のあるスライドのみ・中身は set_slide_diagram',
      inputSchema: { ...index, intent: z.string().describe("文字列で渡す（オブジェクト不可）"), ...doc, ...cc },
    },
    (a, extra) => mutate(extra, a.docId, "apply_design_intent", (s) => S.applyDesignIntent(s, a.index, a.intent), { opId: a.opId, expectedRev: a.expectedRev, index: a.index }),
  );
  // ── structure ops (T2/S4) ── surgical add/remove/reorder/duplicate a slide; the SURVIVING slides'
  // figures/layouts stay byte-identical (set_deck_markdown drops them). Prefix insert_/delete_/move_/
  // duplicate_ = structure vs set_/apply_/convert_/split_ = content, so the verb alone routes the AI.
  tool("insert_slide", { description: "Markdown から新スライドを index の前/後に挿入（他スライドの図は保持）", inputSchema: { ...index, markdown: z.string(), position: z.enum(["before", "after"]).optional().describe("既定 before"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "insert_slide", (s) => St.insertSlide(s, a.index, a.markdown, a.position), { opId: a.opId, expectedRev: a.expectedRev }));
  tool("delete_slide", { description: "index のスライドを削除（最後の1枚は拒否・deletedMd を返す）", inputSchema: { ...index, ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "delete_slide", (s) => St.deleteSlide(s, a.index), { opId: a.opId, expectedRev: a.expectedRev }));
  tool("move_slide", { description: "スライドを fromIndex から toIndex へ移動（図/レイアウト保持）", inputSchema: { fromIndex: z.number().int().describe("0-based"), toIndex: z.number().int().describe("0-based"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "move_slide", (s) => St.moveSlide(s, a.fromIndex, a.toIndex), { opId: a.opId, expectedRev: a.expectedRev }));
  tool("duplicate_slide", { description: "index のスライドを byte-identical に複製", inputSchema: { ...index, position: z.enum(["before", "after"]).optional().describe("既定 after"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "duplicate_slide", (s) => St.duplicateSlide(s, a.index, a.position), { opId: a.opId, expectedRev: a.expectedRev }));

  tool("validate_deck", { description: "EXPORT ゲート：schema 検証＋変換不能 mermaid スキャン→exportReadiness。※ 内容の手直し（溢れ/冗長/表化）は get_deck_issues", inputSchema: doc }, (a, extra) => run(() => S.validate(sessionOf(extra, a.docId))));

  // ── persist / export (base64 over stdio by default; scoped fs when the server has --root, ADR-0035) ──
  tool(
    "save_project",
    { description: ".scft を生成。既定は base64（{dataBase64}）。サーバが --root（scope）起動時は scope 配下へファイル出力し {path} を返す（filename 省略時は自動命名）", inputSchema: { filename: z.string().optional().describe("scope 配下のファイル名（scope 起動時のみ有効・拡張子 .scft 必須・サブディレクトリ/絶対パス不可）"), ...doc } },
    (a, extra) =>
      run(async () => {
        const s = sessionOf(extra, a.docId);
        return persistScopedOrBase64(s, await S.saveProjectBytes(s, !host.guiClient), "scft", a.filename) // #633: GUI = read;
      }),
  );
  tool(
    "export_pptx",
    {
      description: ".pptx を native-vector で headless 生成（変換不能 mermaid は default reject / skip）。既定は base64（{dataBase64, skipped}）。サーバが --root（scope）起動時は scope 配下へファイル出力し {path, skipped} を返す（filename 省略時は自動命名）",
      inputSchema: { onUnsupportedMermaid: z.enum(["reject", "skip"]).optional(), charts: z.enum(["shapes", "native"]).optional().describe("native＝pie/xychart/radar を PowerPoint ネイティブ chart で出す（編集可・プレビューは近似）。結果に charts:{native,shapes}。既定 shapes"), filename: z.string().optional().describe("scope 配下のファイル名（scope 起動時のみ有効・拡張子 .pptx 必須・サブディレクトリ/絶対パス不可）"), ...doc },
    },
    (a, extra) =>
      run(async () => {
        const s = sessionOf(extra, a.docId);
        const { bytes, skipped, charts } = await S.exportPptxBytes(s, a.onUnsupportedMermaid ?? "reject", a.charts ?? "shapes");
        return { ...persistScopedOrBase64(s, bytes, "pptx", a.filename), skipped, ...(charts ? { charts } : {}) };
      }),
  );

  // ── multi-doc lifecycle + server-side undo (additive on solo stdio: 1 doc, no-op-ish) ──
  tool("list_documents", { description: "開いているドキュメント一覧（AI クライアントは共有docのみ＝private-by-default）。各docに contract（書式ダイジェスト）付き", }, (extra) =>
    run(() => ({
      documents: host.registry.list({ sharedOnly: host.sharedOnly }).map((d) => {
        const c = safeContract(host.registry.get(d.docId).session); // so the list→operate flow carries the contract
        return c ? { ...d, contract: c } : d;
      }),
      activeDocId: host.active(extra) ?? null,
    })),
  );
  tool("select_document", { description: "このコネクションの対象ドキュメントを切り替える（AI 版 switchDoc。deck は変えない）", inputSchema: { docId: z.string() } }, ({ docId }, extra) =>
    run(() => {
      const e = host.registry.get(docId);
      host.setActive(extra, docId);
      // The AI may enter a doc via select — carry the contract here too (also on open/new + list_documents).
      const c = safeContract(e.session);
      return { docId: e.docId, slideCount: e.session.deck?.slides.length ?? 0, rev: e.rev, ...(c ? { contract: c } : {}) };
    }),
  );
  tool("close_document", { description: "ドキュメントを閉じる（dirty は force 必須＝never-silent）", inputSchema: { docId: z.string(), force: z.boolean().optional() } }, ({ docId, force }) =>
    run(() => {
      const e = host.registry.get(docId);
      if (e.session.dirty && !force) return { ok: false as const, closed: false as const, dirty: true as const };
      host.registry.remove(docId);
      host.notifyClosed?.(docId);
      return { ok: true as const, closed: true as const };
    }),
  );
  tool("undo", { description: "サーバ側 Undo：このドキュメントの真実を1手戻す（新しい forward rev を発行）", inputSchema: doc }, (a, extra) =>
    run(() => {
      const e = entryOf(extra, a.docId);
      const r = undoDoc(e);
      noteChange("undo", r.ok);
      if (r.ok) {
        opts.onMutate?.("undo");
        host.onMutated?.(e, "undo");
      }
      return { ...r, docId: e.docId };
    }),
  );
  tool("redo", { description: "サーバ側 Redo：直前の Undo を取り消す", inputSchema: doc }, (a, extra) =>
    run(() => {
      const e = entryOf(extra, a.docId);
      const r = redoDoc(e);
      noteChange("undo", r.ok);
      if (r.ok) {
        opts.onMutate?.("redo");
        host.onMutated?.(e, "redo");
      }
      return { ...r, docId: e.docId };
    }),
  );

  // ── template selection (T3/S2 増分2, #298) ── the AI DISCOVERS templates (list_templates) and
  // STARTS a project from one (use_template) without carrying bytes. The master registry lives in
  // the webview (useMasterRegistry / Tauri fs); the sidecar is Node with no fs plugin, so the GUI
  // PUSHES it in via register_templates (gui-role only), mirroring how it seeds the deck. `host.solo`
  // (stdio, no GUI ever attaches) has no registry to push into, so list/use fall back to the
  // BUILT-IN presets (T.BUILTIN_TEMPLATES) instead of degrading to an error — "list → pick → start"
  // holds even with nobody on the other end of register_templates. A collab host that genuinely has
  // no registry wired (host.templates absent AND NOT solo — e.g. a caller that skipped it) keeps the
  // never-silent create_template hint unchanged.
  const requireTemplates = (): TemplateStore => {
    if (!host.templates) throw T.templateRegistryUnavailable();
    return host.templates;
  };
  tool(
    "list_templates",
    { description: "テンプレの一覧＝{id,name,builtin}。id を use_template に渡して着手。GUI の master レジストリが接続済みならそれを、単独（GUI 未接続）は組み込みプリセット（builtin:true）を返す。--root 起動時は <root>/templates/ 配下の .pptx/.potx（builtin:false・id は file: 始まり）も一覧に含む。bytes を自分で持っているなら create_template でも生成できる" },
    () => run(() => T.listTemplates(host.templates, !!host.solo, scopeRoot)),
  );
  tool(
    "use_template",
    { description: "テンプレ（list_templates の id）から新規プロジェクトを開始（新ドキュメントを mint・任意の Markdown）。builtin id は create_template と同じハーネスで生成、file: 始まりの id は --root 配下 templates/ のファイルから起票。既存 doc のテンプレ入替ではない。書式は get_authoring_guide", inputSchema: { id: z.string().describe("list_templates の template id（builtin または file: 始まり）"), markdown: z.string().optional() } },
    (a, extra) =>
      openInHost(
        "use_template",
        withContract(async (s) => {
          if (host.templates) {
            const store = host.templates;
            const bytes = store.getBytes(a.id);
            if (!bytes) throw new GuardError(`テンプレが見つかりません: ${a.id}（list_templates で id を確認）`, "unknown-template");
            const res = await S.newProject(s, bytes, a.markdown);
            const name = store.list().find((t) => t.id === a.id)?.name;
            if (name) s.meta.templateName = name; // the minted doc's tab is named after the template
            return res;
          }
          if (host.solo) {
            // Built-in preset OR a `file:` id naming a template under <root>/templates/ (#332).
            const { bytes, name } = await T.resolveSoloTemplate(a.id, scopeRoot);
            const res = await S.newProject(s, bytes, a.markdown);
            s.meta.templateName = name;
            return res;
          }
          requireTemplates(); // no registry and not solo: always throws template-registry-unavailable
          throw new Error("unreachable");
        }),
        extra,
      ),
  );
  // collab-gui ONLY (the profile table): the human's webview uploads its registry so the AI can
  // select from it — an AI client can't spoof the shared set, and solo (no GUI ever) never sees it.
  tool(
    "register_templates",
    { description: "（GUI 専用）webview の master レジストリを host に登録し AI が list_templates/use_template で選べるようにする。呼ぶ度に全置換（GUI の一覧が真実）", inputSchema: { templates: z.array(z.object({ id: z.string(), name: z.string(), builtin: z.boolean(), bytesBase64: z.string() })) } },
    (a) =>
      run(() => {
        requireTemplates().register(a.templates.map((t) => ({ id: t.id, name: t.name, builtin: t.builtin, bytes: unb64(t.bytesBase64) })));
        return { ok: true as const, count: a.templates.length };
      }),
  );

  // ── template derivation (#568 段 3 / #570 段 3) ── the open doc's template → a DERIVED one (source untouched;
  // rebuilt from source + recipe in the fixed order fonts → scale → augment). Logic in template-tools.ts.
  tool("augment_template", { description: "無い構造（列・比較・カード・KPI）を合成した派生テンプレを doc に適用（元は不変・bootstrap）", inputSchema: { structures: z.array(z.enum(["columns-2", "columns-3", "compare-2", "card-3", "kpi-3", "kpi-4"])).optional(), rule: z.enum(["steps", "ratio"]).optional(), ...doc } }, (a, extra) => mutateTemplate(extra, a.docId, "augment_template", (s) => TT.augmentDocTemplate(s, a.structures, a.rule)));
  tool("adjust_template", { description: "書体/文字サイズのレシピで派生テンプレを doc に適用（元は不変・bootstrap）", inputSchema: { recipe: z.string().describe('JSON 文字列 例 {"scale":{"body":0.9}}'), ...doc } }, (a, extra) => mutateTemplate(extra, a.docId, "adjust_template", (s) => TT.adjustDocTemplate(s, a.recipe)));

  // ── read-only deck state as MCP resources (deck://… , slide://{i}/markdown) ──
  // A per-transport config flag, not a mode split (ADR-0033 D1): solo stdio defaults ON (no GUI, so
  // resources ARE the read surface); collab passes registerResources:false (the GUI is the read
  // surface there).
  if (opts.registerResources !== false) registerResources(server, host);

  return server;
}
