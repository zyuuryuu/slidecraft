/**
 * useDeckIO — file & PPTX I/O for the deck, split out of useDeckController to keep
 * that file within the 400-line rule (R1). Owns: open a Markdown file, save the
 * Markdown source, and generate + save the .pptx. Template loading stays in the
 * controller (it owns templateData, which most of the app reads).
 */

import { useState, useCallback } from "react";
import { pickTextFile, saveBinaryFile, saveTextFile } from "../ipc/commands";
import { renderDeckToPptxBytes } from "./deck-export";
import { serializeMd } from "../engine/md-serializer";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import type { HistoryMode } from "./useHistoryState";

interface IODeps {
  mdText: string;
  deck: DeckIR | null;
  templateData: TemplateData | null;
  parseMdText: (text: string, mode?: HistoryMode | "reset") => void;
  setMdText: (s: string) => void;
  setParseError: (e: string | null) => void;
}

export function useDeckIO({ mdText, deck, templateData, parseMdText, setMdText, setParseError }: IODeps) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Open a Markdown file → a brand-new deck (Initialize).
  const handleOpen = useCallback(async () => {
    const picked = await pickTextFile();
    if (!picked) return;
    setMdText(picked.content);
    parseMdText(picked.content, "reset");
    setFilePath(picked.name);
  }, [parseMdText, setMdText]);

  // Save Markdown — serialize from the DECK (the source of truth) so visual Edit-mode
  // changes are always included; fall back to mdText only when there's no deck yet.
  const handleSave = useCallback(() => {
    void saveTextFile(deck ? serializeMd(deck) : mdText, filePath ?? "slidecraft.md");
  }, [deck, mdText, filePath]);

  // Generate + save the .pptx (mermaid pre-render + WYSIWYG rasterise in deck-export.ts).
  const handleGenerate = useCallback(async () => {
    if (!deck || !templateData) return;
    setGenerating(true);
    try {
      const bytes = await renderDeckToPptxBytes(deck, templateData);
      await saveBinaryFile(bytes, "slides_output.pptx", ["pptx"], "PowerPoint");
    } catch (e) {
      setParseError(`PPTX generation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [deck, templateData, setParseError]);

  return { filePath, generating, handleOpen, handleSave, handleGenerate };
}
