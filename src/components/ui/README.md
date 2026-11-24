# src/components/ui — shadcn/ui からコピーした部品

shadcn/ui（<https://ui.shadcn.com/>）の部品を `npx shadcn@latest add <名前>` でコピーした置き場（#724）。
npm の UI 本体は無く、ここのファイルがそのまま部品の実装になる。土台は **Base UI**（`@base-ui/react`・
shadcn CLI の既定 preset `base-nova`）。設定は リポジトリ直下の `components.json`。

| 部品 | ファイル | 使う場所 |
| --- | --- | --- |
| Button | `button.tsx` | 上部バーの 7 ボタン（`Toolbar.tsx`・`SettingsMenu.tsx`・`MasterPicker.tsx`） |
| Tooltip | `tooltip.tsx` | 上部バーのボタンの説明（以前の `title=`）。`../BarTip.tsx` 経由（説明は `aria-describedby` でも渡す）。`TooltipProvider`（delay 400ms＝`BAR_TOOLTIP_DELAY`）は `src/main.tsx` でアプリ全体に 1 つ |
| DropdownMenu | `dropdown-menu.tsx` | 上部バーのメニュー 3 つ（開く・保存・書き出し／🎨 テンプレート／⚙）。`../BarMenu.tsx`（区画・項目・箱）経由。項目は `nativeButton` で `<button role="menuitem">` |
| Popover | `popover.tsx` | AI 接続設定（AI ドックの状態ピル → `AiSettingsPopover`）。`AiPanel.tsx` |
| Dialog | `dialog.tsx` | 原稿入力（`InitializeModal.tsx`）・テンプレートを作成（`TemplateCreator.tsx`）。どちらも `showCloseButton={false}`（自前の × を `DialogClose` で置く）・`disablePointerDismissal`（背景クリックで閉じない） |

## 色の名前（トークン）の写像

shadcn の部品は `bg-primary`・`border-border` などの色名で書かれている。値は `src/index.css` の
「shadcn の別名」で**既存のトークンに写像するだけ**（値を持たない）なので、3 テーマ（dark／light／modern）で
自動的にそのテーマの色になる。

| shadcn の名前 | 既存のトークン | 意味 |
| --- | --- | --- |
| `--background` | `--canvas` | 本文の地 |
| `--foreground` | `--fg` | 文字 |
| `--card` ／ `--card-foreground` | `--panel` ／ `--fg` | パネル |
| `--popover` ／ `--popover-foreground` | `--canvas` ／ `--fg` | メニュー・ポップオーバー（既存の手製メニューと同じ地） |
| `--primary` ／ `--primary-foreground` | `--accent` ／ `--on-accent` | 主ボタン |
| `--secondary` ／ `--secondary-foreground` | `--edge` ／ `--fg` | 二次ボタン（既存の `bg-edge` ボタン） |
| `--muted-foreground` | `--muted` | 薄い文字 |
| `--accent-foreground` | `--fg` | — |
| `--destructive` | `--danger` | 削除などの危険操作 |
| `--border` ／ `--input` | `--edge` ／ `--edge2` | 枠・入力欄の枠 |
| `--ring` | `--fg` | フォーカスリング（主ボタン＝`--accent` の上でも地と分かれる。対 上部バー 3:1 以上） |
| `--radius` | `0.375rem`（6px） | 角丸。**このフォルダの部品だけ**が参照する（下の「角丸」）。Tailwind の `rounded-*` スケールは既定のまま |

`dark:` variant は `[data-theme="dark"]` と `[data-theme="modern"]`（どちらも `color-scheme: dark`）に向けてある
（`src/index.css` の `@custom-variant dark`）。

## `shadcn add` のたびに当てる置換（必須）

shadcn の **`--muted`・`--accent` は「薄い塗り」**、アプリの **`--muted` は「薄い文字色」・`--accent` は「主色」**。
名前が同じで意味が違うので、アプリ側は改名せず（テンプレのプレビュー等が使っている）、shadcn の同名は
定義しない。代わりに、コピーした部品の class を次のように置き換える（variant 前置き `hover:` 等や `/50` 等の
不透明度が付いていても同じ）。

| shadcn の class | 置き換え先 | 理由 |
| --- | --- | --- |
| `bg-muted` | `bg-surface` | 薄い塗り＝アプリの一段明るい面 |
| `text-muted-foreground` | `text-muted` | 薄い文字＝アプリの `--muted` |
| `bg-accent` | `bg-edge` | ホバー・選択中の薄い塗り＝既存メニューのホバー（`hover:bg-edge`） |
| `text-accent-foreground` | `text-fg` | その上の文字 |

### 角丸

shadcn init は `@theme inline` に `--radius-sm/md/lg/xl…: calc(var(--radius) * …)` を足すが、**採らない**（アプリ既存の
`rounded-lg` 等がすべて小さくなる＝8px → 6px）。代わりに部品の中の角丸スケールを `--radius` の直接参照に置き換える。

| shadcn の class | 置き換え先 |
| --- | --- |
| `rounded-lg`（前置き `in-data-[…]:` 等が付いても同じ） | `rounded-(--radius)` |
| `rounded-md` ／ `var(--radius-md)` | `rounded-[calc(var(--radius)*0.8)]` ／ `calc(var(--radius)*0.8)` |
| `rounded-sm` ／ `var(--radius-sm)` | `rounded-[calc(var(--radius)*0.6)]` ／ `calc(var(--radius)*0.6)` |
| `rounded-xl` 以上 | `rounded-[calc(var(--radius)*1.4)]`（xl）・`*1.8`（2xl）・`*2.2`（3xl）・`*2.6`（4xl） |

手順（リポジトリ直下で）:

```bash
npx shadcn@latest add <名前>
sed -i -E 's/(^|[^-[:alnum:]_])bg-muted([^-[:alnum:]_]|$)/\1bg-surface\2/g; s/(^|[^-[:alnum:]_])bg-accent([^-[:alnum:]_]|$)/\1bg-edge\2/g; s/(^|[^-[:alnum:]_])text-muted-foreground([^-[:alnum:]_]|$)/\1text-muted\2/g; s/(^|[^-[:alnum:]_])text-accent-foreground([^-[:alnum:]_]|$)/\1text-fg\2/g' src/components/ui/*.tsx
# 角丸は上の表で手で置き換える（数が少なく、前置きの形がまちまちなので sed にしない）
npx vitest run tests/shadcn-ui-tokens.test.ts tests/shadcn-ui-tokens-radius.test.ts   # 色・角丸の置換漏れがあれば赤（同じ class が連続すると sed が 1 つ飛ばすので、赤なら sed をもう一度）
```

あわせて確認すること:

- **文言は辞書経由**: 部品に英語の文言（例: dialog の閉じるボタンの "Close"）があれば `useTranslation()` の `t()` に
  置き換える。`tests/ux-budget.test.tsx` の「語の一致」は `ui/` も検査し、新しいファイルは 0 件が原則（凍結リストに足さない）。
- **記号**: 部品の内部アイコン（✓・×・› など）だけ lucide を使ってよい。上部バー・メニュー項目の記号は絵文字のまま
  （ADR-0039 の記号の許可リスト）。`lucide-react` は `dropdown-menu.tsx`（✓・›）と `dialog.tsx`（×）のために依存にある
  （#724 PR-B）。アプリの画面コードからは import しない。
- **`cn`**: 部品は `cn` パッケージ（clsx＋tailwind-merge の代わり）を直接 import する。`components.json` の
  `aliases.utils`（`@/lib/utils`）のファイルは置いていない（使う部品が無い）。CLI が作り直したら、使われていなければ消す。
- **CLI が `src/index.css` を書き換えたら戻す**: `init`／`add` は `:root`／`.dark` に shadcn の色の値や Geist フォントを
  足すことがある。値の定義は上の写像だけにする（`--muted`・`--accent` を上書きされるとアプリの色が壊れる）。
- **lint**: このフォルダは `react-refresh/only-export-components` の対象外（`button.tsx` が `buttonVariants` も export する
  shadcn の形をそのまま保つため。`eslint.config.js`）。

## このフォルダ独自の変更（`shadcn add --overwrite` したら当て直す）

置換ルール（上）のほかに、コピーした部品を次のように変えている。

| ファイル | 変更 | 理由 |
| --- | --- | --- |
| `dialog.tsx` | 背景（`DialogOverlay`）を `bg-black/10 supports-backdrop-filter:backdrop-blur-xs` → `bg-void/60` | 以前の手製モーダルと同じ暗さ（#724 統括の決定）。ぼかしは以前も無かった |
| `dialog.tsx` | "Close" → `t("dialog.close")`（2 か所） | 文言は辞書経由（ux-budget の「語の一致」） |

