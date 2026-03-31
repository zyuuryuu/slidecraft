/**
 * SlideEditor.tsx — Per-slide editing panel.
 *
 * Shows editable fields for each placeholder in the selected slide.
 * For diagram slides, shows the YAML editor inline.
 */

import { useCallback, useState } from "react";
import yaml from "js-yaml";
import type { SlideIR, PlaceholderContent, Paragraph } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { mermaidToDiagramSpec, diagramSpecToMermaid, diagramSpecToYaml } from "../engine/mermaid-to-diagram";
import { DiagramSpecSchema } from "../engine/schema";
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

  // ── Update mermaid syntax ──
  const updateMermaid = useCallback(
    (mermaidText: string) => {
      onChange({
        ...slide,
        mermaidBlock: slide.mermaidBlock
          ? { ...slide.mermaidBlock, mermaid: mermaidText }
          : { mermaid: mermaidText, placeholderIdx: "1" },
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

        // Skip if this is the diagram/mermaid placeholder
        if (slide.diagram && idx === slide.diagram.placeholderIdx) return null;
        if (slide.mermaidBlock && idx === slide.mermaidBlock.placeholderIdx) return null;

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

      {/* Diagram / Mermaid editor with mode switching */}
      {(slide.diagram || slide.mermaidBlock) && (
        <DiagramEditor
          slide={slide}
          onUpdateDiagramYaml={updateDiagramYaml}
          onUpdateMermaid={updateMermaid}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ── Diagram editor with mode switching ──

type DiagramMode = "mermaid" | "yaml" | "json";

function DiagramEditor({
  slide,
  onUpdateDiagramYaml,
  onUpdateMermaid,
  onChange,
}: {
  slide: SlideIR;
  onUpdateDiagramYaml: (yaml: string) => void;
  onUpdateMermaid: (mermaid: string) => void;
  onChange: (updated: SlideIR) => void;
}) {
  const currentMode: DiagramMode = slide.mermaidBlock ? "mermaid" : "yaml";
  const [mode, setMode] = useState<DiagramMode>(currentMode);

  // ── Convert between modes ──
  const switchMode = useCallback(
    (newMode: DiagramMode) => {
      if (newMode === mode) return;

      if (mode === "mermaid" && (newMode === "yaml" || newMode === "json")) {
        // Mermaid → DiagramSpec
        const mmd = slide.mermaidBlock?.mermaid || "";
        const spec = mermaidToDiagramSpec(mmd);
        if (spec) {
          const yamlStr = diagramSpecToYaml(spec);
          onChange({
            ...slide,
            mermaidBlock: undefined,
            diagram: { yaml: newMode === "json" ? JSON.stringify(spec, null, 2) : yamlStr, placeholderIdx: "1" },
          });
        }
      } else if (mode === "yaml" && newMode === "mermaid") {
        // YAML → Mermaid
        try {
          const data = yaml.load(slide.diagram?.yaml || "");
          const result = DiagramSpecSchema.safeParse(data);
          if (result.success) {
            const mmd = diagramSpecToMermaid(result.data);
            onChange({
              ...slide,
              diagram: undefined,
              mermaidBlock: { mermaid: mmd, placeholderIdx: "1" },
            });
          }
        } catch { /* keep current */ }
      } else if (mode === "yaml" && newMode === "json") {
        // YAML → JSON
        try {
          const data = yaml.load(slide.diagram?.yaml || "");
          onUpdateDiagramYaml(JSON.stringify(data, null, 2));
        } catch { /* keep current */ }
      } else if (mode === "json" && newMode === "yaml") {
        // JSON → YAML
        try {
          const data = JSON.parse(slide.diagram?.yaml || "{}");
          onUpdateDiagramYaml(diagramSpecToYaml(data));
        } catch { /* keep current */ }
      } else if (mode === "json" && newMode === "mermaid") {
        // JSON → Mermaid
        try {
          const data = JSON.parse(slide.diagram?.yaml || "{}");
          const result = DiagramSpecSchema.safeParse(data);
          if (result.success) {
            const mmd = diagramSpecToMermaid(result.data);
            onChange({
              ...slide,
              diagram: undefined,
              mermaidBlock: { mermaid: mmd, placeholderIdx: "1" },
            });
          }
        } catch { /* keep current */ }
      }

      setMode(newMode);
    },
    [mode, slide, onChange, onUpdateDiagramYaml],
  );

  const textValue = mode === "mermaid"
    ? (slide.mermaidBlock?.mermaid || "")
    : (slide.diagram?.yaml || "");

  const handleTextChange = useCallback(
    (text: string) => {
      if (mode === "mermaid") {
        onUpdateMermaid(text);
      } else {
        onUpdateDiagramYaml(text);
      }
    },
    [mode, onUpdateMermaid, onUpdateDiagramYaml],
  );

  const colorClass = mode === "mermaid" ? "text-cyan-300" : mode === "json" ? "text-amber-300" : "text-green-300";
  const label = mode === "mermaid"
    ? "Mermaid (→ SVG image in PPTX)"
    : mode === "json"
      ? "JSON (→ PptxGenJS shapes)"
      : "YAML (→ PptxGenJS shapes)";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">
          {label}
        </label>
        <div className="flex rounded overflow-hidden border border-[#2D3A6E] text-[10px]">
          {(["mermaid", "yaml", "json"] as DiagramMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-2 py-0.5 transition-colors ${
                mode === m
                  ? "bg-[#3B82F6] text-white"
                  : "bg-[#1a1f3a] text-gray-400 hover:text-white"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={12}
        className={`w-full px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm ${colorClass} font-mono resize-y`}
        placeholder={mode === "mermaid" ? "graph TD\n  A[Start] --> B[End]" : "type: flowchart\nnodes:\n  - id: a\n    label: A"}
      />
    </div>
  );
}
