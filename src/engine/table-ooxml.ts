/**
 * table-ooxml.ts — Render a TableBlock to a NATIVE PowerPoint table
 * (`<p:graphicFrame><a:tbl>`) placed at a placeholder's box. Editable in
 * PowerPoint, not an image. Self-contained INLINE styling (cell fills + borders),
 * so it needs no tableStyles part from the template. Pure logic (R2): no DOM/Tauri.
 */

import { computeColumnWidthsEmu, computeNumericColumns } from "./table-layout";

const EMU = (inches: number) => Math.round(inches * 914400);
const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Hex colours (no #). Header = navy fill / white bold; body = white or banded / dark text.
const HEADER_FILL = "1E2761";
const HEADER_TEXT = "FFFFFF";
const BODY_TEXT = "1E293B";
const BAND_FILL = "F1F4F9";
const BORDER = "C8D0DC";

function border(tag: string): string {
  return `<a:${tag} w="6350" cap="flat"><a:solidFill><a:srgbClr val="${BORDER}"/></a:solidFill></a:${tag}>`;
}

function cellXml(text: string, isHeader: boolean, band: boolean, rightAlign: boolean): string {
  const color = isHeader ? HEADER_TEXT : BODY_TEXT;
  const fill = isHeader ? HEADER_FILL : band ? BAND_FILL : "FFFFFF";
  const bold = isHeader ? ` b="1"` : "";
  const pPr = rightAlign ? `<a:pPr algn="r"/>` : "";
  const run = text
    ? `<a:r><a:rPr lang="en-US" sz="1100"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`
    : `<a:endParaRPr lang="en-US" sz="1100"/>`;
  return (
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${pPr}${run}</a:p></a:txBody>` +
    `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">` +
    border("lnL") + border("lnR") + border("lnT") + border("lnB") +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`
  );
}

/** A native table graphicFrame for `rows` at `box` (inches), with shape id `id`. */
export function tableGraphicFrameXml(
  rows: string[][],
  header: boolean,
  box: { x: number; y: number; w: number; h: number },
  id: number,
): string {
  const ncol = Math.max(1, ...rows.map((r) => r.length));
  const colWidths = computeColumnWidthsEmu(rows, box.w);
  const numericCols = computeNumericColumns(rows, header);
  const rowH = Math.round(EMU(box.h) / Math.max(1, rows.length));
  const grid = colWidths.map((w) => `<a:gridCol w="${w}"/>`).join("");
  const trs = rows
    .map((r, ri) => {
      const isHeader = header && ri === 0;
      const cells = Array.from({ length: ncol }, (_, ci) =>
        cellXml(r[ci] ?? "", isHeader, !isHeader && ri % 2 === 0, numericCols[ci]),
      ).join("");
      return `<a:tr h="${rowH}">${cells}</a:tr>`;
    })
    .join("");
  return (
    `<p:graphicFrame>` +
    `<p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${EMU(box.x)}" y="${EMU(box.y)}"/><a:ext cx="${EMU(box.w)}" cy="${EMU(box.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="${header ? 1 : 0}"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}
