/**
 * StatusBar.tsx — the thin bar under the workspace. #615: it shows ONLY what no other surface shows —
 * the full path of the opened file (the doc tab shows just its name). It used to also carry a
 * diagram-era readout (Ready / Nodes / Edges …) that App never fed (`spec={null}` → always
 * "No input", even with a full deck) and an "Error" word that duplicated the preview's own error
 * panel; both are gone. With no file path there is nothing to say, so the bar isn't drawn.
 */
interface StatusBarProps {
  filePath: string | null;
}

export default function StatusBar({ filePath }: StatusBarProps) {
  if (!filePath) return null;
  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-panel text-xs text-muted border-t border-edge">
      <span className="text-faint truncate" title={filePath}>{filePath}</span>
    </div>
  );
}
