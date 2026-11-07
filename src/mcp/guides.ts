/**
 * guides.ts — the SELF-DESCRIBING authoring contract exposed to the upstream AI (Theme 3, S1).
 *
 * The engine ALREADY holds the authoring knowledge: `slideSystemPrompt` (L1 slide format) and the
 * two-stage diagram prompts (`diagramRoutePrompt` menu + `diagramSystemPrompt(type)` per-type). This
 * MCP-layer module EXPOSES that knowledge over tools — it invents no new guidance and calls no model
 * (harness-over-model). It lives in src/mcp (not src/engine) because its manifest pointers reference
 * MCP TOOL NAMES; keeping those out of src/engine preserves engine purity (R2). See
 * docs/design/mcp-brushup.md §F.
 */
import type { Session } from "./session";
import * as S from "./session";
import { slideSystemPrompt } from "../engine/llm-prompts";
import { diagramSystemPrompt, DIAGRAM_TYPES, parseDiagramType } from "../engine/diagram-type-prompts";
import { VALID_TYPES } from "../engine/schema-constants";
import { reviewRuleStates } from "../engine/review-rule-toggle";

/** L1 + manifest — the slide-Markdown authoring contract for THIS template (catalog-resolved layout
 *  names + selection rules = alien-safe), the body budget to author WITHIN, and pointers to the
 *  diagram / template-spec guides. This is the single ENTRY the AI reads before authoring; it requires
 *  an open project (never-silent via requireLoaded) so the layout names are the real template's. */
export function getAuthoringGuide(s: Session) {
  const { entries, budget } = S.entriesAndBudget(s); // requireLoaded inside → never-silent if no project open
  return {
    format: slideSystemPrompt(entries),
    budget, // this template's body capacity (maxBullets/charsPerBullet) — keep each content slide within it
    capacity:
      "容量は get_slide(i) / get_deck_issues で実測できる：capacity.usedLines/maxLines（全角換算の保守的推定）・overBudget・predictedSplit（split_overflowing_slides の dry-run、実行せず何枚に割れるか）",
    // #244: this deck's review rules ({id, level}), read BEFORE authoring so the first draft is already
    // clean — a literal projection of deck-diagnostics.ts's REVIEW_RULES, the SAME registry
    // get_deck_issues draws its DeckIssue.id/level from (R8: one source, no drift between the two).
    // #247: a rule switched off by set_review_rules reads level:"off" (and get_deck_issues drops it) —
    // both from the same session set via review-rule-toggle.ts. Nothing off → exactly REVIEW_RULES.
    activeReviewRules: reviewRuleStates(s.disabledReviewRules),
    // #521 (ADR-0037 D3 "the server speaks the contract"): the result/authoring contract lines that
    // previously lived ONLY in SKILL.md. SKILL.md is now the order of operations; these ride the guide
    // (= bootstrap.authoringGuide) so the AI reads them in the same cold call. Moved, not invented —
    // each line mirrors docs/mcp-server.md (成否判定 #246 / envelope / エラー契約 / PPTX 出力の制約).
    contract: {
      success:
        "成否判定は 1 行：成功＝結果に {ok:false} も isError:true も無いこと。read 系と export_pptx は payload をそのまま返し ok キーを持たない（無い＝成功）。{ok:false, error, code} はモデル化済みの拒否（正常な戻り・クラッシュではない）— error を読んで直して再実行する。isError:true は未モデル化クラッシュ専用",
      mutationEnvelope:
        "内容 mutation は {ok, changed, beforeMd?, afterMd?, diagnostics, budget?, hints} を返す。changed:false は本当の no-op（undo 対象なし）。hints が次に呼ぶツール（溢れ→split_overflowing_slides・key-value→convert_bullets_to_table）",
      editing: "1 枚直すなら set_slide_markdown（図/mermaid を自動保持）。set_deck_markdown は deck 全体の置換で図を保持しないので単スライド編集には使わない",
      layouts:
        "レイアウト名は上の format の一覧（このテンプレに解決済み）から選ぶ。無指定は role ベースで自動解決（autoSelectLayout）。このテンプレに無い名前を pin しても自動解決に代替され、get_deck_issues が unknown-layout-pin で告知する（役割/レイアウト名は著者が増やせない）",
      images: "埋め込み画像は ![alt](data:image/…;base64,…) の data URI のみ（可搬・XSS 安全）。他のスキーム（http/相対パス）は画像にならずテキスト扱い",
      export:
        "export_pptx は native-vector のみ。変換不能な Mermaid（gitGraph / sankey / C4 等）は onUnsupportedMermaid=reject（既定・正確なエラー）か skip（そのスライドを落として skipped で報告）— 黙って消えることはない。事前に validate_deck の exportReadiness で確認できる",
    },
    seeAlso: {
      figures: "図を入れるなら get_diagram_types で種類を選び、get_diagram_guide(type) で構文を得る",
      templateSpec: "新しいテンプレを作るなら get_template_spec_guide（→ create_template）",
      reviewRules: "activeReviewRules の各 id の詳細は get_deck_issues の指摘メッセージで実例を確認できる",
      toolNotes: "ツール共通の約束（docId 解決・0-based・図/配置の op 文法・構造操作の保持規則）は bootstrap の toolNotes 節",
    },
  };
}

/** #513 (ADR-0037 D2/D3): the per-tool notes MOVED OUT of the hot tool descriptions — tools/list is
 *  re-sent every session, so each description keeps only "what it does + a pointer", and the detail
 *  lives here ONCE (R8: the shared docId/opId/expectedRev notes used to repeat on every tool). Served
 *  as bootstrap's first section (available before a doc is open). tests/mcp-tool-descriptions.test.ts
 *  holds the moved-item checklist and the design-intent grammar agreement with DesignIntentSchema. */
export const TOOL_NOTES = {
  docId:
    "docId は省略可：省略時はこのコネクションの選択 doc → 唯一の open doc の順に解決。どちらも無ければ document-not-selected で拒否（select_document か docId を指定）",
  concurrency:
    "opId / expectedRev は GUI クライアント用（host のみ・AI は省略）：opId はクライアント生成の操作 ID（自分の deckChanged の echo 抑制）、expectedRev が現在 rev と不一致なら {ok:false, stale:true} で拒否（新しい rev を上書きしない）",
  index: "index / fromIndex / toIndex は 0-based",
  validation: "内容 mutation の入力は zod 検証され、不正は {ok:false} で never-silent に拒否される",
  resources:
    "read 系の一部は MCP resource のミラー：get_deck=deck://current・get_deck_markdown=deck://markdown・get_slide_markdown=slide://{index}/markdown（ツール版が確実）・get_deck_issues=deck://issues・get_template_capabilities=deck://capabilities・get_project_info=deck://info",
  getSlide:
    "get_slide(i) は 1 回で編集計画に足る：resolvedLayout・hasFigure/figureKind・bulletCount・budget・overBudget・capacity（本文容量の実測 usedLines/maxLines）・predictedSplit（split_overflowing_slides の dry-run）・当該スライドの issues・markdown。素の Markdown だけなら get_slide_markdown（auto レイアウト解決済み）",
  fixRequest: "get_slide_fix_request は修正リクエスト packet を返す。agent 自身が LLM として埋め、set_slide_markdown で適用する",
  visual:
    "get_slide_image / get_deck_image は共有 HTML 描画（フォント埋め込み済・preview/HTML 書き出しと同一）をローカルの Chrome/Edge で画面なし・ネット遮断・使い捨てプロファイルで撮影する。ブラウザ未検出時は環境変数 SLIDECRAFT_BROWSER でパス指定。get_slide_html / get_deck_html は同一描画の自己完結 HTML（script ゼロ・CSP・フォント埋め込み済）で、Chrome/Edge が無い環境では呼び出し側がラスタ化する",
  diagram:
    "set_slide_diagram は図の【中身】：source に DiagramSpec（yaml/json）か Mermaid を文字列で渡し format で種別を指定（検証＋native YAML 化）。図/mermaid のあるスライドは置換、text スライドは body 領域へ追加（created で判別）。placeholderIdx は multi-body レイアウトで何番目の body か（1-based・既定 1）。各図タイプの構文と JSON 例は get_diagram_guide(type)",
  designIntent:
    "apply_design_intent は図の【配置】：intent に ops 配列の JSON 文字列。op は regionSplit{arrangement: text-left | text-right | diagram-only}・emphasize{nodeId, level: high | medium（既定 high）}・relayout{direction: TB | LR | RL | BT}。エンジンが座標を計算＋クランプする。図/mermaid のあるスライドのみ",
  structure:
    "構造 4 本（insert/delete/move/duplicate_slide）は surgical：他スライドの図/レイアウトは byte-identical に保たれる（set_deck_markdown は保たない）。insert_slide の position 既定 before・duplicate_slide は structuredClone 複製で既定 after・move_slide の from===to は no-op・delete_slide は最後の 1 枚を拒否し deletedMd を返す",
} as const;

/** The contract DIGEST that rides EVERY session-entry return (open/new/select_document) — the
 *  unskippable push channel (§F ②). Anchor-type: only what the AI can't guess (this template's real
 *  layout NAMES + the region-separator placement) + the body budget + pointers to the full guide and
 *  the figure vocabulary. Kept lean because it ships on every entry; depth is PULLED via
 *  get_authoring_guide / get_diagram_types. */
export function contractDigest(s: Session) {
  const { entries, budget } = S.entriesAndBudget(s);
  return {
    layouts: entries.map((e) => e.name),
    budget,
    capacity: "容量は get_slide(i) で実測できる（capacity.usedLines/maxLines・overBudget・predictedSplit）",
    separators:
      "多領域レイアウト（columns/kpi/process）は各リージョンの前に `<!-- col -->` / `<!-- kpi -->` / `<!-- step -->` を1つずつ置く（先頭より前の内容は無視される）。2 案の対比は `<!-- compare -->` を 2 つ、変化の前後（As-is→To-be）は `<!-- before -->` → `<!-- after -->` の順に 1 つずつ（比較レイアウト＋矢印＋Before/After ラベル）",
    notes:
      "スピーカーノートは `<!-- note -->` を単独行で置き、以降スライド末尾（次の `---`）までが素の Markdown のノート本文（#150）。スライドは疎に・詳細はノートへ",
    sections:
      "章は著者が書く章扉スライドに `<!-- section -->` タグ（章名は `#` 見出しのまま）。`<!-- toc -->` のみのブロックは目次の派生スライドで、内容は常に章一覧から自動導出（手書き不可・#151）",
    seeAlso: { format: "get_authoring_guide", figures: "get_diagram_types" },
  };
}

/** L2 stage-1 — the diagram TYPE menu (label + one-line routing hint) so the AI knows the full
 *  vocabulary exists (not just flowchart), then pulls one type's shape via getDiagramGuide. Only the
 *  12 authorable DiagramSpec types; class/state/ER/mindmap are reachable via ```mermaid, not as types. */
export function getDiagramTypes() {
  return { types: VALID_TYPES.map((type) => ({ type, label: DIAGRAM_TYPES[type].label, hint: DIAGRAM_TYPES[type].hint })) };
}

/** L2 stage-2 — the fields + a concrete example for ONE chosen type (shared base + that type's shape
 *  fragment). An unknown type is rejected never-silently with the way to discover valid ones. */
export function getDiagramGuide(typeRaw: string) {
  const type = parseDiagramType(typeRaw);
  if (!type) {
    return { ok: false as const, error: `未知の図タイプです: ${typeRaw}。get_diagram_types の type を使ってください。` };
  }
  return { type, guide: diagramSystemPrompt(type) };
}
