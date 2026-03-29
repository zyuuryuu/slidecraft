# Midnight Executive — 命名規則

> 本ドキュメントは `PROJECT_SPEC.md` §9 を分離したものです。
> レイアウト作業・Placeholder参照時に使用してください。

---

## 1. レイアウト表示名（cSld name）

4セグメント・ドット区切り構造:

```
{役割}.{主要素の数と種類}.{主要素間の関係}.{付帯要素の数と種類}
```

**Segment 1 — 役割（必須）**:
`Title`, `Section`, `SectionNav`, `SectionBreak`, `Content`, `Column`, `KPI`, `Chart`, `Table`, `Compare`, `Process`, `Summary`, `Closing`

**Segment 2 — 主要素（必須）**: `{数}{種類}`
- 種類: `Title`, `Body`, `Value`, `Chart`, `Table`, `Step`, `Option`, `Matrix`, `Agenda`, `Block`, `Message`, `Steps`
- 例: `1Body`, `3Value`, `4Step`, `2Option`

**Segment 3 — 主要素間の関係（必須）**:
`Single`（単一要素）, `Equal`（対等並列）, `MainSub`（主従）, `Versus`（比較対立）, `Sequential`（順序・フロー）, `Grid`（格子配置）

**Segment 4 — 付帯要素（任意、選択影響型のみ）**: `{数}{種類}` を `+` で連結
- 語彙（全6語）: `Notes`, `Source`, `Callout`, `Analysis`, `Meta`, `Summary`
- 含めない内在型: KPIラベル/説明、比較ラベル、セクションラベル/番号、Contact/PresenterInfo、MeetingInfo、FollowUp

**判定原則**: 同じ役割(Seg1)の中で、レイアウト選択を分岐させる要素のみをSeg4に記載。

---

## 2. 全30レイアウトの確定名

| # | 表示名 | 旧名 |
|---|--------|------|
| 0 | `Title.1Title.Single` | タイトル：標準 |
| 1 | `Title.1Title.Single+1Meta` | タイトル：レポート表紙 |
| 2 | `Title.1Title.Single+1Summary` | タイトル：スプリット |
| 3 | `Section.1Title.Single` | セクション：標準 |
| 4 | `SectionNav.1Title.Single` | セクション：ナンバー付 |
| 5 | `SectionBreak.1Title.Single` | セクション：バナー |
| 6 | `Content.1Body.Single` | コンテンツ：標準 |
| 7 | `Content.1Body.Single+1Notes` | コンテンツ：サイドバー付 |
| 8 | `Content.1Body.Single+1Source` | コンテンツ：出典バー付 |
| 9 | `Content.1Body.Single+1Callout` | コンテンツ：コールアウト付 |
| 10 | `Column.2Body.Equal` | 2カラム：均等 |
| 11 | `Column.2Body.MainSub` | 2カラム：ワイド左 |
| 12 | `Column.3Body.Equal` | 3カラム |
| 13 | `KPI.1Value.Single` | KPI：シングル |
| 14 | `KPI.2Value.Equal` | KPI：2カード |
| 15 | `KPI.3Value.Equal` | KPI：3カード |
| 16 | `KPI.4Value.Grid` | KPI：4グリッド |
| 17 | `Chart.1Chart.Single` | チャート：フル幅 |
| 18 | `Chart.1Chart.Single+1Analysis` | チャート＋テキスト |
| 19 | `Chart.2Chart.Equal` | チャート：2面 |
| 20 | `Table.1Table.Single+1Source` | テーブル：フル幅 |
| 21 | `Table.1Table.Single+1Notes` | テーブル＋ノート |
| 22 | `Compare.2Option.Versus` | 比較：サイドバイサイド |
| 23 | `Compare.1Matrix.Single` | 比較：マトリクス |
| 24 | `Process.4Step.Sequential` | タイムライン：横 |
| 25 | `Process.3Step.Sequential` | プロセス：縦 |
| 26 | `Summary.1Agenda.Single` | アジェンダ |
| 27 | `Summary.2Block.Equal` | エグゼクティブサマリー |
| 28 | `Closing.1Message.Single` | クロージング：感謝 |
| 29 | `Closing.1Steps.Single+1Notes` | クロージング：ネクストステップ |

---

## 3. プレースホルダー表示名（cNvPr name）

2セグメント・ドット区切り構造:

```
{役割}.{位置}
```

同じ役割が複数ある場合は `{役割}{番号}.{位置}` とし、番号は左上→右下（日本語の読み順）で振る。

**Segment 1 — 役割**:

| カテゴリ | 役割名 | 用途 |
|----------|--------|------|
| 見出し | `Title`, `Subtitle` | メイン/サブタイトル |
| ヘッダー | `SlideTitle`, `SlideSubtitle` | コンテンツスライドのヘッダーバー |
| ラベル | `CategoryLabel`, `SectionLabel`, `SectionNumber` | カテゴリ/セクション識別 |
| 本文 | `Body` / `Body{N}` | 汎用コンテンツ本文 |
| 付帯 | `Notes`, `Source`, `Callout`, `Analysis`, `Meta`, `Summary` | レイアウトSeg4と一致 |
| KPI | `Value` / `Value{N}`, `ValueLabel` / `ValueLabel{N}`, `ValueDesc` | KPI数値・指標名・補足 |
| 比較 | `OptionLabel{N}`, `OptionContent{N}` | 比較対象名・内容 |
| プロセス | `Step{N}` | プロセスステップ |
| サマリー | `AgendaItems`, `MeetingInfo` | アジェンダ系 |
| クロージング | `PresenterName`, `Contact`, `ActionSteps` | クロージング系 |
| メタ | `Date`, `Footer`, `Description` | メタ情報 |
| システム | `SlideNum` | スライド番号 |

**Segment 2 — 位置（13語）**:

| 方向 | 語彙 |
|------|------|
| 縦 | `Top`, `Center`, `Bottom` |
| 横 | `Left`, `CenterLeft`, `CenterRight`, `Right` |
| グリッド | `TopLeft`, `TopRight`, `BottomLeft`, `BottomRight` |
| 特殊 | `Header`（ヘッダーバー内）, `Footer`（最下部帯） |

**位置割り当て原則**:
- ヘッダーバー要素 → `Header`
- スライド番号・出典バー → `Footer` / `Bottom`
- 全幅ダークスライド（Title/Section/Closing）→ Y座標で `Top`/`Center`/`Bottom`
- 左右分割レイアウト → `Left`/`Right`
- 2×2グリッド → `TopLeft`/`TopRight`/`BottomLeft`/`BottomRight`
- 4要素横並び → `Left`/`CenterLeft`/`CenterRight`/`Right`

---

## 4. 全30レイアウトのPlaceholder一覧

**共通ヘルパー（コンテンツスライド L06〜L27 で自動付与）**:
- `SlideTitle.Header` (idx=15) — ヘッダーバー内タイトル, Georgia 28pt 白 太字
- `SlideSubtitle.Header` (idx=16) — ヘッダーバー内サブタイトル, Calibri 12pt ice_blue
- `SlideNum.Footer` (idx=50) — スライド番号, Calibri 10pt mid_gray 右揃え

---

**L00 `Title.1Title.Single`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | CategoryLabel.Top | Calibri 15pt accent 太字 | カテゴリラベル |
| 0 | Title.Center | Georgia 48pt white 太字 | メインタイトル |
| 1 | Subtitle.Center | Calibri 20pt ice_blue | サブタイトル |
| 11 | Date.Bottom | Calibri 14pt ice_blue | 日付・組織名 |
| 12 | Footer.Bottom | Calibri 11pt ice_blue | Confidential等 |

**L01 `Title.1Title.Single+1Meta`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | CategoryLabel.Top | Calibri 14pt accent 太字 | レポート種類ラベル |
| 0 | Title.Left | Georgia 44pt white 太字 | レポートタイトル |
| 1 | Subtitle.Left | Calibri 18pt ice_blue | サブタイトル |
| 11 | Meta.Right | Calibri 13pt ice_blue | 作成日・作成者・バージョン等 |
| 12 | Footer.Bottom | Calibri 11pt ice_blue | Confidential等 |

**L02 `Title.1Title.Single+1Summary`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | CategoryLabel.Left | Calibri 14pt accent 太字 | カテゴリラベル |
| 0 | Title.Left | Georgia 42pt white 太字 | タイトル |
| 1 | Subtitle.Left | Calibri 16pt ice_blue | サブタイトル |
| 11 | Summary.Right | Calibri 14pt dark_text | サマリー・概要テキスト |
| 12 | Date.Bottom | Calibri 11pt ice_blue | 日付・組織名 |

**L03 `Section.1Title.Single`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | SectionLabel.Top | Calibri 13pt accent 太字 | "SECTION" ラベル |
| 15 | Title.Center | Georgia 40pt white 太字 | セクションタイトル |
| 11 | Description.Bottom | Calibri 16pt ice_blue | 説明テキスト |

**L04 `SectionNav.1Title.Single`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | SectionNumber.Left | Georgia 80pt accent 太字 中央 | "01" 等の番号 |
| 11 | SectionLabel.Left | Calibri 12pt ice_blue 中央 | "SECTION" ラベル |
| 15 | Title.Right | Georgia 38pt white 太字 | セクションタイトル |
| 12 | Description.Right | Calibri 16pt ice_blue | 説明テキスト |

**L05 `SectionBreak.1Title.Single`**

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | SectionLabel.Top | Calibri 13pt accent 太字 | "SECTION 01" ラベル |
| 15 | Title.Center | Georgia 44pt white 太字 | セクションタイトル |
| 11 | Description.Bottom | Calibri 15pt ice_blue | 説明テキスト |

**L06 `Content.1Body.Single`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Center | Calibri 14pt dark_text | メインコンテンツ領域 |

**L07 `Content.1Body.Single+1Notes`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Left | Calibri 14pt dark_text | メインコンテンツ |
| 2 | Notes.Right | Calibri 12pt dark_text | サイドバー補足情報 |

**L08 `Content.1Body.Single+1Source`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Center | Calibri 14pt dark_text | メインコンテンツ |
| 2 | Source.Bottom | Calibri 10pt mid_gray | 出典・データソース |

**L09 `Content.1Body.Single+1Callout`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 2 | Callout.Top | Calibri 13pt navy | キーメッセージ |
| 1 | Body.Center | Calibri 14pt dark_text | メインコンテンツ |

**L10 `Column.2Body.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body1.Left | Calibri 14pt dark_text | 左カラム |
| 2 | Body2.Right | Calibri 14pt dark_text | 右カラム |

**L11 `Column.2Body.MainSub`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body1.Left | Calibri 14pt dark_text | メインカラム（65%） |
| 2 | Body2.Right | Calibri 14pt dark_text | サブカラム（35%） |

**L12 `Column.3Body.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body1.Left | Calibri 14pt dark_text | 左カラム |
| 2 | Body2.Center | Calibri 14pt dark_text | 中央カラム |
| 3 | Body3.Right | Calibri 14pt dark_text | 右カラム |

**L13 `KPI.1Value.Single`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Value.Center | Georgia 72pt navy 太字 中央 | KPI数値 |
| 2 | ValueLabel.Center | Calibri 18pt dark_text 太字 中央 | 指標名 |
| 3 | ValueDesc.Center | Calibri 13pt mid_gray 中央 | 補足説明 |

**L14 `KPI.2Value.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Value1.Left | Georgia 60pt navy 太字 中央 | 左KPI数値 |
| 2 | ValueLabel1.Left | Calibri 14pt dark_text 中央 | 左指標名+説明 |
| 3 | Value2.Right | Georgia 60pt navy 太字 中央 | 右KPI数値 |
| 4 | ValueLabel2.Right | Calibri 14pt dark_text 中央 | 右指標名+説明 |

**L15 `KPI.3Value.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Value1.Left | Georgia 52pt navy 太字 中央 | 左KPI数値 |
| 2 | ValueLabel1.Left | Calibri 13pt dark_text 中央 | 左指標名+説明 |
| 3 | Value2.Center | Georgia 52pt navy 太字 中央 | 中央KPI数値 |
| 4 | ValueLabel2.Center | Calibri 13pt dark_text 中央 | 中央指標名+説明 |
| 5 | Value3.Right | Georgia 52pt navy 太字 中央 | 右KPI数値 |
| 6 | ValueLabel3.Right | Calibri 13pt dark_text 中央 | 右指標名+説明 |

**L16 `KPI.4Value.Grid`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Value1.TopLeft | Calibri 14pt dark_text | 左上KPIカード |
| 2 | Value2.TopRight | Calibri 14pt dark_text | 右上KPIカード |
| 3 | Value3.BottomLeft | Calibri 14pt dark_text | 左下KPIカード |
| 4 | Value4.BottomRight | Calibri 14pt dark_text | 右下KPIカード |

**L17 `Chart.1Chart.Single`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Center | Calibri 14pt mid_gray 中央 | チャート配置エリア |

**L18 `Chart.1Chart.Single+1Analysis`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Left | Calibri 14pt mid_gray 中央 | チャート配置エリア |
| 2 | Analysis.Right | Calibri 14pt dark_text | 分析テキスト |

**L19 `Chart.2Chart.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body1.Left | Calibri 14pt mid_gray 中央 | 左チャートエリア |
| 2 | Body2.Right | Calibri 14pt mid_gray 中央 | 右チャートエリア |

**L20 `Table.1Table.Single+1Source`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Center | Calibri 14pt dark_text | テーブル配置エリア |
| 2 | Source.Bottom | Calibri 10pt mid_gray | 出典 |

**L21 `Table.1Table.Single+1Notes`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body.Left | Calibri 14pt dark_text | テーブル配置エリア |
| 2 | Notes.Right | Calibri 12pt dark_text | コメント・注記 |

**L22 `Compare.2Option.Versus`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | OptionLabel1.Left | Calibri 16pt accent 太字 | 左オプション名 |
| 2 | OptionContent1.Left | Calibri 14pt dark_text | 左オプション内容 |
| 3 | OptionLabel2.Right | Calibri 16pt teal 太字 | 右オプション名 |
| 4 | OptionContent2.Right | Calibri 14pt dark_text | 右オプション内容 |

**L23 `Compare.1Matrix.Single`** (+共通ヘルパーのみ、デモでTable API使用)

（レイアウト固有Placeholderなし — デモスライドでpython-pptx Table APIを使用）

**L24 `Process.4Step.Sequential`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Step1.Left | Calibri 13pt dark_text 中央 | ステップ1 |
| 2 | Step2.CenterLeft | Calibri 13pt dark_text 中央 | ステップ2 |
| 3 | Step3.CenterRight | Calibri 13pt dark_text 中央 | ステップ3 |
| 4 | Step4.Right | Calibri 13pt dark_text 中央 | ステップ4 |

**L25 `Process.3Step.Sequential`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Step1.Top | Calibri 14pt dark_text | ステップ1 |
| 2 | Step2.Center | Calibri 14pt dark_text | ステップ2 |
| 3 | Step3.Bottom | Calibri 14pt dark_text | ステップ3 |

**L26 `Summary.1Agenda.Single`** (共通ヘルパーなし、独自ヘッダー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 15 | Title.Left | Georgia 36pt white 太字 | "Agenda" タイトル |
| 16 | MeetingInfo.Left | Calibri 14pt ice_blue | 日時・場所・所要時間 |
| 1 | AgendaItems.Right | Calibri 15pt dark_text | アジェンダ項目リスト |

**L27 `Summary.2Block.Equal`** (+共通ヘルパー)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 1 | Body1.Left | Calibri 14pt dark_text | 発見事項パネル |
| 2 | Body2.Right | Calibri 13pt dark_text | 推奨事項パネル |

**L28 `Closing.1Message.Single`** (共通ヘルパーなし)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 10 | CategoryLabel.Top | Calibri 18pt accent 太字 | "THANK YOU" ラベル |
| 0 | Title.Center | Georgia 42pt white 太字 | メッセージ |
| 11 | PresenterName.Bottom | Calibri 16pt ice_blue | 担当者名・役職 |
| 12 | Contact.Bottom | Calibri 13pt ice_blue | メール・内線・Slack |

**L29 `Closing.1Steps.Single+1Notes`** (共通ヘルパーなし)

| idx | Placeholder名 | フォント | 説明 |
|-----|---------------|----------|------|
| 15 | Title.Left | Georgia 28pt white 太字 | "Next Steps" タイトル |
| 1 | ActionSteps.Left | Calibri 15pt ice_blue | アクション項目リスト |
| 2 | Notes.Right | Calibri 14pt white | 期限・担当・連絡先・次回MTG |

---

*分離元: PROJECT_SPEC.md §9 | 最終更新: 2026-03-25*
