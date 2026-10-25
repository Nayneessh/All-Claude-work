"""Vectorise the supplied 168x162 logo into a crisp SVG and render brand assets.

Usage: python3 scripts/brand/trace_logo.py
Requires: pillow, numpy, potracer, cairosvg (pip install pillow numpy potracer cairosvg)
Outputs (resources/): logo.svg, icon-only.png, icon-foreground.png, icon-background.png,
                      splash.png, splash-dark.png, and public/icon-192.png, public/logo.svg
"""
import io
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
import potrace
import cairosvg

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "resources" / "logo-source.png"
GOLD = "#D4AF37"
NIGHT_GREEN = "#071F16"
SCALE = 8
THRESH = 82  # luminance between bg (~20) and gold (~150+)


def trace(mask: np.ndarray) -> str:
    bm = potrace.Bitmap(~mask)  # potracer treats False as "filled"
    plist = bm.trace(turdsize=40, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                     alphamax=1.0, opticurve=True, opttolerance=0.4)
    parts = []
    for curve in plist:
        fs = curve.start_point
        d = [f"M{fs.x:.2f},{fs.y:.2f}"]
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f"L{seg.c.x:.2f},{seg.c.y:.2f}L{seg.end_point.x:.2f},{seg.end_point.y:.2f}")
            else:
                d.append(f"C{seg.c1.x:.2f},{seg.c1.y:.2f} {seg.c2.x:.2f},{seg.c2.y:.2f} {seg.end_point.x:.2f},{seg.end_point.y:.2f}")
        d.append("z")
        parts.append("".join(d))
    return "".join(parts)


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    big = im.resize((w * SCALE, h * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.2))
    lum = np.asarray(big.convert("L"), dtype=np.float32)
    mask = lum > THRESH
    # crop to content bbox with a small margin so the logo is centred
    ys, xs = np.where(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 6
    x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
    x1, y1 = min(x1 + pad, mask.shape[1] - 1), min(y1 + pad, mask.shape[0] - 1)
    mask = mask[y0:y1 + 1, x0:x1 + 1]
    ch, cw = mask.shape
    side = max(ch, cw)
    canvas = np.zeros((side, side), dtype=bool)
    oy, ox = (side - ch) // 2, (side - cw) // 2
    canvas[oy:oy + ch, ox:ox + cw] = mask
    path = trace(canvas)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" width="{side}" height="{side}">'
           f'<path fill="{GOLD}" fill-rule="evenodd" d="{path}"/></svg>')
    (ROOT / "resources" / "logo.svg").write_text(svg)
    (ROOT / "public" / "logo.svg").write_text(svg)

    def render(size: int, logo_frac: float, bg: str | None) -> Image.Image:
        inner = int(size * logo_frac)
        png = cairosvg.svg2png(bytestring=svg.encode(), output_width=inner, output_height=inner)
        logo = Image.open(io.BytesIO(png)).convert("RGBA")
        base = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
        base.alpha_composite(logo, ((size - inner) // 2, (size - inner) // 2))
        return base

    r = ROOT / "resources"
    render(1024, 0.74, NIGHT_GREEN).convert("RGB").save(r / "icon-only.png")
    render(1024, 0.56, None).save(r / "icon-foreground.png")          # adaptive-icon safe zone (66%)
    Image.new("RGB", (1024, 1024), NIGHT_GREEN).save(r / "icon-background.png")
    render(2732, 0.34, NIGHT_GREEN).convert("RGB").save(r / "splash.png")
    render(2732, 0.34, NIGHT_GREEN).convert("RGB").save(r / "splash-dark.png")
    render(192, 0.80, NIGHT_GREEN).convert("RGB").save(ROOT / "public" / "icon-192.png")
    render(512, 0.80, NIGHT_GREEN).convert("RGB").save(ROOT / "public" / "icon-512.png")
    print("ok", side, len(path), "bytes of path data")


if __name__ == "__main__":
    main()
