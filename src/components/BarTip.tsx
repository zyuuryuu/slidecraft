/**
 * BarTip.tsx — 上部バーのボタンの説明（以前の `title=`）を shadcn/ui の Tooltip で出す（#724 段 1 PR-A）。
 *
 * - 有効なボタン: ボタンそのものを Tooltip の trigger にする（`render` で 1 つの要素に合成＝DOM は増えない）。
 * - disabled のボタン: disabled の要素はポインタのイベントを出さないので Tooltip が開かない。span で包み、
 *   span を trigger にする（「なぜ押せないか」の説明＝協働中のロック等を、押せないときこそ見せる）。
 * Tooltip は見た目だけの補助（Base UI の指針）。記号だけのボタン（↶ ↷ ⚙）は aria-label で名前を持つこと。
 */
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BarTipProps {
  /** 説明の文言（辞書を通した値）。 */
  label: string;
  /** ボタンが disabled か（true → span で包む）。 */
  disabled?: boolean;
  /** 説明を付けるボタン（1 要素）。 */
  children: ReactElement;
}

export default function BarTip({ label, disabled = false, children }: BarTipProps) {
  return (
    <Tooltip>
      {disabled ? (
        <TooltipTrigger render={<span className="inline-flex min-w-0" />}>{children}</TooltipTrigger>
      ) : (
        <TooltipTrigger render={children} />
      )}
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
