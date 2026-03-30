import { useState, useCallback, useRef } from "react";
import yaml from "js-yaml";
import Editor from "./components/Editor";
import Preview from "./components/Preview";
import Toolbar from "./components/Toolbar";
import ThemePicker from "./components/ThemePicker";
import StatusBar from "./components/StatusBar";
import { DiagramSpecSchema, validateDiagramSpec, type DiagramSpec } from "./engine/schema";
import { renderToBuffer } from "./engine/pptx-writer";
import { midnightExecutive } from "./engine/theme";
import { readFileFromInput, downloadBlob } from "./ipc/commands";

const SAMPLE_YAML = `type: flowchart
direction: TB
title: API認証フロー

classDefs:
  process:
    fill: "#1E2761"
    border: "#3B82F6"
    font_color: "#FFFFFF"
  decision:
    fill: "#F59E0B"
    font_color: "#1E293B"
    font_size: 10
  terminal:
    fill: "#3B82F6"

nodes:
  - id: start
    label: 開始
    shape: rounded_rect
    class: terminal
  - id: proc1
    label: リクエスト受付
    class: process
  - id: auth
    label: 認証OK？
    shape: diamond
    class: decision
  - id: ok
    label: データ処理
    class: process
  - id: ng
    label: エラー返却
    class: process
  - id: end
    label: 終了
    shape: rounded_rect
    class: terminal

edges:
  - from: start
    to: proc1
  - from: proc1
    to: auth
  - from: auth
    to: ok
    label: "Yes"
  - from: auth
    to: ng
    label: "No"
  - from: ok
    to: end
  - from: ng
    to: end
`;

export default function App() {
  const [yamlText, setYamlText] = useState(SAMPLE_YAML);
  const [spec, setSpec] = useState<DiagramSpec | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [themeName, setThemeName] = useState("midnight_executive");
  const [filePath, setFilePath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse YAML → DiagramSpec with debounce
  const parseYaml = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (!text.trim()) {
          setSpec(null);
          setParseError(null);
          return;
        }
        const data = yaml.load(text);
        if (!data || typeof data !== "object") {
          setParseError("YAML must produce an object");
          setSpec(null);
          return;
        }
        const result = DiagramSpecSchema.safeParse(data);
        if (!result.success) {
          setParseError(result.error.issues.map((i: { message: string }) => i.message).join("\n"));
          setSpec(null);
          return;
        }
        const errors = validateDiagramSpec(result.data);
        if (errors.length > 0) {
          setParseError(errors.map((e) => e.message).join("\n"));
          setSpec(null);
          return;
        }
        setSpec(result.data);
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e));
        setSpec(null);
      }
    }, 300);
  }, []);

  const handleEditorChange = useCallback(
    (value: string) => {
      setYamlText(value);
      parseYaml(value);
    },
    [parseYaml],
  );

  // Initial parse
  useState(() => {
    parseYaml(SAMPLE_YAML);
  });

  // Open file
  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await readFileFromInput(file);
      setYamlText(text);
      setFilePath(file.name);
      parseYaml(text);

      e.target.value = "";
    },
    [parseYaml],
  );

  // Save YAML
  const handleSave = useCallback(() => {
    const blob = new Blob([yamlText], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath ?? "diagram.yaml";
    a.click();
    URL.revokeObjectURL(url);
  }, [yamlText, filePath]);

  // Generate PPTX
  const handleGenerate = useCallback(async () => {
    if (!spec) return;
    setGenerating(true);
    try {
      const theme = midnightExecutive();
      const buffer = await renderToBuffer(spec, { theme });
      const filename = spec.title
        ? `${spec.title.replace(/[^\w\s-]/g, "").trim()}.pptx`
        : "diagram_output.pptx";
      downloadBlob(buffer, filename);
    } catch (e) {
      console.error("PPTX generation failed:", e);
      setParseError(`PPTX generation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [spec]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.json"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex items-center">
        <Toolbar
          onOpen={handleOpen}
          onSave={handleSave}
          onGenerate={handleGenerate}
          generating={generating}
          hasSpec={spec !== null}
        />
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1E2761] border-b border-[#3B82F6]/30">
          <ThemePicker currentTheme={themeName} onThemeChange={setThemeName} />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-1/2 border-r border-[#2D3A6E] flex flex-col min-h-0">
          <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
            YAML Editor
          </div>
          <div className="flex-1 min-h-0">
            <Editor value={yamlText} onChange={handleEditorChange} language="yaml" />
          </div>
        </div>

        <div className="w-1/2 flex flex-col min-h-0 bg-[#0f1117]">
          <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
            Mermaid Preview
          </div>
          <div className="flex-1 min-h-0">
            <Preview spec={spec} error={parseError} />
          </div>
        </div>
      </div>

      <StatusBar spec={spec} error={parseError} filePath={filePath} />
    </>
  );
}
