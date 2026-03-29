#!/usr/bin/env python3
"""diagram_cli.py — CLI entry point for the Mermaid→JSON→PPTX diagram pipeline.

Three operating modes:
  Mode 1 (JSON direct):    python diagram_cli.py input.json -o output.pptx
  Mode 2 (Mermaid→API):    python diagram_cli.py input.mmd -o output.pptx --api-convert
  Mode 3 (Show prompt):    python diagram_cli.py --show-prompt [--with-mermaid input.mmd]

See ARCHITECTURE.md §4 for full design specification.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# ── Ensure src/ is importable when run directly ──
_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from diagram_schema import parse_diagram_json, diagnose_json
from diagram_renderer import render_from_json, DEFAULT_THEME
from diagram_theme import ThemeConfig


# ══════════════════════════════════════════════
# Prompt helpers
# ══════════════════════════════════════════════

_PROMPTS_DIR = _SRC_DIR / "prompts"


def _load_system_prompt() -> str:
    """Load the Mermaid→JSON system prompt text."""
    path = _PROMPTS_DIR / "mermaid_system_prompt.txt"
    if not path.exists():
        _die(f"System prompt not found: {path}")
    return path.read_text(encoding="utf-8")


def _load_examples() -> str:
    """Load few-shot examples as formatted text."""
    path = _PROMPTS_DIR / "mermaid_examples.json"
    if not path.exists():
        return ""
    data = json.loads(path.read_text(encoding="utf-8"))
    parts = []
    for i, ex in enumerate(data, 1):
        parts.append(f"--- Example {i}: {ex.get('name', '')} ---")
        if "input" in ex:
            parts.append(f"[Input Mermaid]\n{ex['input']}")
        if "output" in ex:
            parts.append(f"[Output JSON]\n{json.dumps(ex['output'], indent=2, ensure_ascii=False)}")
        parts.append("")
    return "\n".join(parts)


# ══════════════════════════════════════════════
# Mode implementations
# ══════════════════════════════════════════════

def _mode_json_direct(args: argparse.Namespace) -> None:
    """Mode 1: Read JSON, validate, render to PPTX."""
    json_text = Path(args.input).read_text(encoding="utf-8")

    # Validate-only mode
    if args.validate_only:
        # Phase 1: Structural diagnostics (field existence, unknown fields, typo suggestions)
        issues = diagnose_json(json_text)
        errors = [i for i in issues if i.level == "error"]
        warnings = [i for i in issues if i.level == "warning"]

        if warnings:
            print("⚠ Warnings:")
            for w in warnings:
                hint = f"  → suggestion: {w.suggestion}" if w.suggestion else ""
                print(f"  [{w.path}] {w.message}{hint}")

        if errors:
            print("✗ Errors:")
            for e in errors:
                print(f"  [{e.path}] {e.message}")
            _die(f"Diagnostics found {len(errors)} error(s), {len(warnings)} warning(s).")

        # Phase 2: Semantic validation (edge refs, group refs, etc.)
        try:
            spec = parse_diagram_json(json_text)
            print(f"✓ Valid DiagramSpec: {spec.title}")
            print(f"  nodes: {len(spec.nodes)}, edges: {len(spec.edges)}, "
                  f"groups: {len(spec.groups)}, direction: {spec.direction}")
            if warnings:
                print(f"  ({len(warnings)} warning(s) — see above)")
        except Exception as e:
            _die(f"✗ Semantic validation failed: {e}")
        return

    # Render
    theme = _resolve_theme(args)
    output = args.output
    template = args.template if args.template else None
    out_path = render_from_json(json_text, output, template_path=template, theme=theme)
    print(f"✓ Generated: {out_path}")


def _mode_api_convert(args: argparse.Namespace) -> None:
    """Mode 2: Read Mermaid, convert via LLM API, render to PPTX."""
    mermaid_text = Path(args.input).read_text(encoding="utf-8")
    provider = args.api_provider

    # Resolve API key
    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            _die("ANTHROPIC_API_KEY environment variable is required for --api-convert")
    elif provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            _die("OPENAI_API_KEY environment variable is required for --api-convert")
    else:
        _die(f"Unknown API provider: {provider}. Use 'anthropic' or 'openai'.")

    system_prompt = _load_system_prompt()
    examples_text = _load_examples()

    user_message = f"""以下のMermaid記法をDiagramSpec JSONに変換してください。

```mermaid
{mermaid_text.strip()}
```

JSONのみ出力してください（説明不要）。"""

    print(f"→ Calling {provider} API to convert Mermaid → JSON ...")

    json_text = _call_llm_api(provider, api_key, system_prompt, examples_text, user_message)

    # Diagnose the returned JSON
    issues = diagnose_json(json_text)
    diag_errors = [i for i in issues if i.level == "error"]
    diag_warnings = [i for i in issues if i.level == "warning"]

    if diag_warnings:
        print("  ⚠ Warnings in API response:")
        for w in diag_warnings:
            hint = f"  → suggestion: {w.suggestion}" if w.suggestion else ""
            print(f"    [{w.path}] {w.message}{hint}")

    if diag_errors:
        print("  ✗ Errors in API response:")
        for e in diag_errors:
            print(f"    [{e.path}] {e.message}")
        _die(f"  API returned JSON with {len(diag_errors)} structural error(s).\n"
             f"  Raw output:\n{json_text[:500]}")

    # Semantic validation
    try:
        spec = parse_diagram_json(json_text)
        print(f"  ✓ Received valid DiagramSpec: {spec.title} "
              f"({len(spec.nodes)} nodes, {len(spec.edges)} edges)")
    except Exception as e:
        _die(f"  ✗ API returned invalid JSON: {e}\n\nRaw output:\n{json_text[:500]}")

    # Render
    theme = _resolve_theme(args)
    output = args.output
    template = args.template if args.template else None
    out_path = render_from_json(json_text, output, template_path=template, theme=theme)
    print(f"✓ Generated: {out_path}")


def _call_llm_api(provider: str, api_key: str,
                   system_prompt: str, examples: str,
                   user_message: str) -> str:
    """Call LLM API and return the response text.

    Supports anthropic (Claude) and openai (GPT) providers.
    Dynamically imports the SDK to avoid hard dependency.
    """
    full_system = system_prompt
    if examples:
        full_system += "\n\n## Few-shot Examples\n\n" + examples

    if provider == "anthropic":
        try:
            import anthropic
        except ImportError:
            _die("anthropic package not installed. Run: pip install anthropic")

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=full_system,
            messages=[{"role": "user", "content": user_message}],
        )
        text = response.content[0].text

    elif provider == "openai":
        try:
            import openai
        except ImportError:
            _die("openai package not installed. Run: pip install openai")

        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": full_system},
                {"role": "user", "content": user_message},
            ],
        )
        text = response.choices[0].message.content

    # Extract JSON from markdown code block if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json) and last line (```)
        start = 1
        end = len(lines) - 1
        if lines[-1].strip() == "```":
            text = "\n".join(lines[start:end])
        else:
            text = "\n".join(lines[start:])

    return text.strip()


def _mode_show_prompt(args: argparse.Namespace) -> None:
    """Mode 3: Output system prompt (+ optional Mermaid) to stdout."""
    system_prompt = _load_system_prompt()
    examples_text = _load_examples()

    output_parts = [
        "=" * 60,
        "SYSTEM PROMPT",
        "=" * 60,
        system_prompt,
    ]

    if examples_text:
        output_parts += [
            "",
            "=" * 60,
            "FEW-SHOT EXAMPLES",
            "=" * 60,
            examples_text,
        ]

    if args.with_mermaid:
        mermaid_text = Path(args.with_mermaid).read_text(encoding="utf-8")
        output_parts += [
            "",
            "=" * 60,
            "USER MESSAGE (with Mermaid input)",
            "=" * 60,
            "以下のMermaid記法をDiagramSpec JSONに変換してください。",
            "",
            "```mermaid",
            mermaid_text.strip(),
            "```",
            "",
            "JSONのみ出力してください（説明不要）。",
        ]

    print("\n".join(output_parts))


# ══════════════════════════════════════════════
# Utilities
# ══════════════════════════════════════════════

def _die(msg: str) -> None:
    """Print error message to stderr and exit with code 1."""
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def _resolve_theme(args: argparse.Namespace) -> ThemeConfig:
    """Resolve ThemeConfig from --theme argument.

    Accepts either:
      - A file path ending in .yaml/.yml  → ThemeConfig.from_yaml(path)
      - "midnight_executive" (default)    → DEFAULT_THEME
    """
    theme_arg = args.theme
    if theme_arg in (None, "midnight_executive"):
        return DEFAULT_THEME

    # Treat as file path
    theme_path = Path(theme_arg)
    if not theme_path.exists():
        # Also check themes/ directory relative to project root
        alt_path = _SRC_DIR.parent / "themes" / theme_arg
        if not alt_path.exists():
            alt_yaml = _SRC_DIR.parent / "themes" / f"{theme_arg}.yaml"
            if alt_yaml.exists():
                theme_path = alt_yaml
            else:
                _die(f"Theme file not found: {theme_arg}\n"
                     f"  Searched: {theme_path}, {alt_path}, {alt_yaml}")
        else:
            theme_path = alt_path

    try:
        theme = ThemeConfig.from_yaml(theme_path)
        print(f"  Theme: {theme.name} (from {theme_path})")
        return theme
    except Exception as e:
        _die(f"Failed to load theme '{theme_path}': {e}")


# ══════════════════════════════════════════════
# Argument parser
# ══════════════════════════════════════════════

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="diagram_cli",
        description="Diagram Pipeline CLI — JSON/Mermaid → PPTX diagram generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  # Mode 1: JSON → PPTX (default)
  python diagram_cli.py input.json -o output.pptx

  # Mode 1: Validate JSON only
  python diagram_cli.py input.json --validate-only

  # Mode 2: Mermaid → API → PPTX
  python diagram_cli.py input.mmd -o output.pptx --api-convert

  # Mode 3: Show system prompt
  python diagram_cli.py --show-prompt
  python diagram_cli.py --show-prompt --with-mermaid input.mmd
""",
    )

    parser.add_argument(
        "input", nargs="?", default=None,
        help="Input file path (.json or .mmd)",
    )
    parser.add_argument(
        "-o", "--output", default="diagram_output.pptx",
        help="Output PPTX file path (default: diagram_output.pptx)",
    )
    parser.add_argument(
        "-t", "--template", default=None,
        help="Template PPTX file (header bar, etc.)",
    )
    parser.add_argument(
        "--theme", default="midnight_executive",
        help="Theme YAML file path or built-in name (default: midnight_executive)",
    )
    parser.add_argument(
        "--api-convert", action="store_true",
        help="Convert Mermaid input via LLM API",
    )
    parser.add_argument(
        "--api-provider", default="anthropic",
        choices=["anthropic", "openai"],
        help="LLM API provider (default: anthropic)",
    )
    parser.add_argument(
        "--show-prompt", action="store_true",
        help="Show system prompt and exit",
    )
    parser.add_argument(
        "--with-mermaid", default=None, metavar="FILE",
        help="Include Mermaid file content with --show-prompt",
    )
    parser.add_argument(
        "--validate-only", action="store_true",
        help="Validate JSON schema only (no PPTX generation)",
    )

    return parser


# ══════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════

def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    # ── Mode 3: Show prompt ──
    if args.show_prompt:
        _mode_show_prompt(args)
        return

    # ── Require input file for Modes 1 & 2 ──
    if not args.input:
        parser.error("input file is required (unless using --show-prompt)")

    input_path = Path(args.input)
    if not input_path.exists():
        _die(f"Input file not found: {input_path}")

    ext = input_path.suffix.lower()

    # ── Mode 2: Mermaid → API convert ──
    if ext == ".mmd":
        if not args.api_convert:
            _die(
                f"Mermaid file detected ({input_path.name}), but --api-convert not specified.\n"
                "Options:\n"
                "  1. Add --api-convert flag to convert via LLM API\n"
                "  2. Convert to JSON first (use --show-prompt to get the prompt)\n"
                "  3. Provide a .json file directly"
            )
        _mode_api_convert(args)
        return

    # ── Mode 1: JSON direct ──
    if ext == ".json":
        _mode_json_direct(args)
        return

    _die(f"Unsupported file extension: {ext}. Use .json or .mmd")


if __name__ == "__main__":
    main()
