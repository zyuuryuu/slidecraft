/**
 * template-layout-library.ts — 組み込みレイアウトライブラリ（テーマ2 S3・純粋データ）。
 *
 * canonical（Midnight Executive 30 レイアウト）のプレースホルダ定義を engine 型に昇格したもの。
 * 出自は scripts/rebuild-template.ts の LAYOUTS（さらに遡ると create_30_layouts.py）— 座標/idx/type は
 * 実証済みの値をそのまま使い、フォントは major/minor・色はセマンティックなパレットキーに置き換えて
 * 任意デザインへ差し替え可能にした。template-writer.ts が TemplateSpec と組み合わせて PPTX を生成する。
 * 設計: docs/design/template-authoring.md S3。
 */

/** 生成テンプレの配色スロット（hex・# なし）。canonical の 14 色パレットから実使用分を昇格。 */
export const PALETTE_KEYS = [
  "background", // dark 系レイアウトの背景・light 系レイアウトのヘッダーバー
  "canvas", // light 系レイアウトの背景
  "titleText", // タイトル文字（dark 背景/ヘッダーバー上に載る）
  "bodyText", // 本文文字（canvas 上に載る）
  "subtle", // 補助文字（dark 背景上のサブタイトル/メタ）
  "muted", // 弱い文字（出典・ページ番号）
  "accent", // 強調（カテゴリラベル・比較オプション1）
  "accent2", // 第2強調（比較オプション2）
  "emphasis", // 大数字などの強調文字（canvas 上）
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export interface LayoutPhDef {
  name: string;
  type: string; // "body" | "ctrTitle" | "subTitle" | "sldNum"
  idx: number;
  x: number; y: number; w: number; h: number; // inches
  fontSize: number; // pt
  font: "major" | "minor";
  color: PaletteKey;
  bold: boolean;
  align: string; // "l" | "ctr" | "r"
}

export interface LayoutDecoDef {
  x: number; y: number; w: number; h: number; // inches
  color: PaletteKey;
  radius?: number; // corner radius (inches)
}

export interface LayoutDef {
  name: string;
  family: "dark" | "light"; // dark=background 塗り / light=canvas 塗り＋ヘッダーバー
  decos?: LayoutDecoDef[]; // family 由来の自動装飾に追加する固有装飾
  placeholders: LayoutPhDef[];
}

export const BUILTIN_LAYOUTS: LayoutDef[] = [
  // 0: Title.1Title.Single
  { name: "Title.1Title.Single", family: "dark", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.5, w: 9, h: 0.45, fontSize: 15, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "ctrTitle", idx: 0, x: 1.2, y: 2.1, w: 10.5, h: 1.5, fontSize: 48, font: "major", color: "titleText", bold: true, align: "l" },
    // y=3.85: タイトルが2行に折り返しても本文下端（titleTextBottomIn(2.1, 48, 2)=3.7in）と
    // MIN_TITLE_SUBTITLE_GAP_IN（0.15in）分の余白を確保する（#137 — 旧 y=3.7 は密着/衝突していた）。
    { name: "Subtitle.Center", type: "subTitle", idx: 1, x: 1.2, y: 3.85, w: 9, h: 0.7, fontSize: 20, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Date.Bottom", type: "body", idx: 11, x: 1.2, y: 5.6, w: 8, h: 0.4, fontSize: 14, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Footer.Bottom", type: "body", idx: 12, x: 1.2, y: 6.1, w: 4, h: 0.3, fontSize: 11, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 1: Title.1Title.Single+1Meta
  { name: "Title.1Title.Single+1Meta", family: "dark", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.2, w: 6.5, h: 0.4, fontSize: 14, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Left", type: "ctrTitle", idx: 0, x: 1.2, y: 1.8, w: 7.0, h: 1.8, fontSize: 44, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Subtitle.Left", type: "subTitle", idx: 1, x: 1.2, y: 3.8, w: 7.0, h: 0.6, fontSize: 18, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Meta.Right", type: "body", idx: 11, x: 9.1, y: 1.6, w: 3.2, h: 3.8, fontSize: 13, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Footer.Bottom", type: "body", idx: 12, x: 1.2, y: 6.2, w: 6, h: 0.3, fontSize: 11, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 2: Title.1Title.Single+1Summary
  { name: "Title.1Title.Single+1Summary", family: "dark", placeholders: [
    { name: "CategoryLabel.Left", type: "body", idx: 10, x: 1.2, y: 1.5, w: 5.5, h: 0.4, fontSize: 14, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Left", type: "ctrTitle", idx: 0, x: 1.2, y: 2.1, w: 5.8, h: 2.0, fontSize: 42, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Subtitle.Left", type: "subTitle", idx: 1, x: 1.2, y: 4.3, w: 5.5, h: 0.6, fontSize: 16, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Summary.Right", type: "body", idx: 11, x: 8.0, y: 1.2, w: 4.8, h: 5.5, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Date.Bottom", type: "body", idx: 12, x: 1.2, y: 6.2, w: 5, h: 0.3, fontSize: 11, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 3: Section.1Title.Single
  { name: "Section.1Title.Single", family: "dark", placeholders: [
    { name: "SectionLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.1, w: 5, h: 0.4, fontSize: 13, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 1.8, w: 10.5, h: 2.2, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Description.Bottom", type: "body", idx: 11, x: 1.2, y: 4.5, w: 10, h: 1.5, fontSize: 16, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 4: SectionNav.1Title.Single
  { name: "SectionNav.1Title.Single", family: "dark", placeholders: [
    { name: "SectionNumber.Left", type: "body", idx: 10, x: 1.0, y: 1.5, w: 2.4, h: 2.5, fontSize: 80, font: "major", color: "accent", bold: true, align: "ctr" },
    { name: "SectionLabel.Left", type: "body", idx: 11, x: 1.0, y: 4.0, w: 2.4, h: 0.4, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "ctr" },
    { name: "Title.Right", type: "body", idx: 15, x: 4.2, y: 1.5, w: 8.5, h: 2.0, fontSize: 38, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Description.Right", type: "body", idx: 12, x: 4.2, y: 4.0, w: 8.5, h: 2.0, fontSize: 16, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 5: SectionBreak.1Title.Single
  { name: "SectionBreak.1Title.Single", family: "dark", placeholders: [
    { name: "SectionLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.2, w: 10, h: 0.4, fontSize: 13, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 3.0, w: 10.5, h: 1.5, fontSize: 44, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Description.Bottom", type: "body", idx: 11, x: 1.2, y: 5.3, w: 10, h: 1.2, fontSize: 15, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 6: Content.1Body.Single
  { name: "Content.1Body.Single", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.45, w: 11.7, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 7: Content.1Body.Single+1Notes
  { name: "Content.1Body.Single+1Notes", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 8.2, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.7, y: 1.65, w: 3.0, h: 5.1, fontSize: 12, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 8: Content.1Body.Single+1Source
  { name: "Content.1Body.Single+1Source", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.45, w: 11.7, h: 4.8, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Source.Bottom", type: "body", idx: 2, x: 0.8, y: 6.65, w: 11.0, h: 0.6, fontSize: 10, font: "minor", color: "muted", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 9: Content.1Body.Single+1Callout
  { name: "Content.1Body.Single+1Callout", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Callout.Top", type: "body", idx: 2, x: 1.1, y: 1.5, w: 11.2, h: 0.85, fontSize: 13, font: "minor", color: "emphasis", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 2.8, w: 11.7, h: 4.1, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 10: Column.2Body.Equal
  { name: "Column.2Body.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 6.8, y: 1.45, w: 5.7, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 11: Column.2Body.MainSub
  { name: "Column.2Body.MainSub", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 7.4, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 8.8, y: 1.55, w: 3.8, h: 5.1, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 12: Column.3Body.Equal
  { name: "Column.3Body.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body2.Center", type: "body", idx: 2, x: 4.7, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body3.Right", type: "body", idx: 3, x: 8.6, y: 1.45, w: 3.9, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 13-16: KPI layouts
  { name: "KPI.1Value.Single", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Value.Center", type: "body", idx: 1, x: 3.5, y: 2.2, w: 6.5, h: 2.0, fontSize: 72, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "ValueLabel.Center", type: "body", idx: 2, x: 3.5, y: 4.2, w: 6.5, h: 0.5, fontSize: 18, font: "minor", color: "bodyText", bold: true, align: "ctr" },
    { name: "ValueDesc.Center", type: "body", idx: 3, x: 3.5, y: 4.8, w: 6.5, h: 1.0, fontSize: 13, font: "minor", color: "muted", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "KPI.2Value.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Value1.Left", type: "body", idx: 1, x: 1.2, y: 2.0, w: 4.6, h: 1.8, fontSize: 60, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "ValueLabel1.Left", type: "body", idx: 2, x: 1.2, y: 3.9, w: 4.6, h: 2.5, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Value2.Right", type: "body", idx: 3, x: 7.2, y: 2.0, w: 4.8, h: 1.8, fontSize: 60, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "ValueLabel2.Right", type: "body", idx: 4, x: 7.2, y: 3.9, w: 4.8, h: 2.5, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "KPI.3Value.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Value1", type: "body", idx: 1, x: 0.8, y: 2.0, w: 3.2, h: 1.5, fontSize: 52, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "Label1", type: "body", idx: 2, x: 0.8, y: 3.6, w: 3.2, h: 2.8, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Value2", type: "body", idx: 3, x: 4.9, y: 2.0, w: 3.4, h: 1.5, fontSize: 52, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "Label2", type: "body", idx: 4, x: 4.9, y: 3.6, w: 3.4, h: 2.8, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Value3", type: "body", idx: 5, x: 9.2, y: 2.0, w: 3.3, h: 1.5, fontSize: 52, font: "major", color: "emphasis", bold: true, align: "ctr" },
    { name: "Label3", type: "body", idx: 6, x: 9.2, y: 3.6, w: 3.3, h: 2.8, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "KPI.4Value.Grid", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Value1.TL", type: "body", idx: 1, x: 1.0, y: 1.6, w: 4.8, h: 2.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Value2.TR", type: "body", idx: 2, x: 7.2, y: 1.6, w: 5.0, h: 2.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Value3.BL", type: "body", idx: 3, x: 1.0, y: 4.4, w: 4.8, h: 2.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Value4.BR", type: "body", idx: 4, x: 7.2, y: 4.4, w: 5.0, h: 2.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 17-19: Chart layouts
  { name: "Chart.1Chart.Single", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.6, w: 11.7, h: 5.0, fontSize: 14, font: "minor", color: "muted", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "Chart.1Chart.Single+1Analysis", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 6.9, h: 5.0, fontSize: 14, font: "minor", color: "muted", bold: false, align: "ctr" },
    { name: "Analysis.Right", type: "body", idx: 2, x: 8.4, y: 1.5, w: 4.4, h: 5.3, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "Chart.2Chart.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 5.3, h: 5.0, fontSize: 14, font: "minor", color: "muted", bold: false, align: "ctr" },
    { name: "Body2.Right", type: "body", idx: 2, x: 7.0, y: 1.6, w: 5.3, h: 5.0, fontSize: 14, font: "minor", color: "muted", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 20-21: Table layouts
  { name: "Table.1Table.Single+1Source", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.5, y: 1.45, w: 12.3, h: 5.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Source.Bottom", type: "body", idx: 2, x: 0.8, y: 6.6, w: 11.0, h: 0.4, fontSize: 10, font: "minor", color: "muted", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "Table.1Table.Single+1Notes", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.5, y: 1.45, w: 8.5, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.7, y: 1.55, w: 2.9, h: 5.1, fontSize: 12, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 22-23: Compare layouts
  { name: "Compare.2Option.Versus", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "OptionLabel1.Left", type: "body", idx: 1, x: 0.8, y: 1.7, w: 5.2, h: 0.5, fontSize: 16, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "OptionContent1.Left", type: "body", idx: 2, x: 0.8, y: 2.3, w: 5.2, h: 4.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "OptionLabel2.Right", type: "body", idx: 3, x: 7.0, y: 1.7, w: 5.3, h: 0.5, fontSize: 16, font: "minor", color: "accent2", bold: true, align: "l" },
    { name: "OptionContent2.Right", type: "body", idx: 4, x: 7.0, y: 2.3, w: 5.3, h: 4.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "Compare.1Matrix.Single", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 24-25: Process layouts
  { name: "Process.4Step.Sequential", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Step1", type: "body", idx: 1, x: 0.5, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Step2", type: "body", idx: 2, x: 3.7, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Step3", type: "body", idx: 3, x: 6.9, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "Step4", type: "body", idx: 4, x: 10.0, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  { name: "Process.3Step.Sequential", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Step1.Top", type: "body", idx: 1, x: 2.8, y: 1.7, w: 9.5, h: 1.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Step2.Center", type: "body", idx: 2, x: 2.8, y: 3.3, w: 9.5, h: 1.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Step3.Bottom", type: "body", idx: 3, x: 2.8, y: 4.9, w: 9.5, h: 1.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 26-27: Summary layouts
  { name: "Summary.1Agenda.Single", family: "dark", decos: [{ x: 4.7, y: 0.5, w: 8.13, h: 6.5, color: "canvas", radius: 0.08 }], placeholders: [
    { name: "Title.Left", type: "body", idx: 15, x: 0.6, y: 1.0, w: 3.5, h: 1.5, fontSize: 36, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "MeetingInfo.Left", type: "body", idx: 16, x: 0.6, y: 2.8, w: 3.5, h: 3.5, fontSize: 14, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "AgendaItems.Right", type: "body", idx: 1, x: 5.0, y: 0.8, w: 7.5, h: 6.0, fontSize: 15, font: "minor", color: "bodyText", bold: false, align: "l" },
  ]},
  { name: "Summary.2Block.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.9, y: 1.7, w: 7.0, h: 5.0, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 9.0, y: 1.7, w: 3.4, h: 5.0, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // 28: Closing.1Message.Single
  { name: "Closing.1Message.Single", family: "dark", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.5, w: 10, h: 0.5, fontSize: 18, font: "minor", color: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "ctrTitle", idx: 0, x: 1.2, y: 2.2, w: 10.5, h: 1.6, fontSize: 42, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "PresenterName.Bottom", type: "body", idx: 11, x: 1.2, y: 5.2, w: 8, h: 0.5, fontSize: 16, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Contact.Bottom", type: "body", idx: 12, x: 1.2, y: 5.8, w: 8, h: 0.8, fontSize: 13, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 29: Closing.1Steps.Single+1Notes
  { name: "Closing.1Steps.Single+1Notes", family: "dark", placeholders: [
    { name: "Title.Left", type: "body", idx: 15, x: 1.2, y: 1.3, w: 6.8, h: 0.7, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "ActionSteps.Left", type: "body", idx: 1, x: 1.2, y: 2.2, w: 6.8, h: 4.0, fontSize: 15, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.1, y: 1.3, w: 3.4, h: 5.0, fontSize: 14, font: "minor", color: "titleText", bold: false, align: "l" },
  ]},
  // 30: SectionNav.1TitleList.Single — 章扉の全章リスト再掲＋現在章強調（#167 / ADR-0032 D2 段階3）。
  // idx15/16/1 は Content.* と同じ canonical idx（title/subtitle/body）— materializeDerivedSlides が
  // 直接 idx-exact でバインドできるよう選定（ADR-0011 pass-1）。
  { name: "SectionNav.1TitleList.Single", family: "dark", placeholders: [
    { name: "Title.Top", type: "body", idx: 15, x: 1.2, y: 1.3, w: 10.5, h: 1.0, fontSize: 34, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Subtitle.Top", type: "body", idx: 16, x: 1.2, y: 2.35, w: 10.5, h: 0.5, fontSize: 15, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "ChapterList.Bottom", type: "body", idx: 1, x: 1.2, y: 3.0, w: 10.5, h: 4.0, fontSize: 17, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
];
