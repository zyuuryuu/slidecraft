/**
 * FigureList.tsx — #392 段 3: the SlideEditor's list of a slide's body visuals (figures), shown only when
 * the slide has two or more (a single-visual slide gets nothing new). Each row can move earlier / later
 * (= the order they are written to Markdown and placed into body regions) and be deleted; a 2nd+ diagram
 * or Mermaid block gets its source field here (the first of each kind keeps DiagramEditor / the image
 * block below). Every change goes through the one writer, engine/slide-figure-edit (R8).
 */
import { useTranslation } from "react-i18next";
import type { SlideIR, FigureBlock } from "../engine/slide-schema";
import { slideFigures } from "../engine/slide-figures";
import { moveFigure, removeFigure, updateFigure } from "../engine/slide-figure-edit";

interface FigureListProps {
  slide: SlideIR;
  onChange: (updated: SlideIR) => void;
}

/** A one-line hint of what the visual is (diagram type + first label / first line / alt / table size). */
function summary(f: FigureBlock): string {
  const firstLine = (s: string) => s.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  switch (f.kind) {
    case "diagram": return [f.yaml.match(/^type:\s*(\S+)/m)?.[1], f.yaml.match(/label:\s*(.+)/)?.[1]?.trim()].filter(Boolean).join(" · ");
    case "mermaid": return firstLine(f.mermaid);
    case "table": return `${f.rows.length} × ${f.rows[0]?.length ?? 0}`;
    case "code": return firstLine(f.content);
    case "image": return f.alt;
  }
}

const BTN = "w-6 h-6 flex items-center justify-center rounded bg-field border border-edge text-fg2 text-xs shrink-0 disabled:opacity-40";

export default function FigureList({ slide, onChange }: FigureListProps) {
  const { t } = useTranslation();
  const figures = slideFigures(slide);
  if (figures.length < 2) return null;
  const seen = new Set<string>();
  return (
    <div className="border border-edge rounded p-2 flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wider text-faint">{t("slideEditor.figureList")}</div>
      {figures.map((f, n) => {
        const primary = !seen.has(f.kind);
        seen.add(f.kind);
        const source = !primary && f.kind === "diagram" ? f.yaml : !primary && f.kind === "mermaid" ? f.mermaid : undefined;
        return (
          <div key={n} data-figure-row={n} data-kind={f.kind} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-fg2 shrink-0">{n + 1}. {t(`slideEditor.figureKind.${f.kind}`)}</span>
              <span className="flex-1 min-w-0 truncate text-faint">{summary(f)}</span>
              <button type="button" className={`${BTN} hover:border-accent/60`} disabled={n === 0} title={t("slideEditor.figureUp")} onClick={() => onChange(moveFigure(slide, n, n - 1))}>↑</button>
              <button type="button" className={`${BTN} hover:border-accent/60`} disabled={n === figures.length - 1} title={t("slideEditor.figureDown")} onClick={() => onChange(moveFigure(slide, n, n + 1))}>↓</button>
              <button type="button" className={`${BTN} hover:bg-danger hover:text-on-accent`} title={t("slideEditor.figureDelete")} onClick={() => onChange(removeFigure(slide, n))}>🗑</button>
            </div>
            {source !== undefined && (
              <textarea
                value={source}
                onChange={(e) => onChange(updateFigure(slide, n, f.kind === "diagram" ? { ...f, yaml: e.target.value } : { ...f, mermaid: e.target.value } as FigureBlock))}
                rows={4}
                className="w-full px-2 py-1.5 bg-field border border-edge rounded text-xs text-fg font-mono resize-y"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
