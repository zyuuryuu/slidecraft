/**
 * rebuild-template.ts — Rebuild the 30-layout template PPTX with correct
 * placeholder definitions, OOXML style hierarchy, and decorative shapes.
 *
 * Usage: npx tsx scripts/rebuild-template.ts
 *
 * Source of truth: create_30_layouts.py placeholder definitions.
 * This script patches the existing template to ensure all placeholders exist
 * with correct idx, type, position, size, and lstStyle overrides.
 */

import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const EMU = (inches: number) => Math.round(inches * 914400);

// ── Color palette ──
const C: Record<string, string> = {
  navy: "1E2761",
  dark_navy: "141B41",
  ice_blue: "CADCFC",
  white: "FFFFFF",
  light_gray: "F5F7FA",
  panel_gray: "EDF0F7",
  mid_gray: "94A3B8",
  dark_text: "1E293B",
  accent: "3B82F6",
  accent_dark: "2563EB",
  teal: "06B6D4",
  amber: "F59E0B",
  soft_navy: "2D3A6E",
  card_bg: "F0F4FF",
};

// ── Placeholder definition ──
interface PhDef {
  name: string;
  type: string; // "body", "ctrTitle", "subTitle", "sldNum"
  idx: number;
  x: number; y: number; w: number; h: number; // inches
  fontSize: number; // pt
  fontName: string; // "Georgia" or "Calibri"
  fontColor: string; // hex key into C
  bold: boolean;
  align: string; // "l", "ctr", "r"
}

// Master defaults for reference:
// titleStyle: sz=4400, b=1, font=+mj-lt(Georgia), color=FFFFFF, align=l
// bodyStyle:  sz=1400, font=+mn-lt(Calibri), color=1E293B, align=l

// ── All 30 layouts with their placeholders ──
// From create_30_layouts.py — complete and verified

const LAYOUTS: { name: string; placeholders: PhDef[] }[] = [
  // 0: Title.1Title.Single
  { name: "Title.1Title.Single", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.5, w: 9, h: 0.45, fontSize: 15, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "ctrTitle", idx: 0, x: 1.2, y: 2.1, w: 10.5, h: 1.5, fontSize: 48, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Subtitle.Center", type: "subTitle", idx: 1, x: 1.2, y: 3.7, w: 9, h: 0.7, fontSize: 20, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Date.Bottom", type: "body", idx: 11, x: 1.2, y: 5.6, w: 8, h: 0.4, fontSize: 14, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Footer.Bottom", type: "body", idx: 12, x: 1.2, y: 6.1, w: 4, h: 0.3, fontSize: 11, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 1: Title.1Title.Single+1Meta
  { name: "Title.1Title.Single+1Meta", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.2, w: 6.5, h: 0.4, fontSize: 14, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Left", type: "ctrTitle", idx: 0, x: 1.2, y: 1.8, w: 7.0, h: 1.8, fontSize: 44, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Subtitle.Left", type: "subTitle", idx: 1, x: 1.2, y: 3.8, w: 7.0, h: 0.6, fontSize: 18, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Meta.Right", type: "body", idx: 11, x: 9.1, y: 1.6, w: 3.2, h: 3.8, fontSize: 13, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Footer.Bottom", type: "body", idx: 12, x: 1.2, y: 6.2, w: 6, h: 0.3, fontSize: 11, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 2: Title.1Title.Single+1Summary
  { name: "Title.1Title.Single+1Summary", placeholders: [
    { name: "CategoryLabel.Left", type: "body", idx: 10, x: 1.2, y: 1.5, w: 5.5, h: 0.4, fontSize: 14, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Left", type: "ctrTitle", idx: 0, x: 1.2, y: 2.1, w: 5.8, h: 2.0, fontSize: 42, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Subtitle.Left", type: "subTitle", idx: 1, x: 1.2, y: 4.3, w: 5.5, h: 0.6, fontSize: 16, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Summary.Right", type: "body", idx: 11, x: 8.0, y: 1.2, w: 4.8, h: 5.5, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Date.Bottom", type: "body", idx: 12, x: 1.2, y: 6.2, w: 5, h: 0.3, fontSize: 11, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 3: Section.1Title.Single
  { name: "Section.1Title.Single", placeholders: [
    { name: "SectionLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.1, w: 5, h: 0.4, fontSize: 13, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 1.8, w: 10.5, h: 2.2, fontSize: 40, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Description.Bottom", type: "body", idx: 11, x: 1.2, y: 4.5, w: 10, h: 1.5, fontSize: 16, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 4: SectionNav.1Title.Single
  { name: "SectionNav.1Title.Single", placeholders: [
    { name: "SectionNumber.Left", type: "body", idx: 10, x: 1.0, y: 1.5, w: 2.4, h: 2.5, fontSize: 80, fontName: "Georgia", fontColor: "accent", bold: true, align: "ctr" },
    { name: "SectionLabel.Left", type: "body", idx: 11, x: 1.0, y: 4.0, w: 2.4, h: 0.4, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "ctr" },
    { name: "Title.Right", type: "body", idx: 15, x: 4.2, y: 1.5, w: 8.5, h: 2.0, fontSize: 38, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Description.Right", type: "body", idx: 12, x: 4.2, y: 4.0, w: 8.5, h: 2.0, fontSize: 16, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 5: SectionBreak.1Title.Single
  { name: "SectionBreak.1Title.Single", placeholders: [
    { name: "SectionLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.2, w: 10, h: 0.4, fontSize: 13, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 3.0, w: 10.5, h: 1.5, fontSize: 44, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Description.Bottom", type: "body", idx: 11, x: 1.2, y: 5.3, w: 10, h: 1.2, fontSize: 15, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 6: Content.1Body.Single
  { name: "Content.1Body.Single", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.45, w: 11.7, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 7: Content.1Body.Single+1Notes
  { name: "Content.1Body.Single+1Notes", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 8.2, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.7, y: 1.65, w: 3.0, h: 5.1, fontSize: 12, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 8: Content.1Body.Single+1Source
  { name: "Content.1Body.Single+1Source", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.45, w: 11.7, h: 4.8, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Source.Bottom", type: "body", idx: 2, x: 0.8, y: 6.65, w: 11.0, h: 0.6, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 9: Content.1Body.Single+1Callout
  { name: "Content.1Body.Single+1Callout", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Callout.Top", type: "body", idx: 2, x: 1.1, y: 1.5, w: 11.2, h: 0.85, fontSize: 13, fontName: "Calibri", fontColor: "navy", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 2.8, w: 11.7, h: 4.1, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 10: Column.2Body.Equal
  { name: "Column.2Body.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 6.8, y: 1.45, w: 5.7, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 11: Column.2Body.MainSub
  { name: "Column.2Body.MainSub", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 7.4, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 8.8, y: 1.55, w: 3.8, h: 5.1, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 12: Column.3Body.Equal
  { name: "Column.3Body.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Body2.Center", type: "body", idx: 2, x: 4.7, y: 1.45, w: 3.5, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Body3.Right", type: "body", idx: 3, x: 8.6, y: 1.45, w: 3.9, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 13-16: KPI layouts
  { name: "KPI.1Value.Single", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Value.Center", type: "body", idx: 1, x: 3.5, y: 2.2, w: 6.5, h: 2.0, fontSize: 72, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "ValueLabel.Center", type: "body", idx: 2, x: 3.5, y: 4.2, w: 6.5, h: 0.5, fontSize: 18, fontName: "Calibri", fontColor: "dark_text", bold: true, align: "ctr" },
    { name: "ValueDesc.Center", type: "body", idx: 3, x: 3.5, y: 4.8, w: 6.5, h: 1.0, fontSize: 13, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "KPI.2Value.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Value1.Left", type: "body", idx: 1, x: 1.2, y: 2.0, w: 4.6, h: 1.8, fontSize: 60, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "ValueLabel1.Left", type: "body", idx: 2, x: 1.2, y: 3.9, w: 4.6, h: 2.5, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Value2.Right", type: "body", idx: 3, x: 7.2, y: 2.0, w: 4.8, h: 1.8, fontSize: 60, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "ValueLabel2.Right", type: "body", idx: 4, x: 7.2, y: 3.9, w: 4.8, h: 2.5, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "KPI.3Value.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Value1", type: "body", idx: 1, x: 0.8, y: 2.0, w: 3.2, h: 1.5, fontSize: 52, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "Label1", type: "body", idx: 2, x: 0.8, y: 3.6, w: 3.2, h: 2.8, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Value2", type: "body", idx: 3, x: 4.9, y: 2.0, w: 3.4, h: 1.5, fontSize: 52, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "Label2", type: "body", idx: 4, x: 4.9, y: 3.6, w: 3.4, h: 2.8, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Value3", type: "body", idx: 5, x: 9.2, y: 2.0, w: 3.3, h: 1.5, fontSize: 52, fontName: "Georgia", fontColor: "navy", bold: true, align: "ctr" },
    { name: "Label3", type: "body", idx: 6, x: 9.2, y: 3.6, w: 3.3, h: 2.8, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "KPI.4Value.Grid", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Value1.TL", type: "body", idx: 1, x: 1.0, y: 1.6, w: 4.8, h: 2.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Value2.TR", type: "body", idx: 2, x: 7.2, y: 1.6, w: 5.0, h: 2.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Value3.BL", type: "body", idx: 3, x: 1.0, y: 4.4, w: 4.8, h: 2.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Value4.BR", type: "body", idx: 4, x: 7.2, y: 4.4, w: 5.0, h: 2.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 17-19: Chart layouts
  { name: "Chart.1Chart.Single", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.8, y: 1.6, w: 11.7, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "Chart.1Chart.Single+1Analysis", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 6.9, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "ctr" },
    { name: "Analysis.Right", type: "body", idx: 2, x: 8.4, y: 1.5, w: 4.4, h: 5.3, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "Chart.2Chart.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.8, y: 1.6, w: 5.3, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "ctr" },
    { name: "Body2.Right", type: "body", idx: 2, x: 7.0, y: 1.6, w: 5.3, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 20-21: Table layouts
  { name: "Table.1Table.Single+1Source", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Center", type: "body", idx: 1, x: 0.5, y: 1.45, w: 12.3, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Source.Bottom", type: "body", idx: 2, x: 0.8, y: 6.6, w: 11.0, h: 0.4, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "Table.1Table.Single+1Notes", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.5, y: 1.45, w: 8.5, h: 5.4, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.7, y: 1.55, w: 2.9, h: 5.1, fontSize: 12, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 22-23: Compare layouts
  { name: "Compare.2Option.Versus", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "OptionLabel1.Left", type: "body", idx: 1, x: 0.8, y: 1.7, w: 5.2, h: 0.5, fontSize: 16, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "OptionContent1.Left", type: "body", idx: 2, x: 0.8, y: 2.3, w: 5.2, h: 4.2, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "OptionLabel2.Right", type: "body", idx: 3, x: 7.0, y: 1.7, w: 5.3, h: 0.5, fontSize: 16, fontName: "Calibri", fontColor: "teal", bold: true, align: "l" },
    { name: "OptionContent2.Right", type: "body", idx: 4, x: 7.0, y: 2.3, w: 5.3, h: 4.2, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "Compare.1Matrix.Single", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 24-25: Process layouts
  { name: "Process.4Step.Sequential", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Step1", type: "body", idx: 1, x: 0.5, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Step2", type: "body", idx: 2, x: 3.7, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Step3", type: "body", idx: 3, x: 6.9, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "Step4", type: "body", idx: 4, x: 10.0, y: 3.6, w: 2.8, h: 3.0, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "ctr" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  { name: "Process.3Step.Sequential", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Step1.Top", type: "body", idx: 1, x: 2.8, y: 1.7, w: 9.5, h: 1.2, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Step2.Center", type: "body", idx: 2, x: 2.8, y: 3.3, w: 9.5, h: 1.2, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Step3.Bottom", type: "body", idx: 3, x: 2.8, y: 4.9, w: 9.5, h: 1.2, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 26-27: Summary layouts
  { name: "Summary.1Agenda.Single", placeholders: [
    { name: "Title.Left", type: "body", idx: 15, x: 0.6, y: 1.0, w: 3.5, h: 1.5, fontSize: 36, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "MeetingInfo.Left", type: "body", idx: 16, x: 0.6, y: 2.8, w: 3.5, h: 3.5, fontSize: 14, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "AgendaItems.Right", type: "body", idx: 1, x: 5.0, y: 0.8, w: 7.5, h: 6.0, fontSize: 15, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
  ]},
  { name: "Summary.2Block.Equal", placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "SlideSubtitle.Header", type: "body", idx: 16, x: 0.8, y: 0.72, w: 10, h: 0.3, fontSize: 12, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Body1.Left", type: "body", idx: 1, x: 0.9, y: 1.7, w: 7.0, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "Body2.Right", type: "body", idx: 2, x: 9.0, y: 1.7, w: 3.4, h: 5.0, fontSize: 13, fontName: "Calibri", fontColor: "dark_text", bold: false, align: "l" },
    { name: "SlideNum.Footer", type: "sldNum", idx: 50, x: 12.0, y: 7.05, w: 1.2, h: 0.3, fontSize: 10, fontName: "Calibri", fontColor: "mid_gray", bold: false, align: "r" },
  ]},
  // 28: Closing.1Message.Single
  { name: "Closing.1Message.Single", placeholders: [
    { name: "CategoryLabel.Top", type: "body", idx: 10, x: 1.2, y: 1.5, w: 10, h: 0.5, fontSize: 18, fontName: "Calibri", fontColor: "accent", bold: true, align: "l" },
    { name: "Title.Center", type: "ctrTitle", idx: 0, x: 1.2, y: 2.2, w: 10.5, h: 1.6, fontSize: 42, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "PresenterName.Bottom", type: "body", idx: 11, x: 1.2, y: 5.2, w: 8, h: 0.5, fontSize: 16, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Contact.Bottom", type: "body", idx: 12, x: 1.2, y: 5.8, w: 8, h: 0.8, fontSize: 13, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
  // 29: Closing.1Steps.Single+1Notes
  { name: "Closing.1Steps.Single+1Notes", placeholders: [
    { name: "Title.Left", type: "body", idx: 15, x: 1.2, y: 1.3, w: 6.8, h: 0.7, fontSize: 28, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "ActionSteps.Left", type: "body", idx: 1, x: 1.2, y: 2.2, w: 6.8, h: 4.0, fontSize: 15, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "Notes.Right", type: "body", idx: 2, x: 9.1, y: 1.3, w: 3.4, h: 5.0, fontSize: 14, fontName: "Calibri", fontColor: "white", bold: false, align: "l" },
  ]},
  // 30: SectionNav.1TitleList.Single（#167 — physically added by scripts/add-section-nav-list-layout.ts;
  // listed here so a future rebuild() re-run stays in sync with template-layout-library.ts）
  { name: "SectionNav.1TitleList.Single", placeholders: [
    { name: "Title.Top", type: "body", idx: 15, x: 1.2, y: 1.3, w: 10.5, h: 1.0, fontSize: 34, fontName: "Georgia", fontColor: "white", bold: true, align: "l" },
    { name: "Subtitle.Top", type: "body", idx: 16, x: 1.2, y: 2.35, w: 10.5, h: 0.5, fontSize: 15, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
    { name: "ChapterList.Bottom", type: "body", idx: 1, x: 1.2, y: 3.0, w: 10.5, h: 4.0, fontSize: 17, fontName: "Calibri", fontColor: "ice_blue", bold: false, align: "l" },
  ]},
];

// Master defaults
const MASTER_TITLE = { sz: 4400, bold: true, fontName: "Georgia", color: "FFFFFF" };
const MASTER_BODY = { sz: 1400, bold: false, fontName: "Calibri", color: "1E293B" };

function buildLstStyleOverride(ph: PhDef): string {
  // Determine master defaults based on placeholder type
  const isTitleType = ph.type === "ctrTitle" || ph.type === "title";
  const master = isTitleType ? MASTER_TITLE : MASTER_BODY;

  const sz = ph.fontSize * 100;
  const color = C[ph.fontColor] || ph.fontColor;

  // Only include attributes that differ from master
  const needsSz = sz !== master.sz;
  const needsBold = ph.bold !== master.bold;
  const needsColor = color !== master.color;
  const needsAlign = ph.align !== "l";

  if (!needsSz && !needsBold && !needsColor && !needsAlign) {
    return "<a:lstStyle/>";
  }

  let defRPrAttrs = "";
  let defRPrChildren = "";
  let defPPrAttrs = "";

  if (needsSz) defRPrAttrs += ` sz="${sz}"`;
  if (needsBold) defRPrAttrs += ` b="${ph.bold ? "1" : "0"}"`;
  if (needsColor) {
    defRPrChildren += `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  }
  if (needsAlign) defPPrAttrs += ` algn="${ph.align}"`;

  return `<a:lstStyle><a:defPPr${defPPrAttrs}><a:defRPr${defRPrAttrs}>${defRPrChildren}</a:defRPr></a:defPPr></a:lstStyle>`;
}

function buildPhShapeXml(ph: PhDef, shapeId: number): string {
  const typeAttr = ph.type ? ` type="${ph.type}"` : "";
  const idxAttr = ` idx="${ph.idx}"`;
  const lstStyle = buildLstStyleOverride(ph);

  return `<p:sp>`
    + `<p:nvSpPr>`
    + `<p:cNvPr id="${shapeId}" name="${ph.name}"/>`
    + `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>`
    + `<p:nvPr><p:ph${typeAttr}${idxAttr}/></p:nvPr>`
    + `</p:nvSpPr>`
    + `<p:spPr>`
    + `<a:xfrm><a:off x="${EMU(ph.x)}" y="${EMU(ph.y)}"/><a:ext cx="${EMU(ph.w)}" cy="${EMU(ph.h)}"/></a:xfrm>`
    + `</p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" anchor="t" anchorCtr="0"/>`
    + lstStyle
    + `<a:p><a:r><a:rPr lang="ja-JP"/><a:t> </a:t></a:r></a:p>`
    + `</p:txBody>`
    + `</p:sp>`;
}

async function rebuild() {
  const basePath = resolve("public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx");
  const zip = await JSZip.loadAsync(readFileSync(basePath));

  for (let i = 0; i < LAYOUTS.length; i++) {
    const layout = LAYOUTS[i];
    const layoutIndex = i + 1;
    const path = `ppt/slideLayouts/slideLayout${layoutIndex}.xml`;
    const origXml = await zip.file(path)!.async("string");

    // Preserve decorative shapes (non-placeholder) from original
    // Normalize namespace
    let norm = origXml;
    for (let n = 0; n <= 9; n++) {
      norm = norm.split(`<ns${n}:`).join("<p:").split(`</ns${n}:`).join("</p:");
    }
    // Also normalize drawingml ns
    norm = norm.replace(/<p:xfrm/g, "<a:xfrm").replace(/<\/p:xfrm/g, "</a:xfrm")
      .replace(/<p:off /g, "<a:off ").replace(/<p:ext /g, "<a:ext ")
      .replace(/<p:solidFill/g, "<a:solidFill").replace(/<\/p:solidFill/g, "</a:solidFill")
      .replace(/<p:srgbClr/g, "<a:srgbClr").replace(/<p:noFill/g, "<a:noFill")
      // prstGeom は avLst 子要素を持つ非自己閉鎖形があるため閉じタグも置換する（置換漏れが
      // </p:prstGeom> の整形式違反として canonical に混入していた — tests/pptx-wellformed.test.ts）
      .replace(/<p:prstGeom/g, "<a:prstGeom").replace(/<\/p:prstGeom/g, "</a:prstGeom")
      .replace(/<p:spLocks/g, "<a:spLocks")
      .replace(/<p:avLst/g, "<a:avLst").replace(/<\/p:avLst/g, "</a:avLst")
      .replace(/<p:gd /g, "<a:gd ").replace(/<p:ln/g, "<a:ln").replace(/<\/p:ln/g, "</a:ln");

    const decoShapes = (norm.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [])
      .filter(sp => !sp.includes("<p:ph"));

    // Build new layout XML
    let shapeId = 2;
    let shapesXml = "";

    // Add decorative shapes first
    for (const deco of decoShapes) {
      shapesXml += deco.replace(/id="\d+"/, `id="${shapeId}"`);
      shapeId++;
    }

    // Add placeholder shapes
    for (const ph of layout.placeholders) {
      shapesXml += buildPhShapeXml(ph, shapeId);
      shapeId++;
    }

    // Extract layout type from original
    const typeMatch = origXml.match(/type="(\w+)"/);
    const layoutType = typeMatch?.[1] || "blank";

    const newXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>`
      + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
      + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
      + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
      + ` type="${layoutType}" preserve="1">`
      + `<p:cSld name="${layout.name}"><p:spTree>`
      + `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
      + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
      + shapesXml
      + `</p:spTree></p:cSld>`
      + `<p:clrMapOvr/>`
      + `</p:sldLayout>`;

    zip.file(path, newXml);
    console.log(`  Layout ${layoutIndex}: ${layout.name} (${decoShapes.length} decos + ${layout.placeholders.length} phs)`);
  }

  // Save the rebuilt template back to public/ (the source the app fetches at runtime) AND to the
  // test-fixtures copy (tests read from tests/fixtures/, isolated from public/) so they never drift.
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const outs = [
    "public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
    "tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
  ];
  for (const out of outs) {
    writeFileSync(resolve(out), buf);
    console.log(`  Saved: ${out}`);
  }

  // Verify
  const verify = await JSZip.loadAsync(buf);
  let totalPhs = 0;
  for (let i = 1; i <= LAYOUTS.length; i++) {
    const xml = await verify.file(`ppt/slideLayouts/slideLayout${i}.xml`)!.async("string");
    const phs = (xml.match(/<p:ph/g) || []).length;
    totalPhs += phs;
  }
  console.log(`\n  Total placeholders: ${totalPhs}`);
}

rebuild().catch(console.error);
