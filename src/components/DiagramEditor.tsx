/**
 * DiagramEditor — the diagram/mermaid block editor, split out of SlideEditor for the R1 400-line cap.
 *
 * Edits a slide's figure in YAML / JSON / Mermaid with a mode switch that converts losslessly between
 * them, disabling the MERMAID option for shapes Mermaid can't represent (icons / kpi / radar / UML
 * class / sequence), and surfaces validation inline.
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as yaml from "js-yaml";
import type { SlideIR } from "../engine/slide-schema";
import { mermaidToDiagramSpec, diagramSpecToMermaid, diagramSpecToYaml, validateDiagramSource, canSerializeToMermaid } from "../engine/mermaid-to-diagram";
import EdgeStyleControls from "./EdgeStyleControls";
import { DiagramSpecSchema } from "../engine/schema";

type DiagramMode = "mermaid" | "yaml" | "json";

/** A diagram that can't round-trip to Mermaid (sequence / UML class) — the MERMAID toggle is
 *  disabled for these (edit in YAML/JSON). Plain function so the React Compiler memoizes the call. */
function isMermaidIncompatible(diagramYaml: string | undefined): boolean {
  if (!diagramYaml) return false;
  try {
    const result = DiagramSpecSchema.safeParse(yaml.load(diagramYaml));
    return result.success ? !canSerializeToMermaid(result.data) : false;
  } catch {
    return false;
  }
}

export default function DiagramEditor({
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
  const { t } = useTranslation();
  const currentMode: DiagramMode = slide.mermaidBlock ? "mermaid" : "yaml";
  const [mode, setMode] = useState<DiagramMode>(currentMode);

  // Mermaid graph syntax can't represent sequence / UML class diagrams, so the
  // YAML→Mermaid serializer would flatten them to a flowchart (lossy + type-
  // breaking). Disable the MERMAID toggle for those — edit them in YAML/JSON.
  const mermaidIncompatible = isMermaidIncompatible(slide.diagram?.yaml);

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
        <label className="text-[10px] text-faint uppercase tracking-wider">
          {label}
        </label>
        {/* Editing-format selector: a dropdown shows only the current choice (less
            clutter); MERMAID is a disabled option WITH its reason when the figure
            can't be represented in Mermaid (icons / kpi / radar / custom class, …). */}
        <select
          value={mode}
          onChange={(e) => switchMode(e.target.value as DiagramMode)}
          title={mermaidIncompatible ? t("diagramEditor.mermaidIncompatibleHint") : t("diagramEditor.selectEditFormat")}
          className="px-2 py-0.5 bg-field border border-edge rounded text-[11px] text-fg hover:border-accent/60"
        >
          <option value="yaml">YAML</option>
          <option value="json">JSON</option>
          <option value="mermaid" disabled={mermaidIncompatible && mode !== "mermaid"}>
            {mermaidIncompatible && mode !== "mermaid" ? t("diagramEditor.mermaidNotConvertible") : "MERMAID"}
          </option>
        </select>
      </div>
      <textarea
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={12}
        className={`w-full px-2 py-1.5 bg-field border rounded text-sm ${colorClass} font-mono resize-y ${
          validationError ? "border-danger" : "border-edge"
        }`}
        placeholder={mode === "mermaid" ? "graph TD\n  A[Start] --> B[End]" : "type: flowchart\nnodes:\n  - id: a\n    label: A"}
      />
      {validationError ? (
        <div className="mt-1 text-[10px] text-danger-soft font-mono break-words">
          {validationError}
        </div>
      ) : textValue.trim() && mode !== "mermaid" ? (
        <div className="mt-1 text-[10px] text-cyan">✓ valid</div>
      ) : null}
      {mode !== "mermaid" && !validationError && slide.diagram?.yaml ? (
        <EdgeStyleControls diagramYaml={slide.diagram.yaml} onChange={onUpdateDiagramYaml} />
      ) : null}
    </div>
  );
}
