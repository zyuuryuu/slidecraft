/**
 * useDeckIO — file & PPTX I/O for the deck, split out of useDeckController to keep
 * that file within the 400-line rule (R1). Owns: open a Markdown file, save the
 * Markdown source, and generate + save the .pptx. Template loading stays in the
 * controller (it owns templateData, which most of the app reads).
 */

import { useState, useCallback } from "react";
import { pickTextFile, pickBinaryFile, saveBinaryFile, saveTextFile } from "../ipc/commands";
import { renderDeckToPptxBytes } from "./deck-export";
import { serializeMd } from "../engine/md-serializer";
import { bundleProject, openProject } from "../engine/project-io";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";

interface IODeps {
  mdText: string;
  deck: DeckIR | null;
  templateData: TemplateData | null;
  parseMdText: (text: string, mode?: "commit" | "silent" | "reset") => void;
  setMdText: (s: string) => void;
  setParseError: (e: string | null) => void;
  templateName: string;
  /** Current file path is per-document (lives in the document store). */
  filePath: string | null;
  setFilePath: (n: string | null) => void;
  /** Open a .slidecraft project as a NEW document (never destroys the current one). */
  openDoc: (init: { deck: DeckIR | null; templateData?: TemplateData | null; templateName?: string; mdText?: string; filePath?: string | null; title?: string }) => string;
}

export function useDeckIO({ mdText, deck, templateData, parseMdText, setMdText, setParseError, templateName, filePath, setFilePath, openDoc }: IODeps) {
  const [generating, setGenerating] = useState(false);

  // Open a Markdown file → a brand-new deck (Initialize).
  const handleOpen = useCallback(async () => {
    const picked = await pickTextFile();
    if (!picked) return;
    setMdText(picked.content);
    parseMdText(picked.content, "reset");
    setFilePath(picked.name);
  }, [parseMdText, setMdText, setFilePath]);

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

  // Save the PROJECT — deck + template in one self-contained .slidecraft (reopen losslessly).
  const handleSaveProject = useCallback(async () => {
    if (!deck || !templateData) return;
    const bytes = await bundleProject(deck, templateData, { templateName, savedAt: new Date().toISOString() });
    const base = (filePath ?? "project").replace(/\.[^./\\]+$/, "");
    await saveBinaryFile(bytes, `${base}.slidecraft`, ["slidecraft"], "SlideCraft Project");
  }, [deck, templateData, templateName, filePath]);

  // Open a .slidecraft as a NEW document (a tab) so the current project is preserved.
  const handleOpenProject = useCallback(async () => {
    const picked = await pickBinaryFile(["slidecraft"], "SlideCraft Project");
    if (!picked) return;
    try {
      const { deck: openedDeck, template, meta } = await openProject(picked.bytes);
      openDoc({
        deck: openedDeck,
        templateData: template,
        templateName: meta.templateName ?? "",
        mdText: serializeMd(openedDeck), // keep the Markdown view in sync
        filePath: picked.name,
        title: picked.name.replace(/\.slidecraft$/i, ""),
      });
    } catch (e) {
      setParseError(`プロジェクトを開けません: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [openDoc, setParseError]);

  return { generating, handleOpen, handleSave, handleGenerate, handleSaveProject, handleOpenProject };
}
