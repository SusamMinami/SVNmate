from tkinter import Tk, ttk


LIGHT_COLORS = {
    "bg": "#F3F6FA",
    "card": "#FFFFFF",
    "tree": "#FBFCFE",
    "text": "#172033",
    "muted": "#667085",
    "border": "#D8E0EA",
    "accent": "#0078D4",
    "accent_hover": "#106EBE",
    "accent_soft": "#E8F3FC",
    "success": "#107C10",
    "warning": "#9D5D00",
    "error": "#C42B1C",
}

DARK_COLORS = {
    "bg": "#111827",
    "card": "#1F2937",
    "tree": "#182231",
    "text": "#F3F4F6",
    "muted": "#A7B0BF",
    "border": "#344155",
    "accent": "#2899F5",
    "accent_hover": "#48AEF7",
    "accent_soft": "#163A59",
    "success": "#6CCB5F",
    "warning": "#F3C969",
    "error": "#FF8A80",
}


def configure_styles(root: Tk, style: ttk.Style, dark: bool) -> dict[str, str]:
    colors = DARK_COLORS if dark else LIGHT_COLORS
    root.configure(bg=colors["bg"])
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(
        ".",
        font=("Segoe UI", 10),
        background=colors["card"],
        foreground=colors["text"],
    )
    style.configure("App.TFrame", background=colors["bg"])
    style.configure("Card.TFrame", background=colors["card"])
    style.configure("CardBorder.TFrame", background=colors["border"])
    style.configure("ActiveCardBorder.TFrame", background=colors["accent"])
    style.configure("Title.TLabel", background=colors["bg"], foreground=colors["text"], font=("Segoe UI Semibold", 24))
    style.configure("Subtitle.TLabel", background=colors["bg"], foreground=colors["muted"], font=("Segoe UI", 9))
    style.configure("Section.TLabel", background=colors["card"], foreground=colors["text"], font=("Segoe UI Semibold", 12))
    style.configure(
        "ProfileName.TLabel",
        background=colors["bg"],
        foreground=colors["text"],
        font=("Segoe UI Semibold", 22),
    )
    style.configure(
        "ProfileMeta.TLabel",
        background=colors["bg"],
        foreground=colors["muted"],
        font=("Segoe UI Semibold", 9),
    )
    style.configure(
        "ProfileSection.TLabel",
        background=colors["bg"],
        foreground=colors["text"],
        font=("Segoe UI Semibold", 11),
    )
    style.configure(
        "ProfileSectionCard.TLabel",
        background=colors["card"],
        foreground=colors["text"],
        font=("Segoe UI Semibold", 11),
    )
    style.configure(
        "Tag.TLabel",
        background=colors["accent_soft"],
        foreground=colors["accent"],
        font=("Segoe UI Semibold", 9),
        padding=(7, 3),
    )
    style.configure(
        "FocusBadge.TLabel",
        background=colors["accent_soft"],
        foreground=colors["accent"],
        font=("Segoe UI Semibold", 9),
        padding=(7, 3),
    )
    style.configure("Muted.TLabel", background=colors["card"], foreground=colors["muted"], font=("Segoe UI", 9))
    style.configure("AppMuted.TLabel", background=colors["bg"], foreground=colors["muted"], font=("Segoe UI", 9))
    style.configure(
        "UpdateDot.TLabel",
        background=colors["bg"],
        foreground=colors["muted"],
        font=("Segoe UI Semibold", 11),
    )
    style.configure(
        "UpdateDotReady.TLabel",
        background=colors["bg"],
        foreground=colors["error"],
        font=("Segoe UI Semibold", 11),
    )
    style.configure("Arrow.TLabel", background=colors["bg"], foreground=colors["accent"], font=("Segoe UI Semibold", 20))
    style.configure("StatusGood.TLabel", background=colors["bg"], foreground=colors["success"], font=("Segoe UI Semibold", 9))
    style.configure("StatusWarn.TLabel", background=colors["bg"], foreground=colors["warning"], font=("Segoe UI Semibold", 9))
    style.configure("StatusError.TLabel", background=colors["bg"], foreground=colors["error"], font=("Segoe UI Semibold", 9))
    style.configure("Message.TLabel", background=colors["bg"], foreground=colors["muted"], font=("Segoe UI", 9))
    style.configure("MessageWarn.TLabel", background=colors["bg"], foreground=colors["warning"], font=("Segoe UI", 9))
    style.configure("MessageError.TLabel", background=colors["bg"], foreground=colors["error"], font=("Segoe UI", 9))
    style.configure(
        "Toast.TLabel",
        background=colors["accent"],
        foreground="#FFFFFF",
        font=("Segoe UI Semibold", 9),
    )

    style.configure(
        "Accent.TButton",
        background=colors["accent"],
        foreground="#FFFFFF",
        borderwidth=0,
        padding=(14, 7),
        font=("Segoe UI Semibold", 10),
    )
    style.map(
        "Accent.TButton",
        background=[("active", colors["accent_hover"]), ("disabled", colors["border"])],
        foreground=[("disabled", colors["muted"])],
    )
    style.configure(
        "Subtle.TButton",
        background=colors["card"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["border"],
        darkcolor=colors["border"],
        padding=(10, 6),
    )
    style.map("Subtle.TButton", background=[("active", colors["accent_soft"])])
    style.configure(
        "Segment.TButton",
        background=colors["card"],
        foreground=colors["text"],
        bordercolor=colors["border"],
        lightcolor=colors["border"],
        darkcolor=colors["border"],
        padding=(13, 6),
        font=("Segoe UI Semibold", 9),
    )
    style.map(
        "Segment.TButton",
        background=[("active", colors["accent_soft"])],
    )
    style.configure(
        "SegmentActive.TButton",
        background=colors["accent"],
        foreground="#FFFFFF",
        borderwidth=0,
        padding=(13, 6),
        font=("Segoe UI Semibold", 9),
    )
    style.map(
        "SegmentActive.TButton",
        background=[("active", colors["accent_hover"])],
        foreground=[("disabled", colors["muted"])],
    )
    style.configure("TEntry", fieldbackground=colors["tree"], foreground=colors["text"], bordercolor=colors["border"])
    style.configure("TCombobox", fieldbackground=colors["tree"], foreground=colors["text"], bordercolor=colors["border"])

    style.configure(
        "Result.Treeview",
        background=colors["tree"],
        fieldbackground=colors["tree"],
        foreground=colors["text"],
        borderwidth=0,
        rowheight=29,
    )
    style.map(
        "Result.Treeview",
        background=[("selected", colors["accent_soft"])],
        foreground=[("selected", colors["text"])],
    )
    style.configure(
        "Result.Treeview.Heading",
        background=colors["card"],
        foreground=colors["muted"],
        bordercolor=colors["border"],
        font=("Segoe UI Semibold", 9),
        padding=(6, 6),
    )
    return colors
