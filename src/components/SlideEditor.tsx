/**
 * SlideEditor.tsx — Per-slide editing panel.
 *
 * Shows editable fields for each placeholder in the selected slide.
 * For diagram slides, shows the YAML editor inline.
 */

import { useCallback, useState } from "react";
import * as yaml from "js-yaml";
import type { SlideIR, PlaceholderContent, Paragraph } from "../engine/slide-schema";
import type { LayoutInfo } from "../engine/template-loader";
import { mermaidToDiagramSpec, diagramSpecToMermaid, diagramSpecToYaml, validateDiagramSource, canSerializeToMermaid } from "../engine/mermaid-to-diagram";
import EdgeStyleControls from "./EdgeStyleControls";
import { DiagramSpecSchema } from "../engine/schema";
import { LAYOUT_NAMES } from "../engine/slide-schema";
import { buildFieldMap, bodyPlaceholders, nthBody } from "../engine/placeholder-binding";
import { groupEditorPlan } from "../engine/group-binding";

interface SlideEditorProps {
  slide: SlideIR;
  layout: LayoutInfo | undefined;
  /** The LOADED template's actual layout names for the picker. Falls back to the canonical names
   *  when no template is loaded. (Offering canonical names for a non-canonical master made the picker
   *  a no-op: every pick was absent from the catalog and degraded to the same layout.) */
  layoutNames?: string[];
  /** The layout `Auto` actually resolved to (so the UI can show "Auto → X"). */
  resolvedLayout?: string;
  /** Ranked layout candidates (auto pick first) — shown as one-click "also try" chips. */
  suggestions?: string[];
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
      if (p.heading) return `### ${text}`;
      return p.bullet ? `- ${text}` : text;
    })
    .join("\n");
}

// ── Convert plain text back to paragraphs ──

function textToParagraphs(text: string): Paragraph[] {
  return text.split("\n").map((line) => {
    const headingMatch = line.match(/^###\s+(.*)/);
    const bulletMatch = headingMatch ? null : line.match(/^[-*]\s+(.*)/);
    const content = headingMatch ? headingMatch[1] : bulletMatch ? bulletMatch[1] : line;

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
      ...(headingMatch ? { heading: true } : bulletMatch ? { bullet: true } : {}),
    };
  });
}

export default function SlideEditor({ slide, layout, layoutNames, resolvedLayout, suggestions, onChange }: SlideEditorProps) {
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

  // The field map: a VERIFIED 1:1 between the layout's editable placeholders and the content idxs
  // this editor reads/writes. Each field owns exactly one content slot, so editing one can NEVER
  // touch another (no bleed), and what you type role-binds back to that placeholder (buildFieldMap
  // proves both, for every bundled template). Auto slide-number placeholders are excluded. With no
  // template loaded, fall back to the slide's own placeholders (identity map).
  // A GROUPED slide (card/step/kpi) edits ONE field per group (content idx 1..N = the group's
  // "### 見出し\n本文" markdown) instead of buildFieldMap over the layout's many per-group cells. Meta
  // (title/date/…) still uses buildFieldMap on the NON-group placeholders. Non-grouped slides keep the
  // full buildFieldMap 1:1 path unchanged.
  const groupPlan = layout ? groupEditorPlan(slide, layout) : null;
  const groupN = groupPlan
    ? Math.max(groupPlan.columns, slide.placeholders.filter((c) => /^[1-9]$/.test(c.idx)).length)
    : 0;
  const fields = groupPlan
    ? [
        ...buildFieldMap(slide, groupPlan.metaPhs),
        ...Array.from({ length: groupN }, (_, k) => ({ phIdx: String(k + 1), contentIdx: String(k + 1) })),
      ]
    : layout
      ? buildFieldMap(slide, layout.placeholders)
      : slide.placeholders.map((p) => ({ phIdx: p.idx, contentIdx: p.idx }));

  // Which RAW placeholder idxs are occupied by a diagram/mermaid/table? Each rides the Nth BODY
  // placeholder, and its placeholderIdx is a 1-based body ORDINAL — NOT a raw idx. Resolve it via
  // nthBody (exactly as the preview + export do), else on a gapped-body layout (bodies at [1,3]) the
  // editor would show a text field OVER the diagram's box and silently drop what you type on export.
  const bodyPhs = layout ? bodyPlaceholders(layout.placeholders) : [];
  const visualIdx = new Set(
    [
      slide.diagram && nthBody(bodyPhs, slide.diagram.placeholderIdx)?.idx,
      slide.mermaidBlock && nthBody(bodyPhs, slide.mermaidBlock.placeholderIdx)?.idx,
      slide.table && nthBody(bodyPhs, slide.table.placeholderIdx)?.idx,
      slide.code && nthBody(bodyPhs, slide.code.placeholderIdx)?.idx,
    ].filter((x): x is string => !!x),
  );

  return (
    <div className="h-full overflow-auto p-3 flex flex-col gap-3">
      {/* Layout selector — the full list stays freely selectable (as before); the only change is that
          the "Auto" option shows what it RESOLVED to, and ranked candidates are one-click chips. */}
      <div>
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Layout</label>
        <select
          value={slide.layout}
          onChange={(e) => updateLayout(e.target.value)}
          className="w-full mt-0.5 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white"
        >
          <option value="auto">{resolvedLayout ? `自動 → ${resolvedLayout}` : "自動"}</option>
          {(layoutNames && layoutNames.length > 0 ? layoutNames : LAYOUT_NAMES).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {/* Ranked candidates (★ = Auto's top pick = best score; the rest are the next-best) + an Auto
            toggle. Picking a candidate PINS it; ⟳Auto re-adapts (keeps slide.layout === "auto"). */}
        {suggestions && suggestions.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-gray-500">候補:</span>
            {suggestions.map((name, i) => {
              const active = slide.layout === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => updateLayout(name)}
                  title={i === 0 ? "Auto の第一候補（最良評価）" : "次点の候補レイアウト"}
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    active ? "bg-[#3B82F6] border-[#3B82F6] text-white" : "bg-[#1a1f3a] border-[#2D3A6E] text-gray-300 hover:border-[#3B82F6]/60"
                  }`}
                >
                  {i === 0 && "★ "}{name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => updateLayout("auto")}
              title="自動選択に戻す（常に最良評価を選ぶ）"
              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                slide.layout === "auto" ? "bg-[#3B82F6] border-[#3B82F6] text-white" : "bg-[#1a1f3a] border-[#2D3A6E] text-gray-300 hover:border-[#3B82F6]/60"
              }`}
            >
              ⟳ Auto
            </button>
          </div>
        )}
      </div>

      {/* Placeholder fields — one per field-map slot, reading/writing its own content idx (1:1). For a
          grouped slide, idx 1..N are GROUP fields (### 見出し + 本文); meta fields stay buildFieldMap. */}
      {fields.map(({ phIdx, contentIdx }) => {
        const isGroup = !!groupPlan && /^[1-9]$/.test(phIdx);
        const over = isGroup && Number(phIdx) > groupPlan!.columns;
        const label = isGroup ? `グループ ${phIdx}${over ? " ⚠超過（出力されません）" : ""}` : getLabel(phIdx, layout);
        const currentText = paragraphsToText(
          slide.placeholders.find((p) => p.idx === contentIdx)?.paragraphs || [],
        );

        // Skip the placeholder a diagram/mermaid/table occupies (edited in the block editor below).
        if (visualIdx.has(phIdx)) return null;

        return (
          <div key={phIdx}>
            <label className={`text-[10px] uppercase tracking-wider ${over ? "text-[#F87171]" : "text-gray-500"}`}>
              {label}
              {!isGroup && <span className="text-gray-600 ml-1">(idx {phIdx})</span>}
            </label>
            <textarea
              value={currentText}
              onChange={(e) => updatePlaceholder(contentIdx, e.target.value)}
              rows={isGroup ? 4 : phIdx === "1" || phIdx === "2" ? 6 : 2}
              className="w-full mt-0.5 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white font-mono resize-y"
              placeholder={isGroup ? "### 見出し\n本文…" : label}
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
