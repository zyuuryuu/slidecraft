# テンプレート — 正典と出自

SlideCraft のスライドマスター（PPTX テンプレート）の定義と出自。**出力が「期待通り」かを検証する基準
（テストの正典）はこのファイルに固定する。** アプリはこの正典を **ビルトイン既定マスター** として起動時に
読み込み、ユーザは追加のマスター(.pptx)を取り込んで切り替えられる（マスターレジストリ）。

## 正典＝ビルトイン既定マスター（Single Source of Truth）

| 項目 | 値 |
| --- | --- |
| ファイル | `public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx` |
| サイズ / md5 | 52678 bytes / `092d750c3d6e…` |
| 構成 | 30 スライドレイアウト・全 151 プレースホルダ（スライド本体は無し） |
| 由来 | コミット `7aa42b0「feat: rebuild template with all 151 placeholders from design spec」`＋整形式修正の再生成（2026-07-04・`</p:prstGeom>` プレフィックス不一致 20 箇所を解消、`tests/pptx-wellformed.test.ts` でゲート） |
| デザイン名 | Midnight Executive |
| レジストリ上の id | `builtin`（`useMasterRegistry` の `BUILTIN_MASTER`・常在・削除不可） |

### 配色・スタイルの事実

- テーマ `clrScheme` は **標準 Office パレット**（dk2=`1F497D`, accent1=`4F81BD`…）。デザイン色
  （navy `1E2761` 等）は各レイアウトに **明示的 `srgbClr` で焼き込み**済みで、`schemeClr` 参照は無いため
  描画には影響しない（テーマ編集時のみ標準色が出る）。
- スライドマスター既定文字色: title=`FFFFFF` / body=`1E293B`。
- **取り込みマスター（alien）対応**：多くの実テンプレは文字色を `schemeClr`（テーマ参照）で持つため、ローダは
  `schemeClr → hex` を解決する（未解決だと白マスター既定へフォールバックし「白背景に白文字」で不可視になる
  回帰があった）。正典は `srgbClr` 焼き込みのため不変。回帰ゲート＝`tests/theme-color.test.ts`。

## マスターレジストリ（複数マスター対応）

- `src/components/useMasterRegistry.ts`：**ビルトイン既定（正典）＋取り込んだ .pptx** を持つレジストリ。
  API＝`importMaster` / `getBytes` / `removeMaster`。**デスクトップでは永続化**（Slice 1b＝テーマ2 S6）：
  `src/ipc/master-store.ts` が app-local-data の `masters/`（index.json＋`<id>.pptx`）へ保存し起動時に
  ハイドレート。ブラウザ（dev/demo）はセッション内のみ。fs スコープ＝`$APPLOCALDATA/masters/**`
  （`src-tauri/capabilities/default.json`）。
- UI＝`MasterPicker`（単一プルダウン：現在マスター強調＋末尾に「＋取込」）を **トップバーと Draft の両方**に配置。
  マスターの切替・取込はどちらも適用がゲート（協働ロック中は無効）。
- **登録支援（修復オファー）**：取込時に受け入れゲートが rejected（タイトル/本文ロール欠落）でも、
  `src/engine/template-repair.ts` が修復提案（`<p:ph>` への type 付与の最小パッチ）を組み立て、確認のうえ
  「整形して取り込む」— 修復済み bytes がレジストリに登録される。設計＝
  `docs/design/template-authoring.md`（テーマ2 スライス1）、テスト＝`tests/template-repair.test.ts` /
  `tests/apply-template-repair.test.ts`。

## 参照経路（Consumers）

| 利用者 | 読込先 |
| --- | --- |
| アプリ起動時（既定マスター） | `fetch("/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")`（Vite が `public/` を web ルートで配信） |
| ビルトインテンプレ（4本） | `useMasterRegistry.BUILTIN_MASTERS`＝Midnight（既定）＋配布資料 公文書高密度／ビジュアルデッキ マガジン／技術報告 スタンダード水色。各 `public/templates/slide/*_TemplateOnly.pptx` を fetch |
| ユーザ取込マスター | `MasterPicker`「＋取込」→ `useMasterRegistry.importMaster`（レジストリ登録＋適用） |
| テスト | `tests/*.test.ts` → `tests/fixtures/templates/…`（テスト専用フィクスチャ・`public/` とは分離） |

## ディレクトリの実態

- **`public/templates/slide/`＝アプリが配信する公式テンプレのみ**：`*_TemplateOnly.pptx` 4 本（＝ BUILTIN_MASTERS）＋ `CREDITS.md`。テスト専用ファイルは置かない（衛生）。
- **`tests/fixtures/templates/`＝テスト専用フィクスチャ**（`public/` から退避）：`*_全レイアウト見本.pptx`（レイアウト確認用の見本デッキ）・`lrk-slides-velis_CC0.pptx`（CC0 alien fixture）・`Midnight_Executive_30_Template.pptx`（中身入りデモ）・`Midnight_Executive_30_TemplateOnly.pptx`（テスト用コピー・`rebuild-template.ts` が public と同期）。会社 `.potx` と `CX_sample_MSGothic.pptx` はここに置き **gitignore**（知財・ローカル限定）。
- ⚠ 削除不可のフィクスチャ：`lrk-slides-velis_CC0` / `報告書テンプレート_全レイアウト見本` / `配布資料_公文書高密度_全レイアウト見本` / `報告書テンプレート_官公庁_全レイアウト見本` ほか（`field-map-bijection.test.ts` 等が参照）。

## 再生成・新規生成

- **`src/engine/template-writer.ts`**（テーマ2 S3）：`TemplateSpec`（名前・パレット・フォント・レイアウト定義）から
  template-only PPTX を**ゼロからフル生成**する engine パス。レイアウト定義は
  `src/engine/template-layout-library.ts`（canonical 30 レイアウトの座標/idx/type をセマンティック配色キーで
  昇格したもの）。検証ゲート＝自前ローダ読み戻しで health ok＋コンテンツ流し込み生存
  （`tests/template-writer.test.ts`）。PowerPoint 実機での開封確認はマイルストーン時の手動項目。
- **`scripts/rebuild-template.ts`**（`npx tsx scripts/rebuild-template.ts`）：既存テンプレを patch して 30 レイアウト・
  全プレースホルダ（idx/type/位置/サイズ/`lstStyle`）・装飾図形を正す **リポジトリ内の再生成パス**。JSZip ベース
  （python 不要）。プレースホルダ定義の由来は `create_30_layouts.py`（script に反映済み）。
- **`reference/`（.gitignore・リポジトリ外）**：旧別設計の PPTX（`…TemplateOnly.pptx` 59870・レイアウト 30 中 10
  のみ一致でサブタイトル/追加本文/ページ番号が欠落＝**ベースではない**）、旧生成器 `create_30_layouts.py`
  （別環境の絶対パスへ吐く）、`pptx_to_theme.py`、spike 出力。

## 既知の宿題

- 正典(52692)の **独立した配色コントラスト監査は未実施**（過去の監査は誤って reference/59870 に対して実施）。
  テーマ `clrScheme`・マスター文字色は両版同一のため結論は概ね転用可。差は「正典の方がプレースホルダが多い
  （より完全）」点。
- テーマ `clrScheme` を Midnight Executive パレットへ揃えるかは未決（描画影響ゼロのため優先度低）。
