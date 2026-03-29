"""
DiagramTheme — Centralized theme configuration for diagram rendering.

Defines palette, fonts, and default styles so that rendered diagrams
visually match the target PPTX template.

Default: Midnight Executive theme.
To support a different template, create a new ThemeConfig instance.

See DIAGRAM_PIPELINE_SPEC.md §1 for architecture context.
"""

from __future__ import annotations
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class FontConfig:
    """Font family configuration."""
    heading: str = "Georgia"       # titles, sublabels, node main text
    body: str = "Calibri"          # labels, descriptions, edge labels
    mono: str = "Consolas"         # code/technical content (future use)


@dataclass
class Palette:
    """Color palette (hex strings without '#' prefix for consistency
    with python-pptx RGBColor usage)."""
    navy: str        = "1E2761"
    dark_navy: str   = "141B41"
    ice_blue: str    = "CADCFC"
    white: str       = "FFFFFF"
    light_gray: str  = "F5F7FA"
    panel_gray: str  = "EDF0F7"
    mid_gray: str    = "94A3B8"
    dark_text: str   = "1E293B"
    accent: str      = "3B82F6"
    accent_dark: str = "2563EB"
    teal: str        = "06B6D4"
    amber: str       = "F59E0B"
    soft_navy: str   = "2D3A6E"
    card_bg: str     = "F0F4FF"

    def hex(self, name: str) -> str:
        """Get color as '#RRGGBB' string."""
        return f"#{getattr(self, name)}"


@dataclass
class NodeDefaults:
    """Default node appearance per diagram type."""
    # classDef templates for LLM prompt generation
    # Keys: role → (fill, border, font_color, font_bold, font_size)
    flowchart: dict = field(default_factory=lambda: {
        "terminal":  {"fill": "#3B82F6", "font_color": "#FFFFFF", "font_bold": True, "font_size": 11},
        "process":   {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF", "font_size": 11},
        "decision":  {"fill": "#F59E0B", "font_color": "#1E293B", "font_size": 10},
        "error":     {"fill": "#2D3A6E", "font_color": "#FFFFFF", "font_size": 11},
        "io":        {"fill": "#06B6D4", "font_color": "#FFFFFF", "font_size": 11},
    })
    network: dict = field(default_factory=lambda: {
        "external":  {"fill": "#94A3B8", "border": "#1E293B", "font_color": "#FFFFFF"},
        "firewall":  {"fill": "#F59E0B", "font_color": "#1E293B", "font_size": 9},
        "core":      {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF"},
        "switch":    {"fill": "#2D3A6E", "border": "#3B82F6", "font_color": "#FFFFFF", "font_size": 10},
        "server":    {"fill": "#3B82F6", "font_color": "#FFFFFF", "font_size": 9},
        "database":  {"fill": "#1E2761", "font_color": "#FFFFFF", "font_size": 9},
        "app":       {"fill": "#06B6D4", "font_color": "#FFFFFF", "font_size": 9},
    })
    orgchart: dict = field(default_factory=lambda: {
        "ceo":       {"fill": "#141B41", "border": "#3B82F6", "font_color": "#FFFFFF", "font_size": 12},
        "vp":        {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF", "font_size": 11},
        "team":      {"fill": "#2D3A6E", "border": "#3B82F6", "font_color": "#FFFFFF", "font_size": 10},
    })


@dataclass
class DiagramStyle:
    """Rendering-level defaults for diagram elements."""
    # Title textbox
    title_font_size: float = 20          # pt
    title_font_bold: bool = True
    title_font_color: str = "#1E2761"    # navy on light background

    # Edge / connector defaults
    edge_color: str = "#94A3B8"          # mid_gray
    edge_width: float = 2.0             # pt
    edge_label_font_size: float = 9     # pt

    # Group zone defaults
    group_label_font_size: float = 8    # pt
    group_border_width: float = 1.5     # pt

    # Slide background for standalone (non-template) renders
    slide_bg: Optional[str] = "#F5F7FA"  # light_gray

    # Header bar (when using template layout)
    header_bar_color: str = "#1E2761"    # navy
    header_font_color: str = "#FFFFFF"
    header_subtitle_color: str = "#CADCFC"  # ice_blue


# ── Merge utilities (used by ThemeConfig.from_yaml) ──

def _dataclass_to_dict(obj) -> dict:
    """Convert a dataclass instance to a plain dict (shallow, no nested recursion)."""
    return {f.name: getattr(obj, f.name) for f in fields(obj)}


def _merge_dataclass(base, overrides: dict):
    """Return a copy of `base` dataclass with fields from `overrides` applied.

    Only fields that exist on the dataclass are merged; unknown keys are ignored.
    """
    known = {f.name for f in fields(base)}
    for key, val in overrides.items():
        if key in known:
            setattr(base, key, val)
    return base


def _merge_node_defaults(base: NodeDefaults, overrides: dict) -> NodeDefaults:
    """Merge node_defaults overrides.

    Structure: { "flowchart": { "terminal": {...}, ... }, ... }
    Each diagram_type.role dict is **replaced** if present (not deep-merged),
    but roles not mentioned in overrides are preserved.
    """
    for dtype in ("flowchart", "network", "orgchart"):
        if dtype in overrides and isinstance(overrides[dtype], dict):
            base_roles: dict = getattr(base, dtype)
            for role, style_dict in overrides[dtype].items():
                if isinstance(style_dict, dict):
                    base_roles[role] = style_dict
            setattr(base, dtype, base_roles)
    return base


@dataclass
class ThemeConfig:
    """Complete theme configuration.

    Usage:
        theme = ThemeConfig.midnight_executive()
        # Pass to render_diagram(), build_conversion_prompt(), etc.
    """
    name: str = "Midnight Executive"
    palette: Palette = field(default_factory=Palette)
    fonts: FontConfig = field(default_factory=FontConfig)
    node_defaults: NodeDefaults = field(default_factory=NodeDefaults)
    diagram_style: DiagramStyle = field(default_factory=DiagramStyle)

    @classmethod
    def midnight_executive(cls) -> ThemeConfig:
        """Factory for the default Midnight Executive theme."""
        return cls()

    @classmethod
    def from_yaml(cls, path: str | Path) -> ThemeConfig:
        """Load a theme from a YAML file, merging over the default theme.

        Only fields present in the YAML are overridden; everything else
        inherits from the Midnight Executive defaults.

        Raises FileNotFoundError if path doesn't exist.
        Raises ValueError for invalid YAML structure.
        """
        path = Path(path)
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if data is None:
            return cls.midnight_executive()
        if not isinstance(data, dict):
            raise ValueError(f"Theme YAML root must be a mapping, got {type(data).__name__}")

        base = cls.midnight_executive()

        # Top-level simple fields
        if "name" in data:
            base.name = data["name"]

        # Merge sub-dataclasses
        if "palette" in data and isinstance(data["palette"], dict):
            base.palette = _merge_dataclass(base.palette, data["palette"])
        if "fonts" in data and isinstance(data["fonts"], dict):
            base.fonts = _merge_dataclass(base.fonts, data["fonts"])
        if "diagram_style" in data and isinstance(data["diagram_style"], dict):
            base.diagram_style = _merge_dataclass(base.diagram_style, data["diagram_style"])
        if "node_defaults" in data and isinstance(data["node_defaults"], dict):
            base.node_defaults = _merge_node_defaults(base.node_defaults, data["node_defaults"])

        return base

    def to_yaml(self, path: str | Path) -> None:
        """Write the full theme configuration to a YAML file.

        Useful for generating a reference/template that users can edit.
        """
        data: dict = {
            "name": self.name,
            "palette": _dataclass_to_dict(self.palette),
            "fonts": _dataclass_to_dict(self.fonts),
            "diagram_style": _dataclass_to_dict(self.diagram_style),
            "node_defaults": {
                "flowchart": self.node_defaults.flowchart,
                "network": self.node_defaults.network,
                "orgchart": self.node_defaults.orgchart,
            },
        }
        path = Path(path)
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    def get_classdefs_for_type(self, diagram_type: str) -> dict:
        """Get the recommended classDefs for a diagram type.

        Used by the Mermaid→JSON prompt to suggest appropriate colors.
        """
        mapping = {
            "flowchart": self.node_defaults.flowchart,
            "network":   self.node_defaults.network,
            "orgchart":  self.node_defaults.orgchart,
        }
        return mapping.get(diagram_type, self.node_defaults.flowchart)

    def palette_summary_for_prompt(self) -> str:
        """Generate a text summary of the palette for LLM prompts.

        Returns a formatted string listing key colors.
        """
        p = self.palette
        return f"""- navy: #{p.navy}（メイン背景）
- dark_navy: #{p.dark_navy}（最上位ノード）
- accent: #{p.accent}（青アクセント）
- teal: #{p.teal}（ティール）
- amber: #{p.amber}（判断/警告）
- soft_navy: #{p.soft_navy}（サブノード）
- mid_gray: #{p.mid_gray}（コネクタ/外部）
- white: #{p.white}（ダーク背景上の文字）
- dark_text: #{p.dark_text}（ライト背景上の文字）
- ice_blue: #{p.ice_blue}（サブテキスト）"""


# ── Module-level default instance ──

DEFAULT_THEME = ThemeConfig.midnight_executive()


# ── Self-test ──

if __name__ == "__main__":
    theme = DEFAULT_THEME
    print(f"✅ Theme: {theme.name}")
    print(f"   Fonts: heading={theme.fonts.heading}, body={theme.fonts.body}")
    print(f"   Palette colors: {len(theme.palette.__dataclass_fields__)}")
    print(f"\n   Flowchart classDefs: {list(theme.node_defaults.flowchart.keys())}")
    print(f"   Network classDefs:   {list(theme.node_defaults.network.keys())}")
    print(f"   Orgchart classDefs:  {list(theme.node_defaults.orgchart.keys())}")
    print(f"\n   Palette summary for prompt:\n{theme.palette_summary_for_prompt()}")
