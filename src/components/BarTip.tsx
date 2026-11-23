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
 * 記号だけのボタン（↶ ↷ ⚙）は aria-label で名前を持つこと（Tooltip・説明は名前にならない）。
 */
import { cloneElement, useId, useState, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TipChildProps = { "aria-describedby"?: string; "aria-expanded"?: boolean | "true" | "false" };

interface BarTipProps {
  /** 説明の文言（辞書を通した値）。Tooltip と説明要素の両方にこの 1 つを使う。 */
  label: string;
  /** 説明を付けるボタン（1 要素）。 */
  children: ReactElement<TipChildProps>;
}

export default function BarTip({ label, children }: BarTipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const expanded = children.props["aria-expanded"];
  const menuOpen = expanded === true || expanded === "true";
  return (
    <Tooltip open={open && !menuOpen} onOpenChange={setOpen}>
      <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
        {cloneElement(children, { "aria-describedby": id })}
        <span id={id} hidden>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
