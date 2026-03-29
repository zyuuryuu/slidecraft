"""
DiagramSpec v1.0 — Intermediate schema for Mermaid → PPTX pipeline.

Defines the data structures that bridge LLM-generated diagram descriptions
and the PPTX renderer. Validates JSON input before rendering.

See PROJECT_SPEC.md §10.2 for full schema documentation.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional
import json


# ── Style types ──

@dataclass
class NodeStyle:
    """Visual styling for a node. Used both in classDefs and per-node overrides."""
    fill: Optional[str] = None           # hex color e.g. "#1E2761"
    border: Optional[str] = None         # hex color for border
    border_width: float = 1.5            # pt
    border_dash: bool = False
    font_color: str = "#FFFFFF"
    font_size: float = 11                # pt
    font_bold: bool = True

    def merge(self, override: NodeStyle) -> NodeStyle:
        """Return a new NodeStyle with non-None fields from override taking precedence."""
        merged = NodeStyle()
        for fld in self.__dataclass_fields__:
            base_val = getattr(self, fld)
            over_val = getattr(override, fld)
            # Use override if it was explicitly set (not the default)
            if over_val != self.__dataclass_fields__[fld].default:
                setattr(merged, fld, over_val)
            else:
                setattr(merged, fld, base_val)
        return merged


@dataclass
class EdgeStyle:
    """Visual styling for an edge/connector."""
    color: str = "#94A3B8"
    width: float = 2                     # pt
    arrow: bool = True
    dash: bool = False


@dataclass
class GroupStyle:
    """Visual styling for a grouping zone rectangle."""
    border: str = "#94A3B8"
    border_dash: bool = True
    fill: Optional[str] = None           # None = transparent


@dataclass
class LaneStyle:
    """Visual styling for a swimlane band."""
    header_fill: str = "#1E2761"         # dark background for lane header
    header_font_color: str = "#FFFFFF"
    band_fill: Optional[str] = None      # None = alternating light/dark
    border: str = "#CBD5E1"              # lane separator line color
    border_width: float = 1.0            # pt


# ── Core elements ──

VALID_SHAPES = {"rect", "rounded_rect", "diamond", "circle", "oval", "hexagon"}
VALID_DIRECTIONS = {"TB", "LR", "BT", "RL"}
VALID_TYPES = {"flowchart", "network", "orgchart"}

# Built-in icon identifiers — maps to SVG files in icons/ directory.
# Users can also specify a file path for custom icons.
BUILTIN_ICONS = {
    "router", "switch", "server", "database", "cloud",
    "firewall", "client", "internet",
    "load_balancer", "wireless_ap", "storage", "printer",
    "phone", "vpn", "monitor",
}


@dataclass
class Lane:
    """A swimlane band that spans the full cross-axis of the diagram.

    Lanes divide the slide into parallel bands along the cross-axis:
      - TB/BT direction → vertical lanes (side by side, flow is top-to-bottom)
      - LR/RL direction → horizontal lanes (stacked, flow is left-to-right)

    Nodes reference a lane via Node.lane field. A node can belong to
    both a lane and a group simultaneously.
    """
    id: str
    label: str
    style: Optional[LaneStyle] = None

    def effective_style(self) -> LaneStyle:
        return self.style or LaneStyle()


@dataclass
class Node:
    """A single node in the diagram."""
    id: str
    label: str
    sublabel: Optional[str] = None       # secondary text (e.g. person name in orgchart)
    shape: str = "rect"                  # one of VALID_SHAPES
    class_name: Optional[str] = None     # references classDefs key
    style: Optional[NodeStyle] = None    # per-node override
    group: Optional[str] = None          # references Group.id
    lane: Optional[str] = None           # references Lane.id (swimlane membership)
    icon: Optional[str] = None           # built-in icon name (e.g. "router") or file path

    def __post_init__(self):
        if self.shape not in VALID_SHAPES:
            raise ValueError(f"Invalid shape '{self.shape}'. Must be one of {VALID_SHAPES}")


@dataclass
class Edge:
    """A directed connection between two nodes."""
    from_id: str                         # source node id
    to_id: str                           # target node id
    label: Optional[str] = None
    style: Optional[EdgeStyle] = None
    bus_group: Optional[str] = None      # opt-in bus grouping key

    def effective_style(self) -> EdgeStyle:
        return self.style or EdgeStyle()


MAX_NEST_DEPTH = 3  # configurable: 1, 2, or 3 levels of nesting


@dataclass
class Group:
    """A visual grouping zone that contains nodes.

    Supports nesting via `parent` field: a child group references its parent's id.
    Maximum nesting depth is controlled by MAX_NEST_DEPTH.
    """
    id: str
    label: str
    parent: Optional[str] = None     # parent group id for nesting (None = top-level)
    style: Optional[GroupStyle] = None

    def effective_style(self) -> GroupStyle:
        return self.style or GroupStyle()


@dataclass
class LayoutConfig:
    """Controls spacing and sizing for automatic layout."""
    node_width: float = 2.0              # inches
    node_height: float = 0.7             # inches
    h_gap: float = 0.5                   # horizontal gap between nodes (inches)
    v_gap: float = 0.8                   # vertical gap between layers (inches)


# ── Top-level schema ──

@dataclass
class DiagramSpec:
    """Complete diagram specification — the intermediate representation
    between Mermaid text and PPTX output."""
    type: str                            # "flowchart" | "network" | "orgchart"
    direction: str = "TB"                # "TB" | "LR" | "BT" | "RL"
    title: Optional[str] = None
    class_defs: dict[str, NodeStyle] = field(default_factory=dict)
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    groups: list[Group] = field(default_factory=list)
    lanes: list[Lane] = field(default_factory=list)
    layout: LayoutConfig = field(default_factory=LayoutConfig)

    def __post_init__(self):
        if self.type not in VALID_TYPES:
            raise ValueError(f"Invalid type '{self.type}'. Must be one of {VALID_TYPES}")
        if self.direction not in VALID_DIRECTIONS:
            raise ValueError(f"Invalid direction '{self.direction}'. Must be one of {VALID_DIRECTIONS}")

    def validate(self) -> list[str]:
        """Return list of validation errors (empty = valid)."""
        errors = []
        node_ids = {n.id for n in self.nodes}
        group_ids = {g.id for g in self.groups}

        # Check edge references
        for e in self.edges:
            if e.from_id not in node_ids:
                errors.append(f"Edge references unknown node '{e.from_id}'")
            if e.to_id not in node_ids:
                errors.append(f"Edge references unknown node '{e.to_id}'")

        # Check node group references
        for n in self.nodes:
            if n.group and n.group not in group_ids:
                errors.append(f"Node '{n.id}' references unknown group '{n.group}'")

        # Check node lane references
        lane_ids = {ln.id for ln in self.lanes}
        for n in self.nodes:
            if n.lane and n.lane not in lane_ids:
                errors.append(f"Node '{n.id}' references unknown lane '{n.lane}'")

        # Check group parent references
        group_map = {g.id: g for g in self.groups}
        for g in self.groups:
            if g.parent is not None:
                if g.parent not in group_ids:
                    errors.append(f"Group '{g.id}' references unknown parent '{g.parent}'")
                if g.parent == g.id:
                    errors.append(f"Group '{g.id}' references itself as parent")

        # Check for circular group nesting + nesting depth
        has_cycle = False
        for g in self.groups:
            visited: set[str] = set()
            cur = g.id
            while cur is not None:
                if cur in visited:
                    errors.append(f"Circular group nesting detected involving '{g.id}'")
                    has_cycle = True
                    break
                visited.add(cur)
                parent_grp = group_map.get(cur)
                cur = parent_grp.parent if parent_grp else None

        # Check nesting depth only if no cycles (avoids infinite loop)
        if not has_cycle:
            for g in self.groups:
                depth = 0
                cur = g.parent
                while cur is not None:
                    depth += 1
                    parent_grp = group_map.get(cur)
                    cur = parent_grp.parent if parent_grp else None
                if depth >= MAX_NEST_DEPTH:
                    errors.append(
                        f"Group '{g.id}' exceeds max nesting depth {MAX_NEST_DEPTH} "
                        f"(depth={depth + 1})"
                    )

        # Check classDef references
        for n in self.nodes:
            if n.class_name and n.class_name not in self.class_defs:
                errors.append(f"Node '{n.id}' references unknown class '{n.class_name}'")

        # Check for duplicate node IDs
        seen = set()
        for n in self.nodes:
            if n.id in seen:
                errors.append(f"Duplicate node id '{n.id}'")
            seen.add(n.id)

        return errors

    def group_depth(self, group_id: str) -> int:
        """Return nesting depth of a group (0 = top-level)."""
        group_map = {g.id: g for g in self.groups}
        depth = 0
        cur = group_map.get(group_id)
        while cur and cur.parent:
            depth += 1
            cur = group_map.get(cur.parent)
        return depth

    def group_children(self, group_id: str) -> list[str]:
        """Return IDs of direct child groups."""
        return [g.id for g in self.groups if g.parent == group_id]

    def group_ancestors(self, group_id: str) -> list[str]:
        """Return ancestor group IDs from immediate parent to root."""
        group_map = {g.id: g for g in self.groups}
        ancestors = []
        cur = group_map.get(group_id)
        while cur and cur.parent:
            ancestors.append(cur.parent)
            cur = group_map.get(cur.parent)
        return ancestors

    def top_level_groups(self) -> list[Group]:
        """Return groups with no parent."""
        return [g for g in self.groups if g.parent is None]

    def group_all_nodes(self, group_id: str) -> list[str]:
        """Return all node IDs belonging to a group and its descendants (recursive)."""
        direct = [n.id for n in self.nodes if n.group == group_id]
        for child_gid in self.group_children(group_id):
            direct.extend(self.group_all_nodes(child_gid))
        return direct

    def resolve_node_style(self, node: Node) -> NodeStyle:
        """Get the effective style for a node, merging classDef + per-node override."""
        base = NodeStyle()
        if node.class_name and node.class_name in self.class_defs:
            base = self.class_defs[node.class_name]
        if node.style:
            return base.merge(node.style)
        return base


# ── JSON parsing ──

def _parse_node_style(d: dict | None) -> NodeStyle | None:
    if d is None:
        return None
    return NodeStyle(**{k: v for k, v in d.items() if k in NodeStyle.__dataclass_fields__})


def _parse_edge_style(d: dict | None) -> EdgeStyle | None:
    if d is None:
        return None
    return EdgeStyle(**{k: v for k, v in d.items() if k in EdgeStyle.__dataclass_fields__})


def _parse_group_style(d: dict | None) -> GroupStyle | None:
    if d is None:
        return None
    return GroupStyle(**{k: v for k, v in d.items() if k in GroupStyle.__dataclass_fields__})


def _parse_lane_style(d: dict | None) -> LaneStyle | None:
    if d is None:
        return None
    return LaneStyle(**{k: v for k, v in d.items() if k in LaneStyle.__dataclass_fields__})


# ── Known field definitions for diagnostics ──

_KNOWN_FIELDS_TOP = {
    "type", "direction", "title", "classDefs", "nodes", "edges",
    "groups", "lanes", "layout",
}
_REQUIRED_FIELDS_TOP = {"type", "nodes"}

_KNOWN_FIELDS_NODE = {
    "id", "label", "sublabel", "shape", "class", "style", "group", "lane", "icon",
}
_REQUIRED_FIELDS_NODE = {"id", "label"}

_KNOWN_FIELDS_EDGE = {
    "from", "to", "label", "style", "bus_group",
}
_REQUIRED_FIELDS_EDGE = {"from", "to"}

_KNOWN_FIELDS_GROUP = {
    "id", "label", "parent", "style",
}
_REQUIRED_FIELDS_GROUP = {"id", "label"}

_KNOWN_FIELDS_LANE = {
    "id", "label", "style",
}
_REQUIRED_FIELDS_LANE = {"id", "label"}

_KNOWN_FIELDS_LAYOUT = {
    "node_width", "node_height", "h_gap", "v_gap",
}

_KNOWN_FIELDS_NODE_STYLE = {
    "fill", "border", "border_width", "border_dash",
    "font_color", "font_size", "font_bold",
}

_KNOWN_FIELDS_EDGE_STYLE = {
    "color", "width", "arrow", "dash",
}

_KNOWN_FIELDS_GROUP_STYLE = {
    "border", "border_dash", "fill",
}

_KNOWN_FIELDS_LANE_STYLE = {
    "header_fill", "header_font_color", "band_fill", "border", "border_width",
}


@dataclass
class DiagnosticIssue:
    """A single diagnostic finding from JSON validation.

    Attributes:
        level: 'error' for issues that will prevent rendering,
               'warning' for issues that may indicate LLM mistakes.
        path: JSON path where the issue was found (e.g. 'nodes[2].shape').
        message: Human-readable description of the issue.
        suggestion: Optional corrective hint (e.g. a similar field name).
    """
    level: str          # "error" | "warning"
    path: str           # e.g. "nodes[2]", "edges[0].form"
    message: str
    suggestion: Optional[str] = None

    def to_dict(self) -> dict:
        d = {"level": self.level, "path": self.path, "message": self.message}
        if self.suggestion:
            d["suggestion"] = self.suggestion
        return d


def _find_similar(field_name: str, known: set[str], threshold: float = 0.6) -> Optional[str]:
    """Return the most similar known field name if similarity >= threshold."""
    best_match = None
    best_ratio = 0.0
    for known_name in known:
        ratio = SequenceMatcher(None, field_name.lower(), known_name.lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = known_name
    if best_ratio >= threshold and best_match:
        return best_match
    return None


def _check_fields(
    obj: dict,
    known: set[str],
    required: set[str],
    path: str,
    issues: list[DiagnosticIssue],
) -> None:
    """Check a single dict for missing required fields and unknown fields."""
    # Missing required
    for req in required:
        if req not in obj:
            issues.append(DiagnosticIssue(
                level="error",
                path=path,
                message=f"Required field '{req}' is missing.",
            ))
    # Unknown fields
    for key in obj:
        if key not in known:
            similar = _find_similar(key, known)
            msg = f"Unknown field '{key}'."
            if similar:
                msg += f" Did you mean '{similar}'?"
            issues.append(DiagnosticIssue(
                level="warning",
                path=f"{path}.{key}" if path else key,
                message=msg,
                suggestion=similar,
            ))


def _check_style_fields(
    style_obj: dict,
    known: set[str],
    path: str,
    issues: list[DiagnosticIssue],
) -> None:
    """Check a style sub-object for unknown fields."""
    for key in style_obj:
        if key not in known:
            similar = _find_similar(key, known)
            msg = f"Unknown style field '{key}'."
            if similar:
                msg += f" Did you mean '{similar}'?"
            issues.append(DiagnosticIssue(
                level="warning",
                path=f"{path}.{key}",
                message=msg,
                suggestion=similar,
            ))


def diagnose_json(json_str: str) -> list[DiagnosticIssue]:
    """Diagnose a JSON string against the DiagramSpec schema.

    Returns a list of DiagnosticIssue objects. An empty list means
    the JSON structure matches the expected schema (note: this does NOT
    replace parse_diagram_json validation — semantic checks like edge
    reference validity are handled there).

    Designed for two use cases:
      1. CLI --validate-only: display issues to the user
      2. API Mode 2: feed issues back to LLM for self-correction
    """
    issues: list[DiagnosticIssue] = []

    # Step 0: Parse JSON
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        issues.append(DiagnosticIssue(
            level="error",
            path="(root)",
            message=f"Invalid JSON: {e}",
        ))
        return issues

    if not isinstance(data, dict):
        issues.append(DiagnosticIssue(
            level="error",
            path="(root)",
            message=f"Expected a JSON object at root, got {type(data).__name__}.",
        ))
        return issues

    # Step 1: Top-level fields
    _check_fields(data, _KNOWN_FIELDS_TOP, _REQUIRED_FIELDS_TOP, "(root)", issues)

    # Step 2: Validate `type` and `direction` enum values
    if "type" in data and data["type"] not in VALID_TYPES:
        issues.append(DiagnosticIssue(
            level="error",
            path="(root).type",
            message=f"Invalid type '{data['type']}'. Must be one of {sorted(VALID_TYPES)}.",
        ))
    if "direction" in data and data["direction"] not in VALID_DIRECTIONS:
        issues.append(DiagnosticIssue(
            level="error",
            path="(root).direction",
            message=f"Invalid direction '{data['direction']}'. Must be one of {sorted(VALID_DIRECTIONS)}.",
        ))

    # Step 3: Nodes
    nodes = data.get("nodes", [])
    if not isinstance(nodes, list):
        issues.append(DiagnosticIssue(
            level="error", path="nodes",
            message=f"Expected 'nodes' to be an array, got {type(nodes).__name__}.",
        ))
    else:
        for i, nd in enumerate(nodes):
            if not isinstance(nd, dict):
                issues.append(DiagnosticIssue(
                    level="error", path=f"nodes[{i}]",
                    message=f"Expected object, got {type(nd).__name__}.",
                ))
                continue
            _check_fields(nd, _KNOWN_FIELDS_NODE, _REQUIRED_FIELDS_NODE,
                          f"nodes[{i}]", issues)
            # shape enum check
            if "shape" in nd and nd["shape"] not in VALID_SHAPES:
                issues.append(DiagnosticIssue(
                    level="error", path=f"nodes[{i}].shape",
                    message=f"Invalid shape '{nd['shape']}'. Must be one of {sorted(VALID_SHAPES)}.",
                ))
            # node style sub-object
            if "style" in nd and isinstance(nd["style"], dict):
                _check_style_fields(nd["style"], _KNOWN_FIELDS_NODE_STYLE,
                                    f"nodes[{i}].style", issues)

    # Step 4: Edges
    edges = data.get("edges", [])
    if not isinstance(edges, list):
        issues.append(DiagnosticIssue(
            level="error", path="edges",
            message=f"Expected 'edges' to be an array, got {type(edges).__name__}.",
        ))
    else:
        for i, ed in enumerate(edges):
            if not isinstance(ed, dict):
                issues.append(DiagnosticIssue(
                    level="error", path=f"edges[{i}]",
                    message=f"Expected object, got {type(ed).__name__}.",
                ))
                continue
            _check_fields(ed, _KNOWN_FIELDS_EDGE, _REQUIRED_FIELDS_EDGE,
                          f"edges[{i}]", issues)
            # edge style sub-object
            if "style" in ed and isinstance(ed["style"], dict):
                _check_style_fields(ed["style"], _KNOWN_FIELDS_EDGE_STYLE,
                                    f"edges[{i}].style", issues)

    # Step 5: Groups
    groups = data.get("groups", [])
    if isinstance(groups, list):
        for i, gd in enumerate(groups):
            if not isinstance(gd, dict):
                continue
            _check_fields(gd, _KNOWN_FIELDS_GROUP, _REQUIRED_FIELDS_GROUP,
                          f"groups[{i}]", issues)
            if "style" in gd and isinstance(gd["style"], dict):
                _check_style_fields(gd["style"], _KNOWN_FIELDS_GROUP_STYLE,
                                    f"groups[{i}].style", issues)

    # Step 6: Lanes
    lanes_data = data.get("lanes", [])
    if isinstance(lanes_data, list):
        for i, ld in enumerate(lanes_data):
            if not isinstance(ld, dict):
                continue
            _check_fields(ld, _KNOWN_FIELDS_LANE, _REQUIRED_FIELDS_LANE,
                          f"lanes[{i}]", issues)
            if "style" in ld and isinstance(ld["style"], dict):
                _check_style_fields(ld["style"], _KNOWN_FIELDS_LANE_STYLE,
                                    f"lanes[{i}].style", issues)

    # Step 7: Layout
    layout_data = data.get("layout", {})
    if isinstance(layout_data, dict):
        _check_style_fields(layout_data, _KNOWN_FIELDS_LAYOUT,
                            "layout", issues)

    # Step 8: classDefs
    class_defs = data.get("classDefs", {})
    if isinstance(class_defs, dict):
        for cls_name, style_dict in class_defs.items():
            if isinstance(style_dict, dict):
                _check_style_fields(style_dict, _KNOWN_FIELDS_NODE_STYLE,
                                    f"classDefs.{cls_name}", issues)

    return issues


def parse_diagram_json(json_str: str) -> DiagramSpec:
    """Parse a JSON string into a validated DiagramSpec.

    Raises ValueError if validation fails.
    """
    data = json.loads(json_str)

    # classDefs
    class_defs = {}
    for name, style_dict in data.get("classDefs", {}).items():
        class_defs[name] = _parse_node_style(style_dict) or NodeStyle()

    # Nodes
    nodes = []
    for nd in data.get("nodes", []):
        nodes.append(Node(
            id=nd["id"],
            label=nd["label"],
            sublabel=nd.get("sublabel"),
            shape=nd.get("shape", "rect"),
            class_name=nd.get("class"),
            style=_parse_node_style(nd.get("style")),
            group=nd.get("group"),
            lane=nd.get("lane"),
            icon=nd.get("icon"),
        ))

    # Edges
    edges = []
    for ed in data.get("edges", []):
        edges.append(Edge(
            from_id=ed["from"],
            to_id=ed["to"],
            label=ed.get("label"),
            style=_parse_edge_style(ed.get("style")),
            bus_group=ed.get("bus_group"),
        ))

    # Groups
    groups = []
    for gd in data.get("groups", []):
        groups.append(Group(
            id=gd["id"],
            label=gd["label"],
            parent=gd.get("parent"),
            style=_parse_group_style(gd.get("style")),
        ))

    # Lanes
    lanes = []
    for ld in data.get("lanes", []):
        lanes.append(Lane(
            id=ld["id"],
            label=ld["label"],
            style=_parse_lane_style(ld.get("style")),
        ))

    # Layout
    layout_data = data.get("layout", {})
    layout = LayoutConfig(**{k: v for k, v in layout_data.items()
                             if k in LayoutConfig.__dataclass_fields__})

    spec = DiagramSpec(
        type=data["type"],
        direction=data.get("direction", "TB"),
        title=data.get("title"),
        class_defs=class_defs,
        nodes=nodes,
        edges=edges,
        groups=groups,
        lanes=lanes,
        layout=layout,
    )

    errors = spec.validate()
    if errors:
        raise ValueError(f"DiagramSpec validation failed:\n" + "\n".join(f"  - {e}" for e in errors))

    return spec


# ── Self-test ──

if __name__ == "__main__":
    # Quick validation test with a sample flowchart
    sample = json.dumps({
        "type": "flowchart",
        "direction": "TB",
        "title": "認証フロー",
        "classDefs": {
            "process": {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF"},
            "decision": {"fill": "#F59E0B", "font_color": "#1E293B"},
            "terminal": {"fill": "#3B82F6"},
        },
        "nodes": [
            {"id": "start", "label": "開始", "shape": "rounded_rect", "class": "terminal"},
            {"id": "proc1", "label": "リクエスト受付", "shape": "rect", "class": "process"},
            {"id": "auth", "label": "認証OK？", "shape": "diamond", "class": "decision"},
            {"id": "ok", "label": "データ処理", "shape": "rect", "class": "process"},
            {"id": "ng", "label": "エラー返却", "shape": "rect", "class": "process"},
            {"id": "resp", "label": "レスポンス生成", "shape": "rect", "class": "process"},
            {"id": "end", "label": "終了", "shape": "rounded_rect", "class": "terminal"},
        ],
        "edges": [
            {"from": "start", "to": "proc1"},
            {"from": "proc1", "to": "auth"},
            {"from": "auth", "to": "ok", "label": "Yes"},
            {"from": "auth", "to": "ng", "label": "No"},
            {"from": "ok", "to": "resp"},
            {"from": "ng", "to": "end"},
            {"from": "resp", "to": "end"},
        ],
        "groups": [],
        "layout": {"node_width": 2.4, "node_height": 0.7, "v_gap": 0.8},
    })

    spec = parse_diagram_json(sample)
    print(f"✅ DiagramSpec parsed: type={spec.type}, {len(spec.nodes)} nodes, {len(spec.edges)} edges")
    print(f"   Validation: {'PASS' if not spec.validate() else 'FAIL'}")

    # Test node style resolution
    for node in spec.nodes:
        style = spec.resolve_node_style(node)
        print(f"   {node.id:10s} shape={node.shape:14s} fill={style.fill}  font_color={style.font_color}")
