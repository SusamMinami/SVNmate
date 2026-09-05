from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 1024
INK = "#20262D"
PAPER = "#F2F2F0"
SIGNAL = "#FFFA00"
CYAN = "#18D1FF"
STATE = "#00B978"


def build_icon() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (44, 44, 980, 980),
        radius=190,
        fill=INK,
    )
    draw.rounded_rectangle(
        (104, 174, 142, 850),
        radius=19,
        fill=SIGNAL,
    )

    route = (
        (240, 684),
        (414, 684),
        (596, 454),
        (790, 454),
    )
    draw.line(
        route,
        fill=PAPER,
        width=82,
        joint="curve",
    )
    draw.ellipse((181, 625, 299, 743), fill=SIGNAL)
    draw.ellipse((356, 626, 472, 742), fill=CYAN)
    draw.ellipse((718, 382, 862, 526), fill=STATE)

    draw.line(
        ((752, 452), (787, 487), (839, 421)),
        fill=PAPER,
        width=30,
        joint="curve",
    )
    draw.line(
        ((415, 684), (596, 708), (790, 708)),
        fill="#59636D",
        width=42,
        joint="curve",
    )
    draw.ellipse((750, 668, 830, 748), outline=PAPER, width=24)
    return image


def main() -> None:
    target = Path(__file__).resolve().parents[1] / "migration_guard.ico"
    icon = build_icon()
    icon.save(
        target,
        format="ICO",
        sizes=(
            (16, 16),
            (20, 20),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ),
    )


if __name__ == "__main__":
    main()
