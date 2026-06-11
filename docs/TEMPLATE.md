# テンプレート — 正典と出自

SlideCraft が Markdown → PPTX 変換で流し込むベーステンプレートの定義。
**出力が「期待通り」かを検証する基準はこのファイルに固定する。**

## 正典（Single Source of Truth）

| 項目 | 値 |
|------|-----|
| ファイル | `public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx` |
| サイズ / md5 | 52692 bytes / `6bd2ae18ea44…` |
| 構成 | 30 スライドレイアウト・全 151 プレースホルダ（スライド本体は無し） |
| 由来 | コミット `7aa42b0「feat: rebuild template with all 151 placeholders from design spec」` |
| デザイン名 | Midnight Executive |

### 配色・スタイルの事実
- テーマ `clrScheme` は **標準 Office パレット**（dk2=`1F497D`, accent1=`4F81BD`…）。
  デザイン色（navy `1E2761` 等）は各レイアウトに **明示的 `srgbClr` で焼き込み**済みで、
  `schemeClr` 参照は無いため描画には影響しない（テーマ編集時のみ標準色が出る）。
- スライドマスター既定文字色: title=`FFFFFF` / body=`1E293B`。

## 参照経路（Consumers）
| 利用者 | 読込先 |
|--------|--------|
| アプリ実行時 | `fetch("/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")`（Vite が `public/` を web ルートで配信） |
| テスト | `tests/*.test.ts` → `../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx` |

→ **アプリもテストも同一の正典ファイル**を参照する（2025-06 に一本化）。

## 併存ファイル
- `public/templates/slide/Midnight_Executive_30_Template.pptx`（94869 bytes）
  正典と同一デザインに **30 枚のサンプルスライドを足したデモ**。実行時には使わない・デザイン確認用。

## 非正典 / 実験用（`reference/` は .gitignore でリポジトリ外）
- `reference/slide/Midnight_Executive_30_TemplateOnly.pptx`（59870 bytes）
  **古い別設計**。正典とはレイアウト 30 中 10 しか一致せず、KPI/Column/Chart 等の
  サブタイトル(idx16)・追加本文(idx2/4/6)・ページ番号(idx50)が欠落。**ベースではない。**
- `reference/slide/create_30_layouts.py`
  別環境の絶対パス（`/sessions/.../`）へ保存する **旧生成器**。上記の旧デザイン/デモを吐く。
  **現行の正典(52692)は再現しない。** リポジトリ内に動く再生成スクリプトは無い。

## 既知の宿題
- 正典(52692)は **独立した配色監査が未実施**（過去の監査は誤って reference/59870 に対して実施）。
  ただしテーマ `clrScheme` とマスター文字色は両版で同一のためコントラスト結論は概ね転用可。差は
  「正典の方がプレースホルダが多い（より完全）」点。
- テーマ `clrScheme` を Midnight Executive パレットへ揃えるかは未決（描画影響ゼロのため優先度低）。
- 再生成可能性（生成器のリポジトリ取り込み＋ python-pptx 導入）は別タスク。
