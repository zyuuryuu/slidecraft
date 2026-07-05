/**
 * ResizableSplit.tsx — Two horizontal panes with a draggable divider.
 *
 * Lets the user widen the editor or the preview (e.g. make the PPTX preview
 * bigger). The split % is clamped and (optionally) persisted to localStorage.
 */

import { useRef, useState, useCallback, useEffect } from "react";

interface ResizableSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  initialLeftPct?: number;
  minPct?: number;
  maxPct?: number;
  /** When set, the chosen split is remembered across sessions. */
  storageKey?: string;
}

export default function ResizableSplit({
  left,
  right,
  initialLeftPct = 50,
  minPct = 20,
  maxPct = 80,
  storageKey,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const [pct, setPct] = useState(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= minPct && saved <= maxPct) return saved;
    }
    return initialLeftPct;
  });

  // Persist the split whenever it settles to a new value.
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(Math.round(pct)));
  }, [pct, storageKey]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const p = ((e.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(maxPct, Math.max(minPct, p)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [minPct, maxPct]);

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0">
      <div style={{ width: `${pct}%` }} className="shrink-0 flex flex-col min-h-0 overflow-hidden">
        {left}
      </div>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => setPct(initialLeftPct)}
        title="Drag to resize (double-click to reset)"
        className="w-1.5 shrink-0 cursor-col-resize bg-edge hover:bg-accent transition-colors"
      />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
