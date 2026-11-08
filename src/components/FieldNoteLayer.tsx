/**
 * FieldNoteLayer.tsx — #597: the preview twin of the export's FieldNote text box — a slot-less
 * `Source:` row drawn as a small line under the content area. Geometry, text, size and color all come
 * from planFieldRescue (engine/field-rescue.ts), the SAME plan the PPTX export draws (R8).
 */
import type { FieldNote } from "../engine/field-rescue";

export function FieldNoteLayer({ note, scale, slideW, slideH }: { note: FieldNote; scale: number; slideW: number; slideH: number }) {
  const r = note.rect;
  return (
    <div
      data-field-note="true"
      style={{
        position: "absolute",
        left: `${(r.x / slideW) * 100}%`,
        top: `${(r.y / slideH) * 100}%`,
        width: `${(r.w / slideW) * 100}%`,
        height: `${(r.h / slideH) * 100}%`,
        display: "flex",
        alignItems: "center",
        fontSize: note.fontPt * (scale / 72),
        color: `#${note.color}`,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {note.text}
    </div>
  );
}
