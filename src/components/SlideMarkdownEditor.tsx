/**
 * SlideMarkdownEditor.tsx — Edit one slide as raw SlideCraft Markdown.
 *
 * The Edit-mode alternative to the structured form: shows just THIS slide's
 * Markdown (heading, subtitle, bullets, and any ```diagram block) and parses it
 * back into the slide. Lets you work one slide at a time in Markdown without the
 * whole-deck Import editor.
 */

import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { shiftBulletIndent } from "../engine/bullet-indent-shift";

interface SlideMarkdownEditorProps {
  md: string;
  onChange: (md: string) => void;
}

export default function SlideMarkdownEditor({ md, onChange }: SlideMarkdownEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(md);
  const [prevMd, setPrevMd] = useState(md);
  const [focused, setFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reflect external changes (undo/redo, AI apply) when the user isn't typing.
  // Render-phase prop sync — React's "adjust state on prop change" pattern.
  if (md !== prevMd) {
    setPrevMd(md);
    if (!focused) setText(md);
  }

  const handle = (v: string) => {
    setText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => onChange(v), 300);
  };

  // Tab/Shift-Tab on a bullet line shift its nesting level (#201) instead of moving focus — the
  // browser's default Tab behavior on a plain textarea. Non-bullet lines fall through untouched.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    const el = e.currentTarget;
    const result = shiftBulletIndent(text, el.selectionStart, el.selectionEnd, e.shiftKey);
    if (!result) return;
    e.preventDefault();
    handle(result.text);
    requestAnimationFrame(() => {
      el.selectionStart = result.selectionStart;
      el.selectionEnd = result.selectionEnd;
    });
  };

  return (
    <textarea
      value={text}
      onChange={(e) => handle(e.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      spellCheck={false}
      className="h-full w-full px-3 py-2 bg-canvas text-sm text-fg2 font-mono resize-none outline-none leading-relaxed"
      placeholder={t("slideMdEditor.placeholder")}
    />
  );
}
