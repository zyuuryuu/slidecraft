/**
 * SlideEditor.tsx — Per-slide editing panel.
 *
 * Shows editable fields for each placeholder in the selected slide.
 * For diagram slides, shows the YAML editor inline.
 */

import { useCallback, useMemo, useState } from "react";
import * as yaml from "js-yaml";
import type { SlideIR, PlaceholderContent, Paragraph } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { mermaidToDiagramSpec, diagramSpecToMermaid, diagramSpecToYaml, validateDiagramSource, canSerializeToMermaid } from "../engine/mermaid-to-diagram";
import EdgeStyleControls from "./EdgeStyleControls";
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

  // Mermaid graph syntax can't represent sequence / UML class diagrams, so the
  // YAML→Mermaid serializer would flatten them to a flowchart (lossy + type-
  // breaking). Disable the MERMAID toggle for those — edit them in YAML/JSON.
  const mermaidIncompatible = useMemo(() => {
    if (!slide.diagram?.yaml) return false;
    try {
      const result = DiagramSpecSchema.safeParse(yaml.load(slide.diagram.yaml));
      return result.success ? !canSerializeToMermaid(result.data) : false;
    } catch {
      return false;
    }
  }, [slide.diagram?.yaml]);

  // ── Convert between modes ──
  const switchMode = useCallback(
    (newMode: DiagramMode) => {
      if (newMode === mode) return;
      // Never convert a sequence/class diagram to Mermaid (would corrupt its type).
      if (newMode === "mermaid" && mermaidIncompatible) return;

      // Only switch the mode if the content was actually converted — otherwise the
      // editor would show e.g. the "YAML" label over still-JSON text (mode/content drift).
      let applied = false;

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
          applied = true;
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
            applied = true;
          }
        } catch { /* keep current */ }
      } else if (mode === "yaml" && newMode === "json") {
        // YAML → JSON (raw object round-trip)
        try {
          const data = yaml.load(slide.diagram?.yaml || "");
          onUpdateDiagramYaml(JSON.stringify(data, null, 2));
          applied = true;
        } catch { /* keep current */ }
      } else if (mode === "json" && newMode === "yaml") {
        // JSON → YAML — symmetric inverse of YAML→JSON (yaml.dump, not the strict
        // diagramSpecToYaml which throws on a minimal/round-tripped spec).
        try {
          const data = JSON.parse(slide.diagram?.yaml || "{}");
          onUpdateDiagramYaml(yaml.dump(data));
          applied = true;
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
            applied = true;
          }
        } catch { /* keep current */ }
      }

      if (applied) setMode(newMode);
    },
    [mode, slide, onChange, onUpdateDiagramYaml, mermaidIncompatible],
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
  const validationError = validateDiagramSource(textValue, mode);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">
          {label}
        </label>
        {/* Editing-format selector: a dropdown shows only the current choice (less
            clutter); MERMAID is a disabled option WITH its reason when the figure
            can't be represented in Mermaid (icons / kpi / radar / custom class, …). */}
        <select
          value={mode}
          onChange={(e) => switchMode(e.target.value as DiagramMode)}
          title={mermaidIncompatible ? "この図はアイコンや kpi/radar 等を含むため Mermaid に変換できません。YAML / JSON で編集してください。" : "編集フォーマットを選択"}
          className="px-2 py-0.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-[11px] text-white hover:border-[#3B82F6]/60"
        >
          <option value="yaml">YAML</option>
          <option value="json">JSON</option>
          <option value="mermaid" disabled={mermaidIncompatible && mode !== "mermaid"}>
            {mermaidIncompatible && mode !== "mermaid" ? "MERMAID（変換不可）" : "MERMAID"}
          </option>
        </select>
      </div>
      <textarea
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={12}
        className={`w-full px-2 py-1.5 bg-[#1a1f3a] border rounded text-sm ${colorClass} font-mono resize-y ${
          validationError ? "border-[#C0504D]" : "border-[#2D3A6E]"
        }`}
        placeholder={mode === "mermaid" ? "graph TD\n  A[Start] --> B[End]" : "type: flowchart\nnodes:\n  - id: a\n    label: A"}
      />
      {validationError ? (
        <div className="mt-1 text-[10px] text-[#F87171] font-mono break-words">
          {validationError}
        </div>
      ) : textValue.trim() && mode !== "mermaid" ? (
        <div className="mt-1 text-[10px] text-[#06B6D4]">✓ valid</div>
      ) : null}
      {mode !== "mermaid" && !validationError && slide.diagram?.yaml ? (
        <EdgeStyleControls diagramYaml={slide.diagram.yaml} onChange={onUpdateDiagramYaml} />
      ) : null}
    </div>
  );
}
