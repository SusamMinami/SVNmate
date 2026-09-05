from __future__ import annotations

from tkinter import ttk


UI_FONT = "Segoe UI"
UI_FONT_SEMIBOLD = "Segoe UI Semibold"
ICON_FONT = "Segoe MDL2 Assets"

DAY_COLORS = {
    "bg": "#F3F3F3",
    "card": "#FFFFFF",
    "text": "#1A1A1A",
    "muted": "#666666",
    "accent": "#0067C0",
    "accent_fill": "#0067C0",
    "accent_hover": "#1976D2",
    "accent_pressed": "#005A9E",
    "border": "#D1D1D1",
    "button": "#F7F7F7",
    "button_active": "#E9E9E9",
    "button_pressed": "#DDDDDD",
    "entry": "#FFFFFF",
    "entry_focus": "#FFFFFF",
    "tree": "#FFFFFF",
    "tree_text": "#1A1A1A",
    "heading": "#F5F5F5",
    "heading_text": "#333333",
    "selected": "#0078D4",
    "selected_text": "#FFFFFF",
    "completed": "#DFF6DD",
    "completed_text": "#153B1B",
    "warning": "#8A4F00",
    "warning_surface": "#FFF4CE",
    "error": "#B42318",
    "error_surface": "#FDE7E9",
    "scrollbar": "#B8B8B8",
    "scroll_trough": "#F3F3F3",
    "disabled": "#9A9A9A",
}

NIGHT_COLORS = {
    "bg": "#202020",
    "card": "#2B2B2B",
    "text": "#FFFFFF",
    "muted": "#C8C8C8",
    "accent": "#60CDFF",
    "accent_fill": "#0078D4",
    "accent_hover": "#1686D9",
    "accent_pressed": "#0067B8",
    "border": "#454545",
    "button": "#383838",
    "button_active": "#454545",
    "button_pressed": "#303030",
    "entry": "#353535",
    "entry_focus": "#3D3D3D",
    "tree": "#252525",
    "tree_text": "#F7F7F7",
    "heading": "#333333",
    "heading_text": "#FFFFFF",
    "selected": "#005A9E",
    "selected_text": "#FFFFFF",
    "completed": "#244B32",
    "completed_text": "#F3FFF6",
    "warning": "#F5C26B",
    "warning_surface": "#4A351A",
    "error": "#FF9A8A",
    "error_surface": "#4B2724",
    "scrollbar": "#666666",
    "scroll_trough": "#2B2B2B",
    "disabled": "#777777",
}


def theme_colors(theme: str) -> dict[str, str]:
    return dict(NIGHT_COLORS if theme == "night" else DAY_COLORS)


def configure_svnmate_styles(
    root: object,
    style: ttk.Style,
    theme: str,
) -> dict[str, str]:
    colors = theme_colors(theme)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    root.configure(bg=colors["bg"])
    style.configure(
        ".",
        font=(UI_FONT, 10),
        background=colors["card"],
        foreground=colors["text"],
    )
    style.configure("TFrame", background=colors["card"])
    style.configure("App.TFrame", background=colors["bg"])
    style.configure("Card.TFrame", background=colors["card"])
    style.configure(
        "TLabel",
        background=colors["card"],
        foreground=colors["text"],
    )
    style.configure(
        "Card.TLabel",
        background=colors["card"],
        foreground=colors["text"],
    )
    style.configure(
        "Title.TLabel",
        background=colors["bg"],
        foreground=colors["text"],
        font=(UI_FONT_SEMIBOLD, 22),
    )
    style.configure(
        "Subtitle.TLabel",
        background=colors["bg"],
        foreground=colors["muted"],
        font=(UI_FONT, 9),
    )
    style.configure(
        "SectionTitle.TLabel",
        background=colors["card"],
        foreground=colors["text"],
        font=(UI_FONT_SEMIBOLD, 11),
    )
    style.configure(
        "SectionTitleApp.TLabel",
        background=colors["bg"],
        foreground=colors["text"],
        font=(UI_FONT_SEMIBOLD, 11),
    )
    style.configure(
        "CardTitle.TLabel",
        background=colors["card"],
        foreground=colors["accent"],
        font=(UI_FONT_SEMIBOLD, 10),
    )
    style.configure(
        "CardMuted.TLabel",
        background=colors["card"],
        foreground=colors["muted"],
        font=(UI_FONT, 9),
    )
    style.configure(
        "Status.TLabel",
        background=colors["bg"],
        foreground=colors["accent"],
        font=(UI_FONT_SEMIBOLD, 10),
        padding=(8, 5),
    )
    for style_name, foreground in (
        ("RunSummary.TLabel", colors["muted"]),
        ("RunSummaryRunning.TLabel", colors["accent"]),
        ("RunSummarySuccess.TLabel", colors["completed_text"]),
        ("RunSummaryWarning.TLabel", colors["warning"]),
        ("RunSummaryError.TLabel", colors["error"]),
    ):
        background = (
            colors["completed"]
            if style_name == "RunSummarySuccess.TLabel"
            else colors["bg"]
        )
        style.configure(
            style_name,
            background=background,
            foreground=foreground,
            font=(UI_FONT_SEMIBOLD, 9),
            padding=(7, 4),
        )
    for style_name, foreground in (
        ("ModuleStatus.TLabel", colors["muted"]),
        ("ModuleStatusBusy.TLabel", colors["accent"]),
        ("ModuleStatusReady.TLabel", colors["warning"]),
        ("ModuleStatusSuccess.TLabel", colors["completed_text"]),
        ("ModuleStatusError.TLabel", colors["error"]),
    ):
        background = (
            colors["completed"]
            if style_name == "ModuleStatusSuccess.TLabel"
            else colors["card"]
        )
        style.configure(
            style_name,
            background=background,
            foreground=foreground,
            font=(UI_FONT, 9),
        )

    style.configure(
        "TCheckbutton",
        background=colors["card"],
        foreground=colors["text"],
    )
    style.configure(
        "Card.TCheckbutton",
        background=colors["card"],
        foreground=colors["text"],
    )
    for style_name, background in (
        ("TCheckbutton", colors["card"]),
        ("Card.TCheckbutton", colors["card"]),
    ):
        style.map(
            style_name,
            background=[("active", background), ("pressed", background)],
            foreground=[("disabled", colors["disabled"])],
        )

    style.configure(
        "TButton",
        background=colors["button"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["button"],
        darkcolor=colors["button"],
        relief="flat",
        borderwidth=1,
        padding=(10, 5),
        font=(UI_FONT, 9),
    )
    style.map(
        "TButton",
        background=[
            ("disabled", colors["card"]),
            ("pressed", colors["button_pressed"]),
            ("active", colors["button_active"]),
        ],
        foreground=[("disabled", colors["disabled"])],
    )
    style.configure(
        "Accent.TButton",
        background=colors["accent_fill"],
        foreground=colors["selected_text"],
        bordercolor=colors["accent_fill"],
        lightcolor=colors["accent_fill"],
        darkcolor=colors["accent_fill"],
        relief="flat",
        borderwidth=1,
        padding=(18, 8),
        font=(UI_FONT_SEMIBOLD, 10),
    )
    style.map(
        "Accent.TButton",
        background=[
            ("disabled", colors["disabled"]),
            ("pressed", colors["accent_pressed"]),
            ("active", colors["accent_hover"]),
        ],
        foreground=[("disabled", colors["card"])],
    )
    style.configure(
        "Subtle.TButton",
        background=colors["bg"],
        foreground=colors["text"],
        bordercolor=colors["bg"],
        lightcolor=colors["bg"],
        darkcolor=colors["bg"],
        relief="flat",
        padding=(9, 5),
    )
    style.map(
        "Subtle.TButton",
        background=[
            ("pressed", colors["button_pressed"]),
            ("active", colors["button_active"]),
        ],
        foreground=[("disabled", colors["disabled"])],
    )
    for style_name, foreground in (
        ("HeaderIcon.TButton", colors["text"]),
        ("HeaderIconActive.TButton", colors["accent"]),
    ):
        style.configure(
            style_name,
            background=colors["bg"],
            foreground=foreground,
            bordercolor=colors["border"],
            lightcolor=colors["bg"],
            darkcolor=colors["bg"],
            relief="flat",
            borderwidth=1,
            padding=(7, 5),
            font=(ICON_FONT, 11),
        )
        style.map(
            style_name,
            background=[
                ("pressed", colors["button_pressed"]),
                ("active", colors["button_active"]),
            ],
            foreground=[("disabled", colors["disabled"])],
        )
    style.configure(
        "Compact.TButton",
        background=colors["button"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["button"],
        darkcolor=colors["button"],
        relief="flat",
        padding=(8, 3),
        font=(UI_FONT, 9),
    )
    style.map(
        "Compact.TButton",
        background=[
            ("pressed", colors["button_pressed"]),
            ("active", colors["button_active"]),
        ],
        foreground=[("disabled", colors["disabled"])],
    )
    style.configure(
        "CompactIcon.TButton",
        background=colors["button"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["button"],
        darkcolor=colors["button"],
        relief="flat",
        padding=(5, 3),
        font=(ICON_FONT, 9),
    )
    style.map(
        "CompactIcon.TButton",
        background=[
            ("pressed", colors["button_pressed"]),
            ("active", colors["button_active"]),
        ],
        foreground=[("disabled", colors["disabled"])],
    )
    style.configure(
        "TEntry",
        fieldbackground=colors["entry"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["border"],
        darkcolor=colors["border"],
        padding=(5, 4),
    )
    style.map(
        "TEntry",
        fieldbackground=[
            ("disabled", colors["card"]),
            ("focus", colors["entry_focus"]),
        ],
        foreground=[("disabled", colors["disabled"])],
    )
    style.configure(
        "Treeview",
        background=colors["tree"],
        fieldbackground=colors["tree"],
        foreground=colors["tree_text"],
        bordercolor=colors["border"],
        lightcolor=colors["border"],
        darkcolor=colors["border"],
        borderwidth=0,
        rowheight=25,
        font=(UI_FONT, 9),
    )
    style.map(
        "Treeview",
        background=[("selected", colors["selected"])],
        foreground=[("selected", colors["selected_text"])],
    )
    style.configure(
        "Treeview.Heading",
        background=colors["heading"],
        foreground=colors["heading_text"],
        bordercolor=colors["border"],
        lightcolor=colors["border"],
        darkcolor=colors["border"],
        relief="flat",
        font=(UI_FONT_SEMIBOLD, 9),
        padding=(6, 5),
    )
    style.map(
        "Treeview.Heading",
        background=[("active", colors["button_active"])],
    )
    style.configure(
        "TScrollbar",
        background=colors["scrollbar"],
        troughcolor=colors["scroll_trough"],
        bordercolor=colors["border"],
        lightcolor=colors["scrollbar"],
        darkcolor=colors["border"],
        arrowcolor=colors["text"],
    )
    style.configure("TSeparator", background=colors["border"])
    style.configure(
        "Signature.TLabel",
        background=colors["bg"],
        foreground=colors["muted"],
        font=(UI_FONT, 9, "italic"),
    )
    style.configure(
        "UpdateDot.TLabel",
        background=colors["bg"],
        foreground=colors["muted"],
        font=(UI_FONT, 11, "bold"),
    )
    style.configure(
        "UpdateDotReady.TLabel",
        background=colors["bg"],
        foreground=colors["error"],
        font=(UI_FONT, 11, "bold"),
    )
    style.configure(
        "LiveLog.Treeview",
        background=colors["tree"],
        fieldbackground=colors["tree"],
        foreground=colors["tree_text"],
    )
    style.configure(
        "Completed.LiveLog.Treeview",
        background=colors["completed"],
        fieldbackground=colors["completed"],
        foreground=colors["completed_text"],
    )
    style.configure(
        "Warning.LiveLog.Treeview",
        background=colors["warning_surface"],
        fieldbackground=colors["warning_surface"],
        foreground=colors["warning"],
    )
    style.configure(
        "Failed.LiveLog.Treeview",
        background=colors["error_surface"],
        fieldbackground=colors["error_surface"],
        foreground=colors["error"],
    )
    return colors
