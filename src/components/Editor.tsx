import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: "yaml" | "json" | "markdown";
  onCursorLine?: (line: number) => void;
  gotoLine?: { line: number; ts: number }; // ts forces re-trigger even for same line
}

export default function Editor({ value, onChange, language = "yaml", onCursorLine, gotoLine }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onCursorLineRef = useRef(onCursorLine);
  onCursorLineRef.current = onCursorLine;

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = language === "markdown" ? markdown() : language === "json" ? json() : yaml();

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(defaultHighlightStyle),
        langExt,
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos).number;
            onCursorLineRef.current?.(line);
          }
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // Only re-create on language change, not on value/onChange change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Sync external value changes (e.g. file open)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // Scroll to line when gotoLine changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !gotoLine || gotoLine.line < 1) return;
    const lineCount = view.state.doc.lines;
    const target = Math.min(gotoLine.line, lineCount);
    const line = view.state.doc.line(target);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [gotoLine]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden" />
  );
}
