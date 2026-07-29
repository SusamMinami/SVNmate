from pathlib import Path

from PIL import Image, ImageDraw


OUTPUT_PATH = Path(__file__).resolve().parent / "config_linker.ico"
CANVAS_SIZE = 256
ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def build_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (8, 8, 248, 248),
        radius=42,
        fill="#005FB8",
        outline="#003E78",
        width=8,
    )

    nodes = {
        "top": (128, 64),
        "left": (64, 142),
        "right": (192, 142),
        "bottom": (128, 202),
    }
    for start, end in (
        (nodes["top"], nodes["left"]),
        (nodes["top"], nodes["right"]),
        (nodes["left"], nodes["bottom"]),
        (nodes["right"], nodes["bottom"]),
        (nodes["left"], nodes["right"]),
    ):
        draw.line((start, end), fill="#D9F0FF", width=14)

    for name, (x, y) in nodes.items():
        radius = 25 if name == "top" else 22
        fill = "#8ED4FF" if name == "top" else "#FFFFFF"
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=fill,
            outline="#003E78",
            width=7,
        )

    return image


def main() -> None:
    icon = build_icon()
    icon.save(OUTPUT_PATH, format="ICO", sizes=[(size, size) for size in ICON_SIZES])
    print(f"Generated {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
