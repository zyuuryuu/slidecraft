# テンプレート — 正典と出自

SlideCraft のスライドマスター（PPTX テンプレート）の定義と出自。**出力が「期待通り」かを検証する基準
（テストの正典）はこのファイルに固定する。** アプリはこの正典を **ビルトイン既定マスター** として起動時に
読み込み、ユーザは追加のマスター(.pptx)を取り込んで切り替えられる（マスターレジストリ）。

## 正典＝ビルトイン既定マスター（Single Source of Truth）

| 項目 | 値 |
| --- | --- |
| ファイル | `public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx` |
| サイズ / md5 | 52692 bytes / `6bd2ae18ea44…` |
| 構成 | 30 スライドレイアウト・全 151 プレースホルダ（スライド本体は無し） |
| 由来 | コミット `7aa42b0「feat: rebuild template with all 151 placeholders from design spec」` |
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

- `src/components/useMasterRegistry.ts`：**ビルトイン既定（正典）＋当セッションで取り込んだ .pptx** を持つ
  **in-memory バックエンド**（Slice 1a）。API＝`importMaster` / `getBytes` / `removeMaster`。
- UI＝`MasterPicker`（単一プルダウン：現在マスター強調＋末尾に「＋取込」）を **トップバーと Draft の両方**に配置。
  マスターの切替・取込はどちらも適用がゲート（協働ロック中は無効）。
- **永続化はまだ**（セッション内のみ）。複数テンプレの永続管理・切替は ROADMAP バックログ
  「テーマ切り替え / テンプレ管理」。

## 参照経路（Consumers）

| 利用者 | 読込先 |
| --- | --- |
| アプリ起動時（既定マスター） | `fetch("/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")`（Vite が `public/` を web ルートで配信） |
| ユーザ取込マスター | `MasterPicker`「＋取込」→ `useMasterRegistry.importMaster`（レジストリ登録＋適用） |
| テスト | `tests/*.test.ts` → `../public/templates/slide/…`（正典＝canonical、alien fixture＝`lrk-slides-velis_CC0` 等） |

→ **アプリ既定もテストの正典も同一の canonical ファイル**（2025-06 に一本化）。

## ディレクトリの実態（`public/templates/slide/`）

- **アプリが束ねて読むのは canonical 1本のみ**（ディレクトリ列挙はしない）。
- ほかに `_全レイアウト見本.pptx`（tracked・レイアウト確認用の見本デッキ・一部はテスト fixture）と、近い時期に
  足した **`報告書テンプレート*.potx`（未追跡）** が堆積している。
- これらの棚卸（見本/`.potx` を束ねるか整理するか・`.potx` 形式に一本化するか）は ROADMAP バックログ
  「テンプレ資産の棚卸」。⚠ テスト fixture（`lrk-slides-velis_CC0` / `報告書テンプレート_全レイアウト見本` /
  `配布資料_公文書高密度_全レイアウト見本` / `報告書テンプレート_官公庁_全レイアウト見本`）は削除不可。
- `Midnight_Executive_30_Template.pptx`（94869 bytes）＝正典と同一デザインに 30 枚サンプルを足したデモ。
  実行時には使わない・デザイン確認用。

## 再生成

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
