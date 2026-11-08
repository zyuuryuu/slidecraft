/**
 * ux-budget-probes.ts — tests/ux-budget.test.tsx が使う「数える道具」（#648・ADR-0039）。
 * 予算の数値はここに置かない（数値は ux-budget.test.tsx だけが持つ＝R8）。
 *
 *  - i18nLeaks(file): TSX の画面に直書きされた文言（i18n の辞書を通らない文言）を列挙する。
 *  - menuDepth(html): 描画した HTML で、メニュー項目に届くまでの段数を数える。
 *  - groupItems(html) / isSegmentRow: メニューの区画ごとの項目数（セグメント行＝1 項目）。
 */
import ts from "typescript";

/** 文字（英字・ひらがな・カタカナ・漢字）を含むか。記号・数字・絵文字だけのラベル（↶ ⚙ ▾ 12）は文言ではない。 */
const WORDY = /[A-Za-z぀-ヿ㐀-鿿]/;
/** 利用者に読ませる属性。辞書を通さず文字列を直接書いたら漏れ。 */
const TEXT_ATTRS = new Set(["title", "aria-label", "placeholder"]);

export interface Leak {
  line: number;
  kind: "text" | "title" | "aria-label" | "placeholder";
  text: string;
}

/** 属性の値・JSX の子として「そのまま表示される位置」にある文字列リテラルを集める。
 *  t("key") の引数・比較の相手（`x === "locked"`）・オブジェクトの鍵は表示されないので見ない。 */
function displayedLiterals(e: ts.Expression, out: string[]): void {
  if (ts.isParenthesizedExpression(e)) return displayedLiterals(e.expression, out);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { out.push(e.text); return; }
  if (ts.isTemplateExpression(e)) {
    out.push([e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" "));
    return;
  }
  if (ts.isConditionalExpression(e)) { displayedLiterals(e.whenTrue, out); displayedLiterals(e.whenFalse, out); return; }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      displayedLiterals(e.left, out);
      displayedLiterals(e.right, out);
    } else if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.PlusToken) {
      if (op === ts.SyntaxKind.PlusToken) displayedLiterals(e.left, out);
      displayedLiterals(e.right, out);
    }
  }
}

/** TSX のソースから i18n を通らない文言を列挙する（コメントは AST に乗らないので自動的に除外される）。 */
export function i18nLeaks(source: string, fileName = "x.tsx"): Leak[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const leaks: Leak[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (n: ts.Node, kind: Leak["kind"], raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (WORDY.test(text)) leaks.push({ line: at(n), kind, text });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) push(n, "text", n.text);
    else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      const lits: string[] = [];
      displayedLiterals(n.expression, lits);
      for (const s of lits) push(n, "text", s);
    } else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const kind = n.name.getText(sf) as Leak["kind"];
      const init = n.initializer;
      if (ts.isStringLiteral(init)) push(init, kind, init.text);
      else if (ts.isJsxExpression(init) && init.expression) {
        const lits: string[] = [];
        displayedLiterals(init.expression, lits);
        for (const s of lits) push(init, kind, s);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return leaks;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** 描画した HTML で、ボタンに届くまでに開くポップアップ（class に `absolute` を持ち、ボタンを含む箱）の数＋1
 *  の最大値。上部バーのボタン＝1、⚙ を開いた中の項目＝2、その中からさらに開く項目＝3。
 *  すべての開閉状態を「開」にして描画した HTML に使う（ux-budget.test.tsx の forceOpen）。 */
export function menuDepth(html: string): { depth: number; deepest: string[] } {
  type Frame = { tag: string; popup: boolean };
  const stack: Frame[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const found: Array<{ depth: number; at: number }> = [];
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const [, close, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      const i = stack.map((f) => f.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    if (tag === "button") found.push({ depth: stack.filter((f) => f.popup).length + 1, at: m.index });
    if (VOID.has(tag) || selfClose) continue;
    const cls = attrs.match(/\sclass="([^"]*)"/)?.[1] ?? "";
    stack.push({ tag, popup: cls.split(/\s+/).includes("absolute") });
  }
  // A positioned box with no button inside (a badge, a tooltip) is not a menu: only boxes that hold a button count,
  // which the per-button ancestor count above already guarantees.
  const depth = Math.max(0, ...found.map((f) => f.depth));
  const deepest = found
    .filter((f) => f.depth === depth)
    .map((f) => html.slice(f.at).match(/<button[^>]*>([\s\S]*?)<\/button>/)?.[1].replace(/<[^>]+>/g, "").trim() ?? "");
  return { depth, deepest };
}

/** セグメント行（同じ軸の選択肢を横に並べた 1 行・ThemeToggle／LanguageToggle／HtmlTransitionPicker）か。
 *  判定はここだけ（R8）: role="group" の直下が、押し状態（aria-pressed）を持つボタンだけで 1 個以上。
 *  セグメント行は「1 つの値を選ぶ 1 チャンク」なので、メニューの区画ではなく区画の 1 項目と数える
 *  （docs/design/ux-principles.md §3・#674）。 */
export function isSegmentRow(children: ReadonlyArray<{ button: boolean; pressed: boolean }>): boolean {
  return children.length > 0 && children.every((c) => c.button && c.pressed);
}

/** 描画した HTML の `role="group"`（メニューの区画）ごとに、ボタンを含む直下の要素（＝項目）を数える。
 *  見出し・区切り線はボタンを含まないので数えない。スクロールする一覧（マスターの一覧）は 1 項目。
 *  セグメント行（isSegmentRow）は区画として返さず、それを含む区画の 1 項目になる。 */
export function groupItems(html: string): Array<{ label: string; items: number }> {
  type Group = { label: string; items: number };
  type Frame = {
    tag: string;
    group?: Group;
    /** group の直下の要素（セグメント行の判定に使う）。 */
    kids?: Array<{ button: boolean; pressed: boolean }>;
    child?: { hasButton: boolean };
  };
  const stack: Frame[] = [];
  const out: Group[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const [, close, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      const i = stack.map((f) => f.tag).lastIndexOf(tag);
      if (i < 0) continue;
      for (let j = stack.length - 1; j >= i; j--) {
        const f = stack[j];
        const parent = stack[j - 1];
        if (f.child?.hasButton && parent?.group) parent.group.items++;
        if (f.group && f.kids && isSegmentRow(f.kids)) out.splice(out.indexOf(f.group), 1);
      }
      stack.length = i;
      continue;
    }
    if (tag === "button") for (const f of stack) if (f.child) f.child.hasButton = true;
    const parent = stack[stack.length - 1];
    parent?.kids?.push({ button: tag === "button", pressed: /\saria-pressed="/.test(attrs) });
    if (VOID.has(tag) || selfClose) continue;
    const frame: Frame = { tag };
    if (/\srole="group"/.test(attrs)) {
      frame.group = { label: attrs.match(/\saria-label="([^"]*)"/)?.[1] ?? "", items: 0 };
      frame.kids = [];
      out.push(frame.group);
    }
    if (parent?.group) frame.child = { hasButton: tag === "button" };
    stack.push(frame);
  }
  return out;
}
