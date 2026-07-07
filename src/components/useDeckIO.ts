/**
 * useDeckIO — file & PPTX I/O for the deck, split out of useDeckController to keep
 * that file within the 400-line rule (R1). Owns: open a Markdown file, save the
 * Markdown source, and generate + save the .pptx. Template loading stays in the
 * controller (it owns templateData, which most of the app reads).
 */

import { useState, useCallback } from "react";
import i18n from "../i18n";
import { pickTextFile, pickBinaryFile, saveBinaryFile, saveTextFile } from "../ipc/commands";
import { renderDeckToPptxBytes } from "./deck-export";
import { renderDeckToHtml } from "./deck-html-export";
import type { Transition } from "../engine/html-shell";
import { serializeMd } from "../engine/md-serializer";
import { bundleProject, openProject, projectTitleFromFileName, PROJECT_EXT } from "../engine/project-io";
import { readProjectFileBytes } from "../ipc/file-open";
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
  /** Open a .scft project as a NEW document (never destroys the current one). */
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

  // Export a self-contained standalone HTML presentation (docs/design/html-output.md).
  // Reuses the SAME SlideCard the preview mounts (SSR), so the .html matches the deck 1:1.
  const handleExportHtml = useCallback(async (transition?: Transition) => {
    if (!deck || !templateData) return;
    const base = (filePath ?? "slides").replace(/\.[^./\\]+$/, "");
    const html = await renderDeckToHtml(deck, templateData, { title: base, transition });
    await saveTextFile(html, `${base}.html`, ["html"], "HTML");
  }, [deck, templateData, filePath]);

  // Save the PROJECT — deck + template in one self-contained .scft (reopen losslessly).
  const handleSaveProject = useCallback(async () => {
    if (!deck || !templateData) return;
    const bytes = await bundleProject(deck, templateData, { templateName, savedAt: new Date().toISOString() });
    const base = (filePath ?? "project").replace(/\.[^./\\]+$/, "");
    await saveBinaryFile(bytes, `${base}.${PROJECT_EXT}`, [PROJECT_EXT], "SlideCraft Project");
  }, [deck, templateData, templateName, filePath]);

  // Unbundle .scft bytes → a NEW background-agnostic document (a tab), preserving the current one.
  // Shared by the picker (handleOpenProject) and the OS file-association launch path
  // (handleOpenProjectFile), so both name the tab and sync the Markdown view identically.
  const openProjectBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    try {
      const { deck: openedDeck, template, meta } = await openProject(bytes);
      openDoc({
        deck: openedDeck,
        templateData: template,
        templateName: meta.templateName ?? "",
        mdText: serializeMd(openedDeck), // keep the Markdown view in sync
        filePath: name,
        title: projectTitleFromFileName(name),
      });
    } catch (e) {
      setParseError(i18n.t("deckIo.projectOpenFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [openDoc, setParseError]);

  // Open a .scft as a NEW document (a tab) via the file picker.
  const handleOpenProject = useCallback(async () => {
    const picked = await pickBinaryFile([PROJECT_EXT], "SlideCraft Project");
    if (picked) await openProjectBytes(picked.bytes, picked.name);
  }, [openProjectBytes]);

  // Open a .scft handed to us by the OS (double-click / "open with") at a concrete path.
  // The launch path was granted to the fs scope by the Rust side, so readFile is allowed.
  const handleOpenProjectFile = useCallback(async (path: string) => {
    try {
      await openProjectBytes(await readProjectFileBytes(path), path);
    } catch (e) {
      setParseError(i18n.t("deckIo.projectOpenFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [openProjectBytes, setParseError]);

  return { generating, handleOpen, handleSave, handleGenerate, handleExportHtml, handleSaveProject, handleOpenProject, handleOpenProjectFile };
}
