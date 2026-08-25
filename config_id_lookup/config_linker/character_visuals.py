from __future__ import annotations

from pathlib import Path
from tkinter import Canvas, Label, Toplevel
from typing import Any

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageOps, ImageTk

from .character_catalog import CharacterVisualAsset


class HoverTooltip:
    def __init__(
        self,
        widget: Any,
        colors: dict[str, str],
        *,
        delay_ms: int = 320,
    ) -> None:
        self.widget = widget
        self.colors = colors
        self.delay_ms = delay_ms
        self.text = ""
        self._job: str | None = None
        self._window: Toplevel | None = None
        widget.bind("<Enter>", self._schedule, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def set_text(self, text: str) -> None:
        self.text = text
        if not text:
            self._hide()

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        if self._window is not None and self._window.winfo_exists():
            self._hide()

    def _schedule(self, _event: Any = None) -> None:
        self._cancel_job()
        if self.text:
            self._job = self.widget.after(self.delay_ms, self._show)

    def _show(self) -> None:
        self._job = None
        if not self.text or not self.widget.winfo_exists():
            return
        x = self.widget.winfo_pointerx() + 12
        y = self.widget.winfo_pointery() + 16
        window = Toplevel(self.widget)
        window.wm_overrideredirect(True)
        window.wm_geometry(f"+{x}+{y}")
        label = Label(
            window,
            text=self.text,
            background=self.colors["text"],
            foreground=self.colors["card"],
            relief="solid",
            borderwidth=1,
            padx=8,
            pady=4,
            font=("Segoe UI", 9),
        )
        label.pack()
        self._window = window

    def _cancel_job(self) -> None:
        if self._job is not None:
            self.widget.after_cancel(self._job)
            self._job = None

    def _hide(self, _event: Any = None) -> None:
        self._cancel_job()
        if self._window is not None and self._window.winfo_exists():
            self._window.destroy()
        self._window = None


class CharacterAvatar(Canvas):
    def __init__(
        self,
        parent: Any,
        colors: dict[str, str],
        *,
        size: int = 58,
    ) -> None:
        super().__init__(
            parent,
            width=size,
            height=size,
            background=colors["card"],
            borderwidth=0,
            highlightthickness=0,
        )
        self.colors = colors
        self.size = size
        self.profile_name = ""
        self.asset: CharacterVisualAsset | None = None
        self.image_path: Path | None = None
        self._photo: ImageTk.PhotoImage | None = None
        self.tooltip = HoverTooltip(self, colors)
        self._render()

    def set_visual(
        self,
        profile_name: str,
        asset: CharacterVisualAsset | None,
        image_path: Path | None,
    ) -> None:
        self.profile_name = profile_name
        self.asset = asset
        self.image_path = image_path
        self.tooltip.set_text(
            f"头像 ID：{asset.resource_id}" if asset is not None else ""
        )
        self._render()

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        self.configure(background=colors["card"])
        self.tooltip.set_colors(colors)
        self._render()

    def _render(self) -> None:
        self.delete("all")
        self._photo = None
        inset = 2
        self.create_oval(
            inset,
            inset,
            self.size - inset,
            self.size - inset,
            fill=self.colors["accent_soft"],
            outline=self.colors["border"],
            width=1,
        )
        image = _load_image(self.image_path)
        if image is not None:
            target = self.size - inset * 2
            fitted = ImageOps.fit(
                image.convert("RGBA"),
                (target, target),
                method=Image.Resampling.LANCZOS,
            )
            mask = Image.new("L", (target, target), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, target - 1, target - 1), fill=255)
            fitted.putalpha(ImageChops.multiply(fitted.getchannel("A"), mask))
            self._photo = ImageTk.PhotoImage(fitted)
            self.create_image(
                self.size // 2,
                self.size // 2,
                image=self._photo,
            )
            return
        initial = self.profile_name.strip()[:1] or "?"
        self.create_text(
            self.size // 2,
            self.size // 2,
            text=initial,
            fill=self.colors["accent"],
            font=("Segoe UI Semibold", 18),
        )


class CharacterPortraitBanner(Canvas):
    HEIGHT = 132

    def __init__(
        self,
        parent: Any,
        colors: dict[str, str],
        *,
        name: str,
    ) -> None:
        super().__init__(
            parent,
            height=self.HEIGHT,
            background=colors["bg"],
            borderwidth=0,
            highlightthickness=0,
        )
        self.colors = colors
        self.name = name
        self.meta = ""
        self.asset: CharacterVisualAsset | None = None
        self.image_path: Path | None = None
        self._source_image: Image.Image | None = None
        self._photo: ImageTk.PhotoImage | None = None
        self.tooltip = HoverTooltip(self, colors)
        self.bind("<Configure>", lambda _event: self._render(), add="+")

    def set_meta(self, value: str) -> None:
        self.meta = value
        self._render()

    def set_visual(
        self,
        asset: CharacterVisualAsset | None,
        image_path: Path | None,
    ) -> None:
        self.asset = asset
        self.image_path = image_path
        self._source_image = _load_image(image_path)
        self.tooltip.set_text(
            f"立绘 ID：{asset.resource_id}" if asset is not None else ""
        )
        self._render()

    def set_colors(self, colors: dict[str, str]) -> None:
        self.colors = colors
        self.configure(background=colors["bg"])
        self.tooltip.set_colors(colors)
        self._render()

    def _render(self) -> None:
        width = max(1, self.winfo_width())
        height = max(1, self.winfo_height())
        self.delete("all")
        self._photo = None
        if self._source_image is not None:
            image = ImageOps.fit(
                self._source_image,
                (width, height),
                method=Image.Resampling.LANCZOS,
            ).convert("RGBA")
            tint = Image.new(
                "RGBA",
                image.size,
                (*ImageColor.getrgb(self.colors["bg"]), 118),
            )
            image = Image.alpha_composite(image, tint)
            self._photo = ImageTk.PhotoImage(image)
            self.create_image(0, 0, image=self._photo, anchor="nw")
        else:
            self.create_rectangle(
                0,
                0,
                width,
                height,
                fill=self.colors["accent_soft"],
                outline="",
            )
        self.create_text(
            20,
            26,
            text=self.name,
            fill=self.colors["text"],
            font=("Segoe UI Semibold", 22),
            anchor="nw",
        )
        if self.meta:
            self.create_text(
                21,
                72,
                text=self.meta,
                fill=self.colors["muted"],
                font=("Segoe UI Semibold", 9),
                anchor="nw",
            )


def _load_image(path: Path | None) -> Image.Image | None:
    if path is None or not path.is_file():
        return None
    try:
        with Image.open(path) as image:
            return image.convert("RGBA").copy()
    except (OSError, ValueError):
        return None
