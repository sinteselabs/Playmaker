"""Draws the Playmaker plugin icon: a playbook where one manager fans out to three workers.

Same family as the Blueprint icon: a light rounded tile, transparent outside it, one
object in a thick navy outline, blue bars, one coral accent. Here the object is a
clipboard, the coral dot is the manager and each bar is a worker on its own branch.
Flat shapes, so it still reads at 32 px in a list.

    python tooling/make_icon.py .claude-plugin/icon.png
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SUPER = 4  # draw big, shrink down: cheap antialiasing
S = SIZE * SUPER

TILE = (220, 238, 255)    # the Blueprint tile
NAVY = (23, 60, 99)       # outlines
PAPER = (253, 254, 255)
CLIP = (185, 217, 244)    # the clipboard's clip
BAR = (46, 120, 159)      # a worker at work
BAR_SOFT = (145, 181, 210)  # a worker still waiting
CORAL = (228, 107, 79)    # the manager


def px(v: float) -> int:
    return round(v * SUPER)


def tile(draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle([px(48), px(48), px(976), px(976)], radius=px(220), fill=TILE)


def board(draw: ImageDraw.ImageDraw) -> None:
    """A coach's clipboard: the playbook, upright like the Blueprint document."""
    draw.rounded_rectangle([px(204), px(196), px(820), px(860)], radius=px(28), fill=PAPER, outline=NAVY, width=px(40))
    draw.rounded_rectangle([px(392), px(140), px(632), px(250)], radius=px(26), fill=CLIP, outline=NAVY, width=px(40))


def curve(a, c, b, steps=600):
    """Points of a quadratic Bézier from a to b with control c."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0]
        y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1]
        pts.append((x, y))
    return pts


def stroke(draw: ImageDraw.ImageDraw, pts, width: int, fill) -> None:
    """A round-capped stroke stamped along the points, so curves stay smooth."""
    r = width / 2
    for x, y in pts:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def lanes(draw: ImageDraw.ImageDraw) -> None:
    hub = (px(350), px(560))
    rows = [(px(420), BAR, px(720)), (px(560), BAR, px(680)), (px(700), BAR_SOFT, px(600))]
    w = px(40)
    for y, colour, end in rows:
        start = (px(480), y)
        stroke(draw, curve(hub, (px(430), y), start), w, colour)
        stroke(draw, curve(start, start, (end, y), steps=400), w, colour)
    r = px(64)
    draw.ellipse([hub[0] - r, hub[1] - r, hub[0] + r, hub[1] + r], fill=CORAL, outline=PAPER, width=px(14))


def main() -> int:
    out = Path(sys.argv[1])
    image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tile(draw)
    board(draw)
    lanes(draw)
    image = image.resize((SIZE, SIZE), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, "PNG", optimize=True)
    print(f"{out}  {SIZE}x{SIZE}  {out.stat().st_size / 1024:.0f} kB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
