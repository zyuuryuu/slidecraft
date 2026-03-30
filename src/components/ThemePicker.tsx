
interface ThemePickerProps {
  currentTheme: string;
  onThemeChange: (themeName: string) => void;
}

const AVAILABLE_THEMES = [
  { name: "midnight_executive", label: "Midnight Executive" },
];

export default function ThemePicker({ currentTheme, onThemeChange }: ThemePickerProps) {
  return (
    <select
      value={currentTheme}
      onChange={(e) => onThemeChange(e.target.value)}
      className="px-2 py-1.5 text-sm bg-[#2D3A6E] text-white border border-[#3B82F6]/30 rounded cursor-pointer hover:bg-[#3B82F6]/40 transition-colors"
    >
      {AVAILABLE_THEMES.map((t) => (
        <option key={t.name} value={t.name}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
