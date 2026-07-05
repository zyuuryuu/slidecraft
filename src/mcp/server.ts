/**
 * server.ts — wires the engine Session (session.ts) to MCP as a tight set of tools. The upstream
 * agent IS the LLM; these tools are the deterministic engine ops, so the server never calls a
 * model. Two modes share ONE registration path:
 *  - stdio (cli.ts, the 正 baseline): one fixed Session; tools resolve to it; listener-less.
 *  - host (host.ts, P2 collab): a DocRegistry of many docs; each tool resolves the connection's
 *    target doc (explicit docId → active doc → sole doc), mutations commit through per-doc undo
 *    history + a forward-only rev, and the doc-lifecycle tools (list/select/close/undo/redo +
 *    new/open mint-new-doc) come online. The same 18 deck tools work in both modes.
 * Read-only deck state is ALSO exposed as MCP resources (deck://…) in stdio; opt-out in host.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session";
import * as S from "./session";
import { registerResources } from "./resources";
import * as G from "./guides";
import * as T from "./templates";
import * as St from "./structure";
import * as R from "./reads";
import * as N from "./next-steps";
import type { DeckIssue } from "../engine/deck-diagnostics";
import { type HostContext, type DocEntry, commitMutation, undoDoc, redoDoc } from "./host-core";
import { GuardError } from "./guard-errors";

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [k: string]: unknown; // match the SDK's CallToolResult (passthrough _meta etc.)
}
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
// A GuardError is a MODELED precondition failure → the { ok:false, error, code } envelope
// (isError:false, a normal result). Everything else is an unmodeled crash → isError:true. This is
// THE choke point: run() and both mutate() branches funnel every throw through here (ADR-0015).
const fail = (e: unknown): ToolResult =>
  e instanceof GuardError
    ? ok({ ok: false as const, error: e.message, code: e.code })
    : { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
async function run(fn: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

/** Attach deterministic next-step hints (MCP layer — references tool names) to any result carrying a
 *  post-edit `diagnostics` array, so a mutation's envelope tells the AI which tool fixes what (S6). */
const withHints = (v: unknown): unknown => {
  const r = v as { diagnostics?: unknown };
  return v && typeof v === "object" && Array.isArray(r.diagnostics) ? { ...(v as object), hints: N.nextStepHints(r.diagnostics as DeckIssue[]) } : v;
};

/** Build options. `onMutate` fires AFTER a mutating tool actually changed the deck — the seam the
 *  collab host uses to broadcast deckChanged. stdio passes nothing, so it's a no-op. `host` flips
 *  the server into multi-doc/collab mode. `registerResources:false` drops the deck:// resources. */
export interface BuildServerOptions {
  onMutate?: (tool: string) => void;
  registerResources?: boolean;
  host?: HostContext;
}

export function buildServer(session: Session, opts: BuildServerOptions = {}): McpServer {
  const server = new McpServer({ name: "slidecraft", version: "0.1.0" });
  const host = opts.host;
  const index = { index: z.number().int().describe("0-based slide index") };
  // Optional target doc (host mode only; ignored in stdio where there is one Session).
  const doc = { docId: z.string().optional().describe("対象ドキュメント（host のみ。省略時は選択doc/唯一doc）") };
  // Optional optimistic-concurrency fields (host mode, P2.5): a client-generated opId so the
  // originator can suppress its own deckChanged echo, and expectedRev so a stale edit (the doc moved
  // on under it) is rejected NEVER-SILENTLY. Absent on AI edits and in stdio.
  const cc = {
    opId: z.string().optional().describe("クライアント生成の操作ID（echo 抑制用・host のみ）"),
    expectedRev: z.number().int().optional().describe("この編集が前提とする rev。現在 rev と不一致なら stale 拒否（host のみ）"),
  };

  // ── doc resolution ── stdio: the lone Session. host: explicit docId → connection active doc →
  // the sole open doc; otherwise never-silent ("select a document").
  const entryOf = (extra: unknown, docId?: string): DocEntry => {
    const h = host;
    if (!h) throw new GuardError("host モードではありません", "host-mode-required");
    const id = docId ?? h.active(extra) ?? h.registry.soleDocId();
    if (!id) throw new GuardError("ドキュメントが選択されていません（select_document か docId を指定してください）。", "document-not-selected");
    return h.registry.get(id);
  };
  const sessionOf = (extra: unknown, docId?: string): Session => (host ? entryOf(extra, docId).session : session);

  // A deck MUTATION: stdio runs the handler + fires onMutate on success; host commits through the
  // doc's undo history + bumps rev. A {ok:false} reject never bumps rev / fires onMutate.
  const mutate = async (
    extra: unknown,
    docId: string | undefined,
    tool: string,
    fn: (s: Session) => unknown | Promise<unknown>,
    cc?: { opId?: string; expectedRev?: number },
  ): Promise<ToolResult> => {
    if (!host) {
      try {
        const v = await fn(session);
        if (!(v && typeof v === "object" && (v as { ok?: unknown }).ok === false)) opts.onMutate?.(tool);
        return ok(withHints(v));
      } catch (e) {
        return fail(e);
      }
    }
    try {
      const entry = entryOf(extra, docId);
      // Optimistic-concurrency guard (P2.5): a human edit carries the rev it was based on; if the doc
      // moved on (e.g. an AI edit landed first), reject NEVER-SILENTLY so the client re-pulls — never
      // overwrite a newer rev.
      if (cc?.expectedRev !== undefined && cc.expectedRev !== entry.rev) {
        return ok({ ok: false as const, stale: true as const, expectedRev: cc.expectedRev, currentRev: entry.rev, docId: entry.docId });
      }
      const { result, changed, rev } = await commitMutation(entry, fn);
      if (changed) {
        opts.onMutate?.(tool);
        host.onMutated?.(entry, tool, cc?.opId); // fan out deckChanged (opId lets the originator suppress its echo)
      }
      if (changed && result && typeof result === "object") return ok(withHints({ ...(result as object), rev, docId: entry.docId, opId: cc?.opId }));
      return ok(withHints(result));
    } catch (e) {
      return fail(e);
    }
  };

  // open/new: stdio replaces the lone Session; host MINTS a new doc (fresh Session + docId, its
  // own seeded history) and notifies the GUI to open a tab. Resolves R1 scope issue #4.
  const openInHost = (load: (s: Session) => Promise<unknown>, extra: unknown): Promise<ToolResult> =>
    run(async () => {
      const s = S.createSession(null);
      const res = await load(s);
      const entry = host!.registry.create(s, s.meta.templateName || "Untitled", true); // AI-created = shared
      host!.setActive(extra, entry.docId);
      host!.notifyOpened?.(entry);
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

  // ── entry: open / new ──
  server.registerTool(
    "open_project",
    { description: "base64 の .slidecraft を開く（host では新しいドキュメントとして開く）", inputSchema: { dataBase64: z.string() } },
    (a, extra) => (host ? openInHost(withContract((s) => S.openProjectBytes(s, unb64(a.dataBase64))), extra) : mutate(extra, undefined, "open_project", withContract((s) => S.openProjectBytes(s, unb64(a.dataBase64))))),
  );
  server.registerTool(
    "new_project",
    { description: "base64 の .pptx テンプレートと（任意の）Markdown から新規作成（host では新ドキュメントを mint）。GUI の Draft と同じ整形。書式は get_authoring_guide・図は get_diagram_types。テンプレ base64 が無ければ create_template で生成できる", inputSchema: { templateBase64: z.string(), markdown: z.string().optional() } },
    (a, extra) => (host ? openInHost(withContract((s) => S.newProject(s, unb64(a.templateBase64), a.markdown)), extra) : mutate(extra, undefined, "new_project", withContract((s) => S.newProject(s, unb64(a.templateBase64), a.markdown)))),
  );

  // ── reads ──
  server.registerTool("get_deck", { description: "現在の deck（DeckIR JSON）。resource `deck://current` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getDeck(sessionOf(extra, a.docId))));
  server.registerTool("get_deck_markdown", { description: "deck 全体を round-trip 可能な Markdown で。`deck://markdown` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getDeckMarkdown(sessionOf(extra, a.docId))));
  server.registerTool("get_slide_markdown", { description: "1スライドの Markdown（auto レイアウト解決済み）。`slide://{index}/markdown` の確実版", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => S.getSlideMarkdown(sessionOf(extra, a.docId), a.index)));
  server.registerTool("get_slide", { description: "1スライドの構造化 read（1呼び出しで編集計画）：resolvedLayout・hasFigure/figureKind・bulletCount・budget・overBudget・当該スライドの issues・markdown。素の Markdown だけなら get_slide_markdown", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => R.getSlide(sessionOf(extra, a.docId), a.index)));
  server.registerTool("get_deck_issues", { description: "deck の診断＝CONTENT レバー（split/condense/visualize/title）＋本文 budget＋次の一手 hints。`deck://issues` のミラー。※ export 可否は validate_deck", inputSchema: doc }, (a, extra) => run(() => { const d = S.getDiagnostics(sessionOf(extra, a.docId)); return { ...d, hints: N.nextStepHints(d.issues) }; }));
  server.registerTool("get_template_capabilities", { description: "テンプレートの能力サマリ＋レイアウト一覧（生成のプロンプト文脈）。`deck://capabilities` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getCatalog(sessionOf(extra, a.docId))));
  server.registerTool("get_project_info", { description: "現在のプロジェクトのメタ情報。`deck://info` のミラー", inputSchema: doc }, (a, extra) => run(() => S.getProjectMeta(sessionOf(extra, a.docId))));
  server.registerTool("get_slide_fix_request", { description: "1スライドの修正リクエスト packet（agent が LLM として埋め、set_slide_markdown で適用）", inputSchema: { ...index, ...doc } }, (a, extra) => run(() => S.getSlideFix(sessionOf(extra, a.docId), a.index)));

  // ── authoring contract (self-describing surface; T3/S1) ── the single entry the AI reads BEFORE
  // authoring: how to write this template's slide Markdown, the body budget, and pointers to figures.
  server.registerTool("get_authoring_guide", { description: "スライド Markdown の書き方（このテンプレのレイアウト名に解決した書式・`<!-- col/kpi/step -->` 区切り・表(GFM)・コード）＋本文 budget＋図/テンプレ作成ガイドへの入口。スライドを書く前にまずこれを読む", inputSchema: doc }, (a, extra) => run(() => G.getAuthoringGuide(sessionOf(extra, a.docId))));
  server.registerTool("get_diagram_types", { description: "図の種類メニュー（authorable な12種＝type/label/hint）。図を入れるならまずここで種類を選ぶ（flowchart 以外に11種ある）" }, () => run(() => G.getDiagramTypes()));
  server.registerTool("get_diagram_guide", { description: "選んだ図タイプの構文＋JSON例（```diagram に書く DiagramSpec）。class/state/ER/mindmap は type ではなく ```mermaid で描く", inputSchema: { type: z.string().describe("get_diagram_types の type") } }, (a) => run(() => G.getDiagramGuide(a.type)));

  // ── template provisioning (T3/S2) ── acquire a template with no bytes: create one from a spec (or the
  // MIDNIGHT preset). Session-independent; hand the returned templateBase64 to new_project to start.
  server.registerTool("create_template", { description: "TemplateSpec（name＋fonts＋9色 palette・layouts 既定30）からテンプレ PPTX を生成し base64 で返す。欠落は MIDNIGHT preset で補完＋低コントラストは自動修正（notices で告知）。書式は get_template_spec_guide。返した templateBase64 を new_project に渡して着手", inputSchema: { spec: z.string().optional().describe("TemplateSpec JSON（部分可・省略で MIDNIGHT preset）") } }, (a) => run(() => T.createTemplate(a.spec)));
  server.registerTool("get_template_spec_guide", { description: "create_template 用 TemplateSpec の書式ガイド＋MIDNIGHT preset 値（開始点）" }, () => run(() => T.getTemplateSpecGuide()));

  // ── deterministic mutations ──
  server.registerTool("set_slide_markdown", { description: "1スライド（index 指定）を Markdown で差し替え。既存の図/mermaid は自動保持。zod 検証・不正は never-silent で拒否。書式は get_authoring_guide（区切り・表/コード）", inputSchema: { ...index, markdown: z.string(), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "set_slide_markdown", (s) => S.applySlideMarkdown(s, a.index, a.markdown), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("set_deck_markdown", { description: "⚠️ deck 全体を置換（スライド数が変わりうる・図は自動保持されない）。1枚だけ直すなら set_slide_markdown を使うこと", inputSchema: { markdown: z.string(), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "set_deck_markdown", (s) => S.applyDeckMarkdown(s, a.markdown), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("split_overflowing_slides", { description: "決定論レバー: 溢れた本文スライドをフォント縮小なしで分割", inputSchema: { ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "split_overflowing_slides", (s) => S.distill(s), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("convert_bullets_to_table", { description: "決定論レバー: key-value 箇条書きを GFM 表に", inputSchema: { ...index, ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "convert_bullets_to_table", (s) => S.visualizeKeyValue(s, a.index), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool(
    "set_slide_diagram",
    { description: "図に【何を】置くか：DiagramSpec(yaml/json) or Mermaid で設定（検証＋native YAML 化）。図/mermaid を持つスライドは置換、text スライドは body 領域へ図を追加（created で判別）。配置・レイアウトの調整は apply_design_intent", inputSchema: { ...index, source: z.string(), format: z.enum(["yaml", "json", "mermaid"]), placeholderIdx: z.string().optional().describe("body 領域の 1-based ordinal（multi-body 用・既定 1）"), ...doc, ...cc } },
    (a, extra) => mutate(extra, a.docId, "set_slide_diagram", (s) => S.setDiagram(s, a.index, a.source, a.format, a.placeholderIdx), { opId: a.opId, expectedRev: a.expectedRev }),
  );
  server.registerTool(
    "apply_design_intent",
    {
      description: '図を【どう配置するか】（design edit）：ops 配列の JSON で regionSplit(text-left/right/diagram-only) / emphasize(nodeId) / relayout(TB/LR/RL/BT)。エンジンが座標を計算＋クランプ。図/mermaid を持つスライドのみ。図の中身そのものは set_slide_diagram。例: [{"op":"relayout","direction":"LR"}]',
      inputSchema: { ...index, intent: z.string(), ...doc, ...cc },
    },
    (a, extra) => mutate(extra, a.docId, "apply_design_intent", (s) => S.applyDesignIntent(s, a.index, a.intent), { opId: a.opId, expectedRev: a.expectedRev }),
  );
  // ── structure ops (T2/S4) ── surgical add/remove/reorder/duplicate a slide; the SURVIVING slides'
  // figures/layouts stay byte-identical (set_deck_markdown drops them). Prefix insert_/delete_/move_/
  // duplicate_ = structure vs set_/apply_/convert_/split_ = content, so the verb alone routes the AI.
  server.registerTool("insert_slide", { description: "新しいスライドを Markdown から index の前/後に挿入（他スライドの図は保持＝set_deck_markdown と違い surgical）。書式は get_authoring_guide", inputSchema: { ...index, markdown: z.string(), position: z.enum(["before", "after"]).optional().describe("index の前/後（既定 before）"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "insert_slide", (s) => St.insertSlide(s, a.index, a.markdown, a.position), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("delete_slide", { description: "index のスライドを削除（最後の1枚は never-silent 拒否・deletedMd を返す）", inputSchema: { ...index, ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "delete_slide", (s) => St.deleteSlide(s, a.index), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("move_slide", { description: "スライドを fromIndex から toIndex へ移動（純並べ替え・図/レイアウト保持。from===to は no-op）", inputSchema: { fromIndex: z.number().int().describe("移動元 0-based"), toIndex: z.number().int().describe("移動先 0-based"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "move_slide", (s) => St.moveSlide(s, a.fromIndex, a.toIndex), { opId: a.opId, expectedRev: a.expectedRev }));
  server.registerTool("duplicate_slide", { description: "index のスライドを複製（structuredClone で図/表/コードを byte-identical に複製）。既定で後ろに挿入", inputSchema: { ...index, position: z.enum(["before", "after"]).optional().describe("複製の挿入位置（既定 after）"), ...doc, ...cc } }, (a, extra) => mutate(extra, a.docId, "duplicate_slide", (s) => St.duplicateSlide(s, a.index, a.position), { opId: a.opId, expectedRev: a.expectedRev }));

  server.registerTool("validate_deck", { description: "EXPORT ゲート：schema 検証＋変換不能 mermaid スキャン→exportReadiness。※ 内容の手直し（溢れ/冗長/表化）は get_deck_issues", inputSchema: doc }, (a, extra) => run(() => S.validate(sessionOf(extra, a.docId))));

  // ── persist / export (base64 over stdio) ──
  server.registerTool("save_project", { description: ".slidecraft を生成し base64 で返す", inputSchema: doc }, (a, extra) => run(async () => ({ dataBase64: b64(await S.saveProjectBytes(sessionOf(extra, a.docId))) })));
  server.registerTool(
    "export_pptx",
    { description: ".pptx を native-vector で headless 生成し base64 で返す（変換不能 mermaid は default reject / skip）", inputSchema: { onUnsupportedMermaid: z.enum(["reject", "skip"]).optional(), ...doc } },
    (a, extra) =>
      run(async () => {
        const { bytes, skipped } = await S.exportPptxBytes(sessionOf(extra, a.docId), a.onUnsupportedMermaid ?? "reject");
        return { dataBase64: b64(bytes), skipped };
      }),
  );

  // ── host-only: multi-doc lifecycle + server-side undo ──
  if (host) {
    server.registerTool("list_documents", { description: "開いているドキュメント一覧（AI クライアントは共有docのみ＝private-by-default）。各docに contract（書式ダイジェスト）付き", }, (extra) =>
      run(() => ({
        documents: host.registry.list({ sharedOnly: host.sharedOnly }).map((d) => {
          const c = safeContract(host.registry.get(d.docId).session); // so the list→operate flow carries the contract
          return c ? { ...d, contract: c } : d;
        }),
        activeDocId: host.active(extra) ?? null,
      })),
    );
    server.registerTool("select_document", { description: "このコネクションの対象ドキュメントを切り替える（AI 版 switchDoc。deck は変えない）", inputSchema: { docId: z.string() } }, ({ docId }, extra) =>
      run(() => {
        const e = host.registry.get(docId);
        host.setActive(extra, docId);
        // The AI may enter a doc via select — carry the contract here too (also on open/new + list_documents).
        const c = safeContract(e.session);
        return { docId: e.docId, slideCount: e.session.deck?.slides.length ?? 0, rev: e.rev, ...(c ? { contract: c } : {}) };
      }),
    );
    server.registerTool("close_document", { description: "ドキュメントを閉じる（dirty は force 必須＝never-silent）", inputSchema: { docId: z.string(), force: z.boolean().optional() } }, ({ docId, force }) =>
      run(() => {
        const e = host.registry.get(docId);
        if (e.session.dirty && !force) return { ok: false as const, closed: false as const, dirty: true as const };
        host.registry.remove(docId);
        host.notifyClosed?.(docId);
        return { ok: true as const, closed: true as const };
      }),
    );
    server.registerTool("undo", { description: "サーバ側 Undo：このドキュメントの真実を1手戻す（新しい forward rev を発行）", inputSchema: doc }, (a, extra) =>
      run(() => {
        const e = entryOf(extra, a.docId);
        const r = undoDoc(e);
        if (r.ok) {
          opts.onMutate?.("undo");
          host.onMutated?.(e, "undo");
        }
        return { ...r, docId: e.docId };
      }),
    );
    server.registerTool("redo", { description: "サーバ側 Redo：直前の Undo を取り消す", inputSchema: doc }, (a, extra) =>
      run(() => {
        const e = entryOf(extra, a.docId);
        const r = redoDoc(e);
        if (r.ok) {
          opts.onMutate?.("redo");
          host.onMutated?.(e, "redo");
        }
        return { ...r, docId: e.docId };
      }),
    );
  }

  // ── read-only deck state as MCP resources (deck://… , slide://{i}/markdown) ──
  // Opt-out in host/collab mode: the GUI is the human's surface there, so resources are orphaned.
  if (opts.registerResources !== false && !host) registerResources(server, session);

  return server;
}
