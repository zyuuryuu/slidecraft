/**
 * SlideEditor.tsx — Per-slide editing panel.
 *
 * Shows editable fields for each placeholder in the selected slide.
 * For diagram slides, shows the YAML editor inline.
 */

import { useCallback } from "react";
import type { SlideIR, PlaceholderContent, Paragraph } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { LAYOUT_NAMES } from "../engine/slide-schema";

interface SlideEditorProps {
  slide: SlideIR;
  layout: LayoutInfo | undefined;
  onChange: (updated: SlideIR) => void;
}

// ── Placeholder label mapping ──

const PH_LABELS: Record<string, string> = {
  "0": "Title",
  "1": "Body / Subtitle",
  "2": "Secondary",
  "3": "Tertiary",
  "4": "Quaternary",
  "5": "Fifth",
  "6": "Sixth",
  "10": "Category",
  "11": "Date / Meta",
  "12": "Footer",
  "15": "Slide Title",
  "16": "Slide Subtitle",
  "50": "Slide Number",
};

function getLabel(idx: string, layoutPh: LayoutInfo | undefined): string {
  const phInfo = layoutPh?.placeholders.find((p) => p.idx === idx);
  if (phInfo?.name) return phInfo.name;
  return PH_LABELS[idx] || `Placeholder ${idx}`;
}

// ── Convert paragraphs to plain text for textarea ──

function paragraphsToText(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      const text = p.segments.map((s) => {
        let t = s.text;
        if (s.bold) t = `**${t}**`;
        if (s.italic) t = `*${t}*`;
        return t;
      }).join("");
      return p.bullet ? `- ${text}` : text;
    })
    .join("\n");
}

// ── Convert plain text back to paragraphs ──

function textToParagraphs(text: string): Paragraph[] {
  return text.split("\n").map((line) => {
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const content = bulletMatch ? bulletMatch[1] : line;

    // Parse inline formatting
    const segments: { text: string; bold?: boolean; italic?: boolean }[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[2]) segments.push({ text: m[2], bold: true });
      else if (m[3]) segments.push({ text: m[3], italic: true });
      else if (m[4]) segments.push({ text: m[4] });
    }
    if (segments.length === 0) segments.push({ text: content });

    return {
      segments,
      ...(bulletMatch ? { bullet: true } : {}),
    };
  });
}

export default function SlideEditor({ slide, layout, onChange }: SlideEditorProps) {
  // ── Update a specific placeholder ──
  const updatePlaceholder = useCallback(
    (idx: string, text: string) => {
      const newParagraphs = textToParagraphs(text);
      const existing = slide.placeholders.find((p) => p.idx === idx);
      let newPlaceholders: PlaceholderContent[];

      if (existing) {
        newPlaceholders = slide.placeholders.map((p) =>
          p.idx === idx ? { ...p, paragraphs: newParagraphs } : p,
        );
      } else {
        newPlaceholders = [
          ...slide.placeholders,
          { idx, paragraphs: newParagraphs },
        ];
      }

      onChange({ ...slide, placeholders: newPlaceholders });
    },
    [slide, onChange],
  );

  // ── Update layout ──
  const updateLayout = useCallback(
    (newLayout: string) => {
      onChange({ ...slide, layout: newLayout });
    },
    [slide, onChange],
  );

  // ── Update diagram YAML ──
  const updateDiagramYaml = useCallback(
    (yaml: string) => {
      onChange({
        ...slide,
        diagram: slide.diagram
          ? { ...slide.diagram, yaml }
          : { yaml, placeholderIdx: "1" },
      });
    },
    [slide, onChange],
  );

  // Determine which placeholders to show
  const editablePhs = layout
    ? layout.placeholders.filter((ph) => ph.idx !== "50") // skip slide number
    : slide.placeholders;

  return (
    <div className="h-full overflow-auto p-3 flex flex-col gap-3">
      {/* Layout selector */}
      <div>
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">
          Layout
        </label>
        <select
          value={slide.layout}
          onChange={(e) => updateLayout(e.target.value)}
          className="w-full mt-0.5 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white"
        >
          <option value="auto">Auto</option>
          {LAYOUT_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Placeholder fields */}
      {editablePhs.map((ph) => {
        const idx = "idx" in ph ? (ph as PlaceholderContent).idx : (ph as { idx: string }).idx;
        const label = getLabel(idx, layout);
        const currentText = paragraphsToText(
          slide.placeholders.find((p) => p.idx === idx)?.paragraphs || [],
        );

        // Skip if this is the diagram placeholder
        if (slide.diagram && idx === slide.diagram.placeholderIdx) return null;

        return (
          <div key={idx}>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              {label}
              <span className="text-gray-600 ml-1">(idx {idx})</span>
            </label>
            <textarea
              value={currentText}
              onChange={(e) => updatePlaceholder(idx, e.target.value)}
              rows={idx === "1" || idx === "2" ? 6 : 2}
              className="w-full mt-0.5 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white font-mono resize-y"
              placeholder={label}
            />
          </div>
        );
      })}

      {/* Diagram YAML editor */}
      {slide.diagram && (
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">
            Diagram (YAML)
          </label>
          <textarea
            value={slide.diagram.yaml}
            onChange={(e) => updateDiagramYaml(e.target.value)}
            rows={12}
            className="w-full mt-0.5 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-green-300 font-mono resize-y"
            placeholder="type: flowchart\nnodes:\n  - id: a\n    label: Node A"
          />
        </div>
      )}
    </div>
  );
}
