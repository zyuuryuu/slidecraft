/**
 * BarTip.tsx — 上部バーのボタンの説明（以前の `title=`）を shadcn/ui の Tooltip で出す（#724 段 1 PR-A）。
 *
 * - 構造は disabled でも有効でも同じ: span を Tooltip の trigger にし、その中にボタンを置く。disabled の要素は
 *   ポインタのイベントを出さないので、span が受ける（「なぜ押せないか」＝協働中のロック等を、押せないときこそ見せる）。
 *   構造を固定するので、disabled の切替でボタンが作り直されない（フォーカス・参照が保たれる）。
 * - 支援技術への説明: Base UI の Tooltip は role="tooltip" も aria-describedby も付けない（見た目だけの補助）。
 *   以前の `title=` が担っていた説明は、同じ label を常に描く説明要素（hidden）＋ボタンの aria-describedby で渡す。
 *   hidden の要素も aria-describedby の参照先にはなる（読み上げの「説明」になり、閲覧モードで二重に読まれない）。
 * - メニューを開いている入口（aria-expanded="true"）では Tooltip を開かない（開いたメニューの先頭行に重なるため）。
 * - メニューが閉じてフォーカスが入口に戻ったとき（Esc・項目を押したあと）も、その「戻ってきたフォーカス」では開かない
 *   （#724 PR-B: 開くと次の Esc を Tooltip が取り、原稿入力ダイアログの中では Esc を 3 回押さないと閉じなかった）。
 *   ポインタを乗せる・一度離れて再びフォーカスする、では従来どおり開く。
 * 記号だけのボタン（↶ ↷ ⚙）は aria-label で名前を持つこと（Tooltip・説明は名前にならない）。
 * - 包みの span はバーの flex の項目なので、既定では縮まない（shrink-0）。縮むのは中のボタン自身が縮めるとき
 *   （🎨 テンプレート＝名前を省略する）だけで、`shrink` を渡す。以前は全部 min-w-0 で、狭い窓で span だけが縮み、
 *   縮まないボタンが隣のボタンに重なっていた（#713 の幅確認で発見）。
 */
import { cloneElement, useId, useState, type ReactElement } from "react";
import type { TooltipRootChangeEventDetails } from "@base-ui/react/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TipChildProps = { "aria-describedby"?: string; "aria-expanded"?: boolean | "true" | "false" };

interface BarTipProps {
  /** 説明の文言（辞書を通した値）。Tooltip と説明要素の両方にこの 1 つを使う。 */
  label: string;
  /** 説明を付けるボタン（1 要素）。 */
  children: ReactElement<TipChildProps>;
  /** 中のボタンが狭い窓で縮む（名前を省略する）とき true。既定は縮まない。 */
  shrink?: boolean;
}

export default function BarTip({ label, children, shrink = false }: BarTipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const expanded = children.props["aria-expanded"];
  const menuOpen = expanded === true || expanded === "true";
  // The menu just closed → focus comes back to its trigger: skip the tooltip for THAT focus (adjust-state-on-change, no effect).
  const [wasMenuOpen, setWasMenuOpen] = useState(menuOpen);
  const [quiet, setQuiet] = useState(false);
  if (menuOpen !== wasMenuOpen) {
    setWasMenuOpen(menuOpen);
    setQuiet(!menuOpen);
    if (!menuOpen) setOpen(false); // a focus-open requested while the menu was still closing does not surface either
  }
  const onOpenChange = (next: boolean, details: TooltipRootChangeEventDetails) => {
    if (next && quiet && details.reason === "trigger-focus") return;
    if (next) setQuiet(false);
    setOpen(next);
  };
  return (
    <Tooltip open={open && !menuOpen} onOpenChange={onOpenChange}>
      <TooltipTrigger render={<span className={`inline-flex ${shrink ? "min-w-0" : "shrink-0"}`} onBlur={() => setQuiet(false)} />}>
        {cloneElement(children, { "aria-describedby": id })}
        <span id={id} hidden>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
