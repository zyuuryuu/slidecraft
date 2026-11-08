/**
 * density-hint.ts — #596（#580 段 2-d）: テンプレの密度の目標帯（StylePreset.density）を超えたスライドに
 * info を 1 件ずつ出す純関数（R2）。
 *
 * - 目標はテンプレのメタ（style-meta.ts → TemplateData.styleDensity）の 1 経路だけから読む（R8）。目標が無い
 *   テンプレ（既存テンプレすべて）では何も出さない＝既存デッキの診断は不変。
 * - 数えるのは本文枠（idx 1〜9）ごとの段落。タイトル・サブタイトル・メタ行（Takeaway 等）は本文ではない。
 *   グループ（card / kpi / step / compare）の見出し（### 行）は項目のラベルなので行に数えない。
 * - 行数は「段落の数」（1 項目 1 行の箇条を想定する目標帯なので、折り返しの見積りは使わない）。長すぎる
 *   1 行は maxLineChars で別に見る。容量（溢れ）は body-overflow の担当で、ここは編集方針の提案だけ。
 * - 1 枚に 1 件（どの枠がどれだけ超えたかを 1 つのメッセージにまとめる）。
 */
import type { DeckIR, Paragraph } from "./slide-schema";
import type { DeckIssue } from "./deck-diagnostics";
import { RULE_LEVEL } from "./review-rules";
import { hasDensityTargets, type StyleDensity } from "./style-meta";
import { slideRoleContent } from "./title-fit"; // deck-diagnostics と同じタイトルの取り方（R8）

const BODY_IDX = /^[1-9]$/;
const textOf = (p: Paragraph) => p.segments.map((s) => s.text).join("");
const charCount = (p: Paragraph) => [...textOf(p)].length;

export function densityIssues(deck: DeckIR, density: StyleDensity | undefined): DeckIssue[] {
  if (!hasDensityTargets(density)) return [];
  const { maxBodyLines, maxLineChars } = density;
  const issues: DeckIssue[] = [];
  deck.slides.forEach((slide, i) => {
    let lines = 0;
    let longest = 0;
    for (const ph of slide.placeholders) {
      if (!BODY_IDX.test(ph.idx)) continue;
      const paras = ph.paragraphs.filter((p) => !p.heading && textOf(p).trim());
      lines = Math.max(lines, paras.length);
      for (const p of paras) longest = Math.max(longest, charCount(p));
    }
    const over: string[] = [];
    if (maxBodyLines !== undefined && lines > maxBodyLines) over.push(`本文 ${lines} 行（目標 ${maxBodyLines} 行以内）`);
    if (maxLineChars !== undefined && longest > maxLineChars) over.push(`1 行 ${longest} 字（目標 ${maxLineChars} 字以内）`);
    if (over.length === 0) return;
    const head = slideRoleContent(slide, "title")?.paragraphs[0];
    const title = head ? textOf(head) : "";
    issues.push({
      slideIndex: i,
      title,
      id: "density-target",
      level: RULE_LEVEL["density-target"],
      levers: ["condense", "split"],
      message: `このテンプレートの目標帯を超えています: ${over.join("・")}。1 枚 1 メッセージに絞り、補足はノートか別スライドへ`,
    });
  });
  return issues;
}
