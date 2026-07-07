/**
 * DocTabs — the multi-document tab strip. Appears ONLY when more than one project is
 * open, so the common single-document case keeps zero chrome (simpler-UI north star).
 * Click a tab to switch the active document; × closes it (the last one never closes).
 */
import { useTranslation } from "react-i18next";
import type { DocState } from "./useDocumentStore";

interface Props {
  docs: DocState[];
  activeId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

export default function DocTabs({ docs, activeId, onSwitch, onClose }: Props) {
  const { t } = useTranslation();
  if (docs.length <= 1) return null;
  return (
    <div className="flex items-stretch bg-panel border-b border-edge overflow-x-auto">
      {docs.map((d) => {
        const active = d.id === activeId;
        return (
          <div
            key={d.id}
            onClick={() => onSwitch(d.id)}
            title={d.title}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-edge max-w-[200px] ${
              active ? "bg-canvas text-fg" : "text-muted hover:bg-canvas hover:text-fg2"
            }`}
          >
            <span className="truncate">{d.title || "Untitled"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(d.id);
              }}
              title={t("docTabs.close")}
              className="opacity-0 group-hover:opacity-100 text-faint hover:text-fg px-1 leading-none rounded"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
