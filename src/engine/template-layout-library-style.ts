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
import type { LayoutDef } from "./template-layout-library";

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
 * プリセット専用のレイアウト（#596〜）。BUILTIN_LAYOUTS には連結しない＝作成 UI の既定（内蔵全レイアウト）・
 * Re-make・既存の生成テンプレの出力は不変。StylePreset.layouts から名前で引く（template-presets の
 * PRESET_LIBRARY）。family 名から役割が決まる（Closing → closing）ので、カタログ側の追加は要らない。
 */
export const PRESET_ONLY_LAYOUTS: LayoutDef[] = [
  // Ask 締め（エグゼクティブ・#596）: 意思決定の依頼 1 文（idx 1）を大きく、選択肢／期限（idx 2）を下段に。
  // idx 構成は Closing.1CTA+1Contact と同じ（15 / 1 / 2）＝`<!-- col -->` の 1 列目が依頼・2 列目が選択肢と期限。
  // 文字サイズはプリセットの本文倍率（density.bodyPt ÷ 14）が掛かる前の値（Ask 26pt → 20/14 倍で約 37pt）。
  // 見出しは依頼のラベルとして accent の小さめの太字（タイトル系統は倍率の対象外）。
  { name: "Closing.1Ask+1Decision", family: "dark", decos: [{ x: 1.2, y: 4.55, w: 1.2, h: 0.06, color: "accent" }], placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 1.2, y: 1.0, w: 10.9, h: 0.7, fontSize: 24, font: "major", color: "accent", bold: true, align: "l" },
    { name: "Ask.Center", type: "body", idx: 1, x: 1.2, y: 1.9, w: 10.9, h: 2.4, fontSize: 26, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Decision.Bottom", type: "body", idx: 2, x: 1.2, y: 4.8, w: 10.9, h: 1.6, fontSize: 13, font: "minor", color: "subtle", bold: false, align: "l" },
  ]},
];
