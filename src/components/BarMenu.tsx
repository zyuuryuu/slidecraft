/**
 * BarMenu.tsx — 上部バーのメニュー（保存・書き出し／🎨 テンプレート／⚙）に共通の部品（#724 段 1 PR-B）。
 * 土台は shadcn/ui の DropdownMenu（Base UI の Menu）。開閉・Portal・矢印キー・Esc・外側クリック・項目を押したら
 * 閉じる、は部品が担う。ここは 3 つのメニューで見た目と区画の形を揃えるためだけに置く。
 *
 * - 区画（BarMenuSection）: `role="group"`＋`aria-label`（UX 予算の probes が数える単位・#674）。見出しを見せる区画は
 *   DropdownMenuLabel、2 つ目以降の区画の前に DropdownMenuSeparator。
 * - 項目（BarMenuItem）: Base UI の Menu.Item を **ネイティブの `<button>`** で描く（`nativeButton`）。role は menuitem。
 *   押せない項目は `aria-disabled`（WAI-ARIA の推奨どおりフォーカスは受ける＝矢印キーで理由を読める）。
 *   押せない項目は `title` を持たない（#739-2）: 部品が押せない項目を pointer-events-none にするのでホバーで読めない。
 *   押せない理由は項目の中に見える文字（MasterMenu の note 等）で出す。
 * - 項目でない行（言語・配色の切り替え、HTML の遷移の切り替え）はそのまま置く。矢印キーの移動は項目だけを渡るので
 *   それらを飛ばす（Tab では届く）。
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** メニューの箱。地・枠は部品の既定（bg-popover＝--canvas・ring）。影は以前の手製メニューに近い shadow-lg。 */
export function BarMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent className={cn("shadow-lg text-sm", className)} {...props} />;
}

/** 1 つの区画。`heading` を渡すと見出しを見せる（文字は区画の名前と同じ＝#692）。 */
export function BarMenuSection({ label, first, heading, headingClassName, headingTestId, children }: {
  label: string;
  first: boolean;
  heading?: boolean;
  headingClassName?: string;
  headingTestId?: string;
  children: ReactNode;
}) {
  return (
    <>
      {!first && <DropdownMenuSeparator />}
      <DropdownMenuGroup aria-label={label}>
        {heading && (
          <DropdownMenuLabel data-testid={headingTestId} className={cn("px-2.5 pt-1 pb-0.5 text-[10px] font-normal text-faint", headingClassName)}>
            {label}
          </DropdownMenuLabel>
        )}
        {children}
      </DropdownMenuGroup>
    </>
  );
}

/** 1 つの項目（`<button role="menuitem">`）。押すとメニューは閉じる（closeOnClick={false} で閉じない）。
 *  押せないとき（disabled）は title を描かない（ホバーで読めない説明を残さない・#739-2）。 */
export function BarMenuItem({ className, title, ...props }: Omit<ComponentProps<typeof DropdownMenuItem>, "nativeButton" | "render">) {
  return (
    <DropdownMenuItem
      nativeButton
      render={<button type="button" />}
      className={cn("w-full px-2.5 py-1.5 text-left text-fg", className)}
      title={props.disabled ? undefined : title}
      {...props}
    />
  );
}
