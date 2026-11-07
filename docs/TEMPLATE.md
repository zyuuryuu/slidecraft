# テンプレート — 正典と出自

SlideCraft のスライドマスター（PPTX テンプレート）の定義と出自。**出力が「期待通り」かを検証する基準
（テストの正典）はこのファイルに固定する。** アプリは出荷テンプレ 3 本の先頭（技術報告 スタンダード水色）を
**ビルトイン既定マスター** として起動時にレジストリ経由で読み込み、ユーザは追加のマスター(.pptx)を取り込んで
切り替えられる（マスターレジストリ）。

> **#117（2026-11-07）**：開発用の正典 Midnight Executive（canonical 30 レイアウト）はビルトイン同梱をやめ、
> **入力サンプル** `samples/templates/` へ移した。テストの正典としての役割は `tests/fixtures/templates/` のコピーが
> 引き続き担う。canonical のレイアウト語彙（`LAYOUT_NAMES` / `BUILTIN_LAYOUTS`）はテンプレ作成・LLM 指示のため残す。

## 正典（canonical 30 レイアウト・入力サンプル兼テストの正典）

| 項目 | 値 |
| --- | --- |
| ファイル | `samples/templates/Midnight_Executive_30_TemplateOnly.pptx`（入力サンプル・#117 まで `public/templates/slide/` に同梱）／テスト用 `tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx` |
| サイズ / md5 | 54158 bytes / `f970a8327de0…` |
| 構成 | 31 スライドレイアウト・全 154 プレースホルダ（スライド本体は無し） |
| 由来 | コミット `7aa42b0「feat: rebuild template with all 151 placeholders from design spec」`＋整形式修正の再生成（2026-07-04・`</p:prstGeom>` プレフィックス不一致 20 箇所を解消、`tests/pptx-wellformed.test.ts` でゲート）＋`SectionNav.1TitleList.Single`（idx 31）を追加（#167）。patch に使った開発スクリプト群は #117 で引退（git 履歴から復元可） |
| デザイン名 | Midnight Executive |
| レジストリ上の id | なし（#117 でビルトインから外した。旧 id `builtin`）。使うときは MasterPicker「＋取込」で取り込む |

### 配色・スタイルの事実

- テーマ `clrScheme` は **標準 Office パレット**（dk2=`1F497D`, accent1=`4F81BD`…）。デザイン色
  （navy `1E2761` 等）は各レイアウトに **明示的 `srgbClr` で焼き込み**済みで、`schemeClr` 参照は無いため
  描画には影響しない（テーマ編集時のみ標準色が出る）。
- スライドマスター既定文字色: title=`FFFFFF` / body=`1E293B`。
- **取り込みマスター（alien）対応**：多くの実テンプレは文字色を `schemeClr`（テーマ参照）で持つため、ローダは
  `schemeClr → hex` を解決する（未解決だと白マスター既定へフォールバックし「白背景に白文字」で不可視になる
  回帰があった）。正典は `srgbClr` 焼き込みのため不変。回帰ゲート＝`tests/theme-color.test.ts`。

## マスターレジストリ（複数マスター対応）

- `src/components/useMasterRegistry.ts`：**ビルトイン 3 本＋取り込んだ .pptx** を持つレジストリ。テンプレの URL を
  書くのは `BUILTIN_MASTERS` の 1 か所だけ（R8）。
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
| アプリ起動時（既定マスター） | `default-master.ts` の `loadDefaultMaster` → レジストリ `getBytes(BUILTIN_MASTER.id)` → 受け入れゲートで適用。失敗はトースト通知（never-silent・#117） |
| ビルトインテンプレ（3本） | `useMasterRegistry.BUILTIN_MASTERS`＝技術報告 スタンダード水色（既定）＋配布資料 公文書高密度／ビジュアルデッキ マガジン。各 `public/templates/slide/*_TemplateOnly.pptx` を fetch（Vite が `public/` を web ルートで配信） |
| ユーザ取込マスター | `MasterPicker`「＋取込」→ `useMasterRegistry.importMaster`（レジストリ登録＋適用） |
| テスト | `tests/*.test.ts` → `tests/fixtures/templates/…`（テスト専用フィクスチャ・`public/` とは分離） |

## ディレクトリの実態

- **`public/templates/slide/`＝アプリが配信する公式テンプレのみ**：`*_TemplateOnly.pptx` 3 本（＝ BUILTIN_MASTERS）＋ `CREDITS.md`。テスト専用ファイルは置かない（衛生）。
- **`samples/templates/`＝入力サンプル**（#117）：`Midnight_Executive_30_TemplateOnly.pptx`（旧ビルトイン既定）。同梱はしない。
  旧 public 版を走査していたテスト（タイトル可読性・病理・chrome ゲート等）は、走査範囲を縮めないためこのファイルを読む。
- **`tests/fixtures/templates/`＝テスト専用フィクスチャ**（`public/` から退避）：`*_全レイアウト見本.pptx`（レイアウト確認用の見本デッキ）・`lrk-slides-velis_CC0.pptx`（CC0 alien fixture）・`Midnight_Executive_30_Template.pptx`（中身入りデモ）・`Midnight_Executive_30_TemplateOnly.pptx`（テスト用コピー。samples 版とはレイアウト 12〜30 の `TitleBackdrop` 図形の有無が異なる＝samples 版にだけ #274 の背景帯 patch が当たっている）。会社 `.potx` と `CX_sample_MSGothic.pptx` はここに置き **gitignore**（知財・ローカル限定）。
- ⚠ 削除不可のフィクスチャ：`lrk-slides-velis_CC0` / `報告書テンプレート_全レイアウト見本` / `配布資料_公文書高密度_全レイアウト見本` / `報告書テンプレート_官公庁_全レイアウト見本` ほか（`field-map-bijection.test.ts` 等が参照）。

## 再生成・新規生成

- **`src/engine/template-writer.ts`**（テーマ2 S3）：`TemplateSpec`（名前・パレット・フォント・レイアウト定義）から
  template-only PPTX を**ゼロからフル生成**する engine パス。レイアウト定義は
  `src/engine/template-layout-library.ts`（canonical 30 レイアウトの座標/idx/type をセマンティック配色キーで
  昇格したもの）。検証ゲート＝自前ローダ読み戻しで health ok＋コンテンツ流し込み生存
  （`tests/template-writer.test.ts`）。PowerPoint 実機での開封確認はマイルストーン時の手動項目。
- **引退した開発スクリプト（#117）**：Midnight を直接 patch していた `scripts/rebuild-template.ts`・
  `add-kicker-variant-layout.ts`・`add-section-nav-list-layout.ts`・`add-body-bullet-style.ts`・
  `patch-midnight-title-backdrops.mjs`・`strip-to-template.mjs` は削除した。Midnight はもう出荷物ではないため
  再生成パスは不要で、必要になれば git 履歴から復元する。新しいテンプレは `template-writer.ts` で作る。
- **`reference/`（.gitignore・リポジトリ外）**：旧別設計の PPTX（`…TemplateOnly.pptx` 59870・レイアウト 30 中 10
  のみ一致でサブタイトル/追加本文/ページ番号が欠落＝**ベースではない**）、旧生成器 `create_30_layouts.py`
  （別環境の絶対パスへ吐く）、`pptx_to_theme.py`、spike 出力。

## 既知の宿題

- 正典(52692)の **独立した配色コントラスト監査は未実施**（過去の監査は誤って reference/59870 に対して実施）。
  テーマ `clrScheme`・マスター文字色は両版同一のため結論は概ね転用可。差は「正典の方がプレースホルダが多い
  （より完全）」点。
- テーマ `clrScheme` を Midnight Executive パレットへ揃えるかは未決（描画影響ゼロのため優先度低）。
