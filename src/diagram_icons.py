"""
diagram_icons.py — Icon manager for the Mermaid→PPTX diagram pipeline.

Resolves icon names to image files, handles SVG→PNG conversion (via wand/ImageMagick),
and provides a simple cache to avoid repeated conversions.

Usage:
    from diagram_icons import get_icon_png_path

    png_path = get_icon_png_path("router")          # built-in icon
    png_path = get_icon_png_path("/path/to/custom.svg")  # custom SVG
    png_path = get_icon_png_path("/path/to/custom.png")  # passthrough
"""

from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from diagram_schema import BUILTIN_ICONS

# ── Paths ──
_ICONS_DIR = Path(__file__).parent / "icons"
_CACHE_DIR = Path(tempfile.gettempdir()) / "diagram_icon_cache"

# Default render size for SVG→PNG conversion (pixels)
# At 96 DPI, 128px ≈ 1.33 inches — gives crisp rendering at 0.5–0.8 inch usage
DEFAULT_RENDER_SIZE = 128


def _ensure_cache_dir() -> Path:
    """Create cache directory if it doesn't exist."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR


def _svg_to_png(svg_path: Path, png_path: Path, size: int = DEFAULT_RENDER_SIZE) -> Path:
    """Convert SVG to PNG using wand (ImageMagick binding).

    Args:
        svg_path: Path to source SVG file.
        png_path: Path to write PNG output.
        size: Target width/height in pixels (icons are square).

    Returns:
        Path to the generated PNG file.
    """
    try:
        from wand.image import Image as WandImage
        with WandImage(filename=str(svg_path), resolution=300) as img:
            img.resize(size, size)
            img.format = "png"
            img.save(filename=str(png_path))
        return png_path
    except ImportError:
        raise RuntimeError(
            "wand (ImageMagick) is required for SVG→PNG conversion. "
            "Install with: pip install wand"
        )
    except Exception as e:
        raise RuntimeError(f"SVG→PNG conversion failed for {svg_path}: {e}")


def _cache_key(source_path: Path) -> str:
    """Generate a stable cache key from file path and modification time."""
    stat = source_path.stat()
    raw = f"{source_path}:{stat.st_mtime}:{stat.st_size}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def resolve_icon_path(icon: str) -> Optional[Path]:
    """Resolve an icon identifier to a file path.

    Args:
        icon: Built-in icon name (e.g. "router") or file path (e.g. "/path/to/icon.svg").

    Returns:
        Path to the icon file, or None if not found.
    """
    # Check if it's a built-in icon name
    if icon in BUILTIN_ICONS:
        svg_path = _ICONS_DIR / f"{icon}.svg"
        if svg_path.exists():
            return svg_path
        # Fallback: check for pre-rendered PNG
        png_path = _ICONS_DIR / f"{icon}.png"
        if png_path.exists():
            return png_path
        return None

    # Treat as file path
    p = Path(icon)
    if p.exists() and p.suffix.lower() in (".svg", ".png", ".jpg", ".jpeg", ".gif", ".bmp"):
        return p

    return None


def get_icon_png_path(icon: str, size: int = DEFAULT_RENDER_SIZE) -> Optional[Path]:
    """Get a PNG path for an icon, converting from SVG if needed.

    Args:
        icon: Built-in icon name or file path.
        size: Render size in pixels (for SVG conversion).

    Returns:
        Path to a PNG file ready for embedding, or None if icon not found.
    """
    source = resolve_icon_path(icon)
    if source is None:
        return None

    # If already PNG/raster, return as-is
    if source.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".bmp"):
        return source

    # SVG → PNG conversion with caching
    cache_dir = _ensure_cache_dir()
    key = _cache_key(source)
    cached_png = cache_dir / f"{source.stem}_{key}_{size}.png"

    if cached_png.exists():
        return cached_png

    return _svg_to_png(source, cached_png, size)


def list_builtin_icons() -> list[str]:
    """Return a sorted list of available built-in icon names."""
    available = []
    for name in sorted(BUILTIN_ICONS):
        if (_ICONS_DIR / f"{name}.svg").exists() or (_ICONS_DIR / f"{name}.png").exists():
            available.append(name)
    return available


# ── Self-test ──
if __name__ == "__main__":
    print("Built-in icons directory:", _ICONS_DIR)
    print()

    available = list_builtin_icons()
    print(f"Available icons ({len(available)}/{len(BUILTIN_ICONS)}):")
    for name in available:
        path = resolve_icon_path(name)
        print(f"  {name:16s} → {path}")

    print()

    # Test SVG→PNG conversion for all available icons
    print("SVG→PNG conversion test:")
    for name in available:
        try:
            png = get_icon_png_path(name)
            if png:
                print(f"  {name:16s} → {png} ({png.stat().st_size:,} bytes)")
            else:
                print(f"  {name:16s} → FAILED (None)")
        except Exception as e:
            print(f"  {name:16s} → ERROR: {e}")
