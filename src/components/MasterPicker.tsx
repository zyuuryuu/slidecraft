/**
 * MasterPicker.tsx — choose the slide master for THIS draft from the registry, or import a new one.
 * Lives in the Draft header (Slice 1a) so the master is an explicit per-draft choice instead of the
 * old hardcoded sample. Selecting/importing applies the master to the active document (gated).
 */
import type { MasterEntry } from "./useMasterRegistry";

interface MasterPickerProps {
  masters: MasterEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Import a new master (.pptx). Omit to render the SELECT only — import now lives on the top bar. */
  onImport?: () => void;
  disabled?: boolean;
}

export default function MasterPicker({ masters, activeId, onSelect, onImport, disabled }: MasterPickerProps) {
  return (
    <div className="flex items-center gap-1.5" title="このドラフトで使うスライドマスター">
      <span className="text-gray-400">🎨 マスター</span>
      <select
        value={activeId}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value)}
        className="px-2 py-1 rounded bg-[#1a1f3a] border border-[#2D3A6E] text-white text-xs disabled:opacity-40 max-w-[180px]"
      >
        {masters.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}{m.builtin ? "（内蔵）" : ""}
          </option>
        ))}
      </select>
      {onImport && (
        <button
          onClick={onImport}
          disabled={disabled}
          title=".pptx をスライドマスターとして取り込む"
          className="px-2 py-1 text-xs rounded bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white transition-colors disabled:opacity-40"
        >
          ＋ 取込
        </button>
      )}
    </div>
  );
}
