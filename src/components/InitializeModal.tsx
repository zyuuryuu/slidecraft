/**
 * InitializeModal — the "Initialize" phase as a modal (not a persistent mode).
 *
 * The product's single content entry point: bring Markdown in (paste / open file /
 * 原稿を整形), see how it splits into slides (live preview + review), then 確定 to
 * commit the deck and return to the visual Edit home. Markdown lives ONLY here —
 * after 確定 the deck is the source of truth ([[primary-surface-deck]]).
 */

import Editor from "./Editor";
import ReviewBar from "./ReviewBar";
import SlidePreview from "./SlidePreview";
import ResizableSplit from "./ResizableSplit";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import type { DeckIssue } from "../engine/deck-diagnostics";

interface InitializeModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  mdText: string;
  onMdChange: (value: string) => void;
  onOpenFile: () => void;
  onStructure: () => void;
  onGenerateAI: () => void;
  deck: DeckIR | null;
  templateData: TemplateData | null;
  parseError: string | null;
  activeSlide: number;
  onSlideClick: (index: number) => void;
  warnIssues: DeckIssue[];
  tipIssues: DeckIssue[];
  onFixDeterministic: (issue: DeckIssue) => void;
  onCursorLine: (line: number) => void;
  gotoLine?: { line: number; ts: number };
}

const action = "px-2.5 py-1 rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40";

export default function InitializeModal({
  isOpen, onCancel, onConfirm, mdText, onMdChange, onOpenFile, onStructure, onGenerateAI,
  deck, templateData, parseError, activeSlide, onSlideClick, warnIssues, tipIssues,
  onFixDeterministic, onCursorLine, gotoLine,
}: InitializeModalProps) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Initialize — 原稿から作成 / 取り込み"
        className="bg-[#0a0e1a] border border-[#3B82F6]/40 rounded-lg shadow-2xl flex flex-col w-full max-w-6xl"
        style={{ height: "86vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2D3A6E] shrink-0">
          <span className="text-sm text-[#93C5FD] font-medium">Initialize — 原稿から作成 / 取り込み</span>
          <span className="text-[11px] text-gray-500">スライド分割と各スライドの内容を確定して編集へ</span>
          <div className="flex-1" />
          <button onClick={onCancel} title="キャンセル" className="text-gray-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Input methods */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2D3A6E] text-xs shrink-0">
          <span className="text-gray-500">入力:</span>
          <button onClick={onOpenFile} className={action} title=".md / .yaml ファイルを開く">📄 ファイルを開く</button>
          <button onClick={onGenerateAI} className={action} title="AI でデッキを生成">✨ AIで生成</button>
          <button onClick={onStructure} className={action} title="生原稿（見出し＋文章）を見出しごとのスライドに自動整形">✨ 原稿を整形</button>
          <span className="text-gray-500">または下のエディタに直接貼り付け</span>
        </div>

        {/* Non-destructive review of the resulting split */}
        <ReviewBar
          warnIssues={warnIssues}
          tipIssues={tipIssues}
          onJump={onSlideClick}
          onFixDeterministic={onFixDeterministic}
        />

        {/* Markdown source ⇄ live slide-split preview (flex-1 child → fills the middle) */}
        <ResizableSplit
          storageKey="slidecraft_split_init"
          left={
            <>
              <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">Markdown Editor</div>
              <div className="flex-1 min-h-0">
                <Editor value={mdText} onChange={onMdChange} language="markdown" onCursorLine={onCursorLine} gotoLine={gotoLine} />
              </div>
            </>
          }
          right={
            <>
              <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">Slide Preview（分割結果）</div>
              <div className="flex-1 min-h-0 bg-[#0f1117]">
                <SlidePreview deck={deck} template={templateData} error={parseError} activeSlide={activeSlide} onSlideClick={onSlideClick} />
              </div>
            </>
          }
        />

        {/* Commit / discard */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-[#2D3A6E] shrink-0">
          {!deck && (
            <span className="text-[11px] text-amber-300 truncate">
              {parseError ? `Markdown を解析できません: ${parseError}` : "内容が空です — 貼り付けるか取り込んでください"}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1 text-xs bg-[#1a1f3a] hover:bg-[#2D3A6E] text-gray-300 rounded">キャンセル</button>
          <button
            onClick={onConfirm}
            disabled={!deck}
            className="px-4 py-1 text-xs bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-white font-medium rounded"
          >
            ✓ 確定 → 編集
          </button>
        </div>
      </div>
    </div>
  );
}
