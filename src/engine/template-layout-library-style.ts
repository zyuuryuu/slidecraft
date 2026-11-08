/**
 * template-layout-library-style.ts — スタイル別の組み込みレイアウト（#593・#580 段 2-a「共通構造 I」）。
 *
 * セールスピッチ／エグゼクティブ（#580 の 5 スタイルのうちインパクト重視の 2 つ）が共通して要る構造を
 * canonical 語彙として足す。template-layout-library.ts（BUILTIN_LAYOUTS）は R1（400 行）に近いので、
 * スタイル由来の定義はここに分け、BUILTIN_LAYOUTS の末尾へ連結する（#447 の Kicker 変種と同じ「追加のみ」）。
 *
 * 既存スライドの選択を変えない理由（common-structures-593.test.ts が生成テンプレで検査）:
 *  - Statement / Quote は役割 "statement" / "quote"（template-catalog の FAMILY_TO_ROLE）。どのスライド役割も
 *    これを狙わない（明示マーカーで選ばせる＝#580 裁定 Q1）ので、マーカー無しのスライドは届かない。
 *  - Closing.1CTA+1Contact は役割 "closing" で、本文ありの締めでは Closing.1Steps.Single+1Notes と同点
 *    （本文 2 枠・addon 1）。同点は catalog 順で既存側が勝つので、全レイアウト入りの生成テンプレの選択は
 *    不変。CTA が選ばれるのは、締めの候補に CTA しか持たないプリセット（#595 Pitch 等）だけ。
 *
 * 幾何は既存 family（dark＝背景塗り / light＝canvas＋ヘッダーバー）の規則の範囲で書く（背景色キーや
 * 画像枠は使わない — writer の拡張は #594）。文字サイズは 13pt 以上（12 以下は isChromeBand に掛かる）。
 */
import type { LayoutDef, LayoutPhDef } from "./template-layout-library";

export const STYLE_LAYOUTS: LayoutDef[] = [
  // ステートメント（大きな 1 文）。主枠は見出し（idx 15）＝マガジン 02_ステートメント（64pt のタイトル＋
  // 2 行の本文）と同じ割り付け。本文（idx 1）は 1 文を支える小さな補足行。
  { name: "Statement.1Message.Single", family: "dark", placeholders: [
    { name: "Message.Center", type: "body", idx: 15, x: 1.2, y: 1.6, w: 10.9, h: 3.0, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Supporting.Bottom", type: "body", idx: 1, x: 1.2, y: 5.0, w: 10.9, h: 1.0, fontSize: 18, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  // 引用＋帰属（#403）。引用文が本文 1 枠目（idx 1）、帰属が 2 枠目（idx 2）＝マガジン 07_引用 の
  // コード本文／キャプションと同じ順。
  { name: "Quote.1Message.Single+1Attribution", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Quote.Center", type: "body", idx: 1, x: 1.4, y: 1.9, w: 10.5, h: 3.2, fontSize: 28, font: "major", color: "bodyText", bold: false, align: "l" },
    { name: "Attribution.Bottom", type: "body", idx: 2, x: 1.4, y: 5.3, w: 10.5, h: 0.6, fontSize: 16, font: "minor", color: "muted", bold: false, align: "r" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // CTA 締め（次の行動を大きく＋連絡先）。Closing.1Steps.Single+1Notes と同じ idx 構成（15 / 1 / 2）で、
  // 行動（idx 1）を大きく・連絡先（idx 2）を下段に置く。
  { name: "Closing.1CTA+1Contact", family: "dark", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 1.2, y: 1.3, w: 10.5, h: 0.7, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "CTA.Center", type: "body", idx: 1, x: 1.2, y: 2.3, w: 10.9, h: 2.6, fontSize: 32, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Contact.Bottom", type: "body", idx: 2, x: 1.2, y: 5.3, w: 10.9, h: 1.0, fontSize: 15, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
];

/**
 * プリセット専用のレイアウト（#595 Pitch・#596 Executive〜）。STYLE_LAYOUTS と違い BUILTIN_LAYOUTS には連結しない:
 * 連結すると既存 TemplateSpec（作成 UI 既定・Re-make）の出力が変わる（template-presets.test.ts の
 * LEGACY_DIGEST）。プリセットからだけ名前で引く（template-presets.ts の PRESET_LIBRARY）。
 * family 名から役割が決まる（Closing → closing）ものはカタログ側の追加が要らない。
 */
export const PRESET_LAYOUTS: LayoutDef[] = [
  // 左テキスト｜右画像（#595 Pitch・製品紹介）。画像は picture 枠（#594 の pic 型）に入るので本文を隠さない。
  // 画像枠の idx 20 は content 1〜9・META 10〜12・見出し 15/16・Kicker 40・sldNum 50 と衝突しない自由枠。
  // family 名 Media は FAMILY_TO_ROLE に無いが、カタログは本文枠から content と読む（画像スライドは
  // picture 枠を持つこのレイアウトを優先し、画像の無い本文は先に並ぶ Content.* が取る）。
  { name: "Media.1Body+1Image", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 5.0, h: 5.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Image.Right", type: "pic", idx: 20, x: 6.3, y: 1.6, w: 6.2, h: 5.2, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},  // カード 3 枚（group card・#595 Pitch の課題／価値）。名前 Summary.<N>Block.* は group-layout の名前ヒントで
  // card 3 組と読まれ、`<!-- card -->` だけが届く（どのスライド役割も "summary" を狙わない）。1 組＝見出し＋本文の
  // 2 枠（idx 順＝読み順）で、`:icon:` は見出しの頭に描かれる。結論帯 Callout.Bottom は `Takeaway:` の専用枠
  // （field-rows が名前で認識）。idx 41 は Kicker 40 と同じ自由枠で、組の候補に入らない。
  { name: "Summary.3Block.Equal", family: "light", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
    ...[0.8, 4.9, 9.0].flatMap((x, i): LayoutPhDef[] => [
      { name: `CardHeading${i + 1}`, type: "body", idx: 2 * i + 1, x, y: 1.7, w: 3.5, h: 0.7, fontSize: 20, font: "major", color: "accent", bold: true, align: "l" },
      { name: `CardBody${i + 1}`, type: "body", idx: 2 * i + 2, x, y: 2.5, w: 3.5, h: 3.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    ]),
    { name: "Callout.Bottom", type: "body", idx: 41, x: 0.8, y: 6.1, w: 11.7, h: 0.6, fontSize: 16, font: "minor", color: "emphasis", bold: true, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" },
  ]},
  // Ask 締め（エグゼクティブ・#596）: 意思決定の依頼 1 文（idx 1）を大きく、選択肢／期限（idx 2）を下段に。
  // idx 構成は Closing.1CTA+1Contact と同じ（15 / 1 / 2）＝`<!-- col -->` の 1 列目が依頼・2 列目が選択肢と期限。
  // 本文倍率（density.bodyPt ÷ 14）は 21pt 以下の枠だけに掛かる（PR #635 裁定 B）。Ask は表示用サイズ（倍率の
  // 対象外）なので最終サイズ 37pt を直接書く（裁定前の 26pt × 20/14 と同じ描画）。Decision 13pt は倍率が掛かる。
  // 見出しは依頼のラベルとして accent の小さめの太字（タイトル系統は倍率の対象外）。
  { name: "Closing.1Ask+1Decision", family: "dark", decos: [{ x: 1.2, y: 4.55, w: 1.2, h: 0.06, color: "accent" }], placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 1.2, y: 1.0, w: 10.9, h: 0.7, fontSize: 24, font: "major", color: "accent", bold: true, align: "l" },
    { name: "Ask.Center", type: "body", idx: 1, x: 1.2, y: 1.9, w: 10.9, h: 2.4, fontSize: 37, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Decision.Bottom", type: "body", idx: 2, x: 1.2, y: 4.8, w: 10.9, h: 1.6, fontSize: 13, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
  ...CAMPAIGN_LAYOUTS(),
];

/**
 * マーケ「Campaign」（#598・#580 段 3）の画像構造・色面の章扉・下寄せの締め。picture 枠（#594 の pic 型）の idx は
 * Media.1Body+1Image と同じ自由枠 20〜（読み順＝左上→右上→左下→右下。画像の ordinal は idx 順の N 番目の
 * picture 枠に入る＝visual-placement.imagePlaceholder）。Image.* / Gallery.* は役割 "image" / "gallery"
 * （template-catalog の FAMILY_TO_ROLE）で、画像だけのスライド（slide-role-regions の visual）からしか届かない。
 * 幾何は基準余白 0.8in で書き、プリセットの余白（withHorizontalMargin）で縮める。全面の枠だけは縮めない。
 */
function CAMPAIGN_LAYOUTS(): LayoutDef[] {
  const header: LayoutPhDef[] = [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, font: "minor", color: "subtle", bold: false, align: "l" },
  ];
  const sldNum: LayoutPhDef = { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, font: "minor", color: "muted", bold: false, align: "r" };
  const pic = (i: number, x: number, y: number, w: number, h: number): LayoutPhDef =>
    ({ name: `Image${i + 1}`, type: "pic", idx: 20 + i, x, y, w, h, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" });
  return [
    // 全面画像＋左下の小さなキャプション（作品名＝スライドのタイトル）。画像は `{behind=1}` の背景画像で、
    // 全面の picture 枠の箱に描かれる（imageRect）。キャプションは画像の上に載るので canvas 色。
    { name: "Image.FullBleed+1Caption", family: "dark", placeholders: [
      { ...pic(0, 0, 0, 13.333, 7.5), name: "Image.Full" },
      { name: "Caption.BottomLeft", type: "body", idx: 15, x: 0.8, y: 6.6, w: 7.5, h: 0.45, fontSize: 14, font: "minor", color: "canvas", bold: false, align: "l" },
    ]},
    // 左キャプション｜右画像（画像が主役。Media.1Body+1Image より本文を細く・画像を大きく）。
    { name: "Media.1Caption+1Image", family: "light", placeholders: [
      ...header,
      { name: "Caption.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 3.3, h: 5.2, fontSize: 13, font: "minor", color: "bodyText", bold: false, align: "l" },
      { ...pic(0, 4.5, 1.4, 8.033, 5.6), name: "Image.Right" },
      sldNum,
    ]},
    // 並置 2 枚（対作品）と 2×2 グリッド（連作・ロゴ壁）。
    { name: "Gallery.2Image.Equal", family: "light", placeholders: [
      ...header, pic(0, 0.8, 1.4, 5.716, 5.4), pic(1, 6.816, 1.4, 5.716, 5.4), sldNum,
    ]},
    { name: "Gallery.4Image.Grid", family: "light", placeholders: [
      ...header,
      pic(0, 0.8, 1.3, 5.716, 2.65), pic(1, 6.816, 1.3, 5.716, 2.65),
      pic(2, 0.8, 4.15, 5.716, 2.65), pic(3, 6.816, 4.15, 5.716, 2.65),
      sldNum,
    ]},
    // 色面の章扉: 背景を accent（低彩度の 1 色）で塗り、文字は canvas 色。役割 section（タイトルだけのスライド）。
    { name: "Section.1Title.ColorField", family: "dark", bg: "accent", placeholders: [
      { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 2.6, w: 10.9, h: 1.5, fontSize: 44, font: "major", color: "canvas", bold: false, align: "l" },
      { name: "Subtitle.Center", type: "body", idx: 16, x: 1.2, y: 4.3, w: 10.9, h: 0.6, fontSize: 18, font: "minor", color: "canvas", bold: false, align: "l" },
    ]},
    // 下寄せ小文字の締め（経歴・連絡先）: 見出しも本文も下半分に置き、上を余白にする。
    { name: "Closing.1Notes.Bottom", family: "dark", placeholders: [
      { name: "Title.Left", type: "body", idx: 15, x: 1.2, y: 4.1, w: 10.9, h: 0.7, fontSize: 28, font: "major", color: "titleText", bold: false, align: "l" },
      { name: "Notes.Bottom", type: "body", idx: 1, x: 1.2, y: 4.95, w: 10.9, h: 1.7, fontSize: 13, font: "minor", color: "subtle", bold: false, align: "l" },
    ]},
  ];
}
