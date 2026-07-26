"""A simple, modern desktop UI for downloading videos from a URL."""
from __future__ import annotations

import io
import os
import subprocess
import sys
import threading
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk
import requests
from PIL import Image

from .downloader import (
    QUALITY_PRESETS,
    DownloadCancelled,
    Downloader,
    VideoInfo,
    fetch_info,
    ffmpeg_available,
)

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("green")

ACCENT = "#22c55e"
ACCENT_HOVER = "#16a34a"
MUTED = "#8b8f98"
WARNING = "#e5a54b"
DANGER = "#e5484d"
SURFACE = "#1c1e22"
TITLEBAR = "#191b1f"
BUTTON_HOVER = "#2a2d33"
BACKGROUND = "#121316"

THUMB_SIZE = (560, 315)
CONTENT_WIDTH = 560
TITLEBAR_HEIGHT = 42
WINDOW_SIZE = (680, 780)

FADE_STEP = 0.09
FADE_INTERVAL_MS = 12


def _default_download_dir() -> str:
    downloads = Path.home() / "Downloads"
    return str(downloads) if downloads.is_dir() else str(Path.home())


def _reveal_in_file_manager(path: Path) -> None:
    """Open the OS file browser at `path`, using the right command per platform."""
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


DEFAULT_DOWNLOAD_DIR = _default_download_dir()


def _human_size(num_bytes: float | None) -> str:
    if not num_bytes:
        return "?"
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} TB"


def _human_duration(seconds: float | None) -> str:
    if not seconds:
        return "?"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


class App(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("LibreTube Downloader")
        self.overrideredirect(True)
        self.resizable(False, False)
        self.configure(fg_color=BACKGROUND)
        self._center_window(*WINDOW_SIZE)
        self._fix_windows_taskbar_icon()

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        # Restoring from the taskbar can silently drop overrideredirect on Windows; reassert it.
        self.bind("<Map>", lambda _e: self.overrideredirect(True))

        self.downloader = Downloader()
        self.current_info: VideoInfo | None = None
        self.output_dir = DEFAULT_DOWNLOAD_DIR
        self._thumb_image: ctk.CTkImage | None = None
        self._closed = False
        self._closing = False
        self._drag_origin: tuple[int, int, int, int] | None = None

        try:
            self.attributes("-alpha", 0.0)
        except Exception:
            pass

        self._build_titlebar()
        self._build_layout()
        if not ffmpeg_available():
            self._set_status(
                "ffmpeg not found — some quality merges and MP3 conversion may be unavailable.",
                warning=True,
            )

        self.after(30, self._fade_in)

    # ------------------------------------------------------------- window chrome
    def _center_window(self, width: int, height: int) -> None:
        x = (self.winfo_screenwidth() - width) // 2
        y = (self.winfo_screenheight() - height) // 2
        self.geometry(f"{width}x{height}+{x}+{y}")

    def _fix_windows_taskbar_icon(self) -> None:
        """Overridden-decoration windows lose their taskbar entry on Windows; restore it."""
        if sys.platform != "win32":
            return
        try:
            import ctypes

            gwl_exstyle = -20
            ws_ex_appwindow = 0x00040000
            ws_ex_toolwindow = 0x00000080
            hwnd = ctypes.windll.user32.GetParent(self.winfo_id())
            style = ctypes.windll.user32.GetWindowLongW(hwnd, gwl_exstyle)
            style = (style & ~ws_ex_toolwindow) | ws_ex_appwindow
            ctypes.windll.user32.SetWindowLongW(hwnd, gwl_exstyle, style)
            self.withdraw()
            self.after(10, self.deiconify)
        except Exception:
            pass

    def _fade_in(self, alpha: float = 0.0) -> None:
        alpha = min(alpha + FADE_STEP, 1.0)
        try:
            self.attributes("-alpha", alpha)
        except Exception:
            return
        if alpha < 1.0:
            self.after(FADE_INTERVAL_MS, lambda: self._fade_in(alpha))

    def _fade_out(self, on_done, alpha: float = 1.0) -> None:
        alpha = max(alpha - FADE_STEP, 0.0)
        try:
            self.attributes("-alpha", alpha)
        except Exception:
            on_done()
            return
        if alpha > 0.0:
            self.after(FADE_INTERVAL_MS, lambda: self._fade_out(on_done, alpha))
        else:
            on_done()

    def _start_drag(self, event) -> None:
        self._drag_origin = (event.x_root, event.y_root, self.winfo_x(), self.winfo_y())

    def _do_drag(self, event) -> None:
        if self._drag_origin is None:
            return
        start_x, start_y, win_x, win_y = self._drag_origin
        new_x = win_x + (event.x_root - start_x)
        new_y = win_y + (event.y_root - start_y)
        self.geometry(f"+{new_x}+{new_y}")

    # ---------------------------------------------------------------- layout
    def _build_titlebar(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        bar = ctk.CTkFrame(self, fg_color=TITLEBAR, corner_radius=0, height=TITLEBAR_HEIGHT)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_propagate(False)
        bar.grid_columnconfigure(1, weight=1)

        logo = ctk.CTkLabel(
            bar,
            text="⬇",
            width=24,
            height=24,
            corner_radius=7,
            fg_color=ACCENT,
            text_color="#0b1210",
            font=ctk.CTkFont(size=12, weight="bold"),
        )
        logo.grid(row=0, column=0, padx=(14, 8), pady=9)

        name = ctk.CTkLabel(
            bar,
            text="LibreTube Downloader",
            text_color="#d7d9dd",
            font=ctk.CTkFont(size=12, weight="bold"),
            anchor="w",
        )
        name.grid(row=0, column=1, sticky="w")

        min_btn = ctk.CTkButton(
            bar,
            text="—",
            width=38,
            height=TITLEBAR_HEIGHT,
            corner_radius=0,
            fg_color="transparent",
            hover_color=BUTTON_HOVER,
            text_color="#c7cad0",
            font=ctk.CTkFont(size=12),
            command=self._on_minimize,
        )
        min_btn.grid(row=0, column=2)

        close_btn = ctk.CTkButton(
            bar,
            text="✕",
            width=38,
            height=TITLEBAR_HEIGHT,
            corner_radius=0,
            fg_color="transparent",
            hover_color=DANGER,
            text_color="#c7cad0",
            font=ctk.CTkFont(size=12),
            command=self._on_close,
        )
        close_btn.grid(row=0, column=3)

        for widget in (bar, logo, name):
            widget.bind("<ButtonPress-1>", self._start_drag)
            widget.bind("<B1-Motion>", self._do_drag)

    def _build_layout(self) -> None:
        content = ctk.CTkFrame(self, fg_color="transparent", width=CONTENT_WIDTH)
        content.grid(row=1, column=0, sticky="n", pady=(28, 24))
        content.grid_columnconfigure(0, weight=1, minsize=CONTENT_WIDTH)

        # ---- URL bar (pill-shaped, button embedded on the right)
        url_bar = ctk.CTkFrame(content, fg_color=SURFACE, corner_radius=22, height=48)
        url_bar.grid(row=0, column=0, sticky="ew")
        url_bar.grid_columnconfigure(0, weight=1)
        url_bar.grid_propagate(False)

        self.url_entry = ctk.CTkEntry(
            url_bar,
            placeholder_text="Paste a video URL...",
            border_width=0,
            fg_color="transparent",
            font=ctk.CTkFont(size=13),
        )
        self.url_entry.grid(row=0, column=0, sticky="ew", padx=(16, 4), pady=4)
        self.url_entry.bind("<Return>", lambda _e: self._on_fetch())

        self.fetch_btn = ctk.CTkButton(
            url_bar,
            text="Fetch",
            width=84,
            height=38,
            corner_radius=19,
            fg_color=ACCENT,
            hover_color=ACCENT_HOVER,
            text_color="#0b1210",
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._on_fetch,
        )
        self.fetch_btn.grid(row=0, column=1, padx=5, pady=5)

        # ---- Preview card
        self.preview_card = ctk.CTkFrame(content, fg_color=SURFACE, corner_radius=18)
        self.preview_card.grid(row=1, column=0, sticky="ew", pady=(20, 0))
        self.preview_card.grid_columnconfigure(0, weight=1)

        self.thumb_label = ctk.CTkLabel(
            self.preview_card,
            text="Video preview will appear here",
            text_color=MUTED,
            height=THUMB_SIZE[1] // 2,
            corner_radius=18,
            fg_color="transparent",
        )
        self.thumb_label.grid(row=0, column=0, sticky="ew", padx=14, pady=(14, 8))

        self.title_label = ctk.CTkLabel(
            self.preview_card,
            text="",
            font=ctk.CTkFont(size=15, weight="bold"),
            anchor="w",
            justify="left",
            wraplength=CONTENT_WIDTH - 40,
        )
        self.title_label.grid(row=1, column=0, sticky="ew", padx=18)

        self.meta_label = ctk.CTkLabel(
            self.preview_card, text="", text_color=MUTED, anchor="w", font=ctk.CTkFont(size=12)
        )
        self.meta_label.grid(row=2, column=0, sticky="ew", padx=18, pady=(2, 16))

        # ---- Quality segmented control
        ctk.CTkLabel(
            content, text="Quality", font=ctk.CTkFont(size=12, weight="bold"), text_color=MUTED
        ).grid(row=2, column=0, sticky="w", pady=(22, 6))

        self.quality_picker = ctk.CTkSegmentedButton(
            content,
            values=list(QUALITY_PRESETS.keys()),
            fg_color=SURFACE,
            selected_color=ACCENT,
            selected_hover_color=ACCENT_HOVER,
            unselected_color=SURFACE,
            text_color="#e6e8eb",
            font=ctk.CTkFont(size=12),
        )
        self.quality_picker.set("Best available")
        self.quality_picker.grid(row=3, column=0, sticky="ew")

        # ---- Save-to row
        ctk.CTkLabel(
            content, text="Save to", font=ctk.CTkFont(size=12, weight="bold"), text_color=MUTED
        ).grid(row=4, column=0, sticky="w", pady=(22, 6))

        folder_row = ctk.CTkFrame(content, fg_color="transparent")
        folder_row.grid(row=5, column=0, sticky="ew")
        folder_row.grid_columnconfigure(0, weight=1)

        self.folder_label = ctk.CTkLabel(
            folder_row, text=self.output_dir, text_color="#c7cad0", anchor="w", font=ctk.CTkFont(size=12)
        )
        self.folder_label.grid(row=0, column=0, sticky="ew")

        ctk.CTkButton(
            folder_row,
            text="Change",
            width=70,
            height=26,
            corner_radius=13,
            fg_color="transparent",
            border_width=1,
            border_color=MUTED,
            text_color="#c7cad0",
            font=ctk.CTkFont(size=11),
            command=self._on_browse,
        ).grid(row=0, column=1, padx=(8, 0))

        # ---- Primary action
        self.download_btn = ctk.CTkButton(
            content,
            text="Download",
            height=46,
            corner_radius=23,
            fg_color=ACCENT,
            hover_color=ACCENT_HOVER,
            text_color="#0b1210",
            font=ctk.CTkFont(size=14, weight="bold"),
            state="disabled",
            command=self._on_download,
        )
        self.download_btn.grid(row=6, column=0, sticky="ew", pady=(28, 0))

        # ---- Progress
        self.progress_bar = ctk.CTkProgressBar(
            content, height=6, corner_radius=3, progress_color=ACCENT, fg_color=SURFACE
        )
        self.progress_bar.set(0)
        self.progress_bar.grid(row=7, column=0, sticky="ew", pady=(18, 0))

        status_row = ctk.CTkFrame(content, fg_color="transparent")
        status_row.grid(row=8, column=0, sticky="ew", pady=(8, 0))
        status_row.grid_columnconfigure(0, weight=1)

        self.status_label = ctk.CTkLabel(
            status_row, text="Ready.", anchor="w", text_color=MUTED, font=ctk.CTkFont(size=12)
        )
        self.status_label.grid(row=0, column=0, sticky="ew")

        self.cancel_btn = ctk.CTkButton(
            status_row,
            text="Cancel",
            width=60,
            height=22,
            corner_radius=11,
            fg_color="transparent",
            hover_color=SURFACE,
            text_color=WARNING,
            font=ctk.CTkFont(size=11),
            state="disabled",
            command=self._on_cancel,
        )
        self.cancel_btn.grid(row=0, column=1)

    # ---------------------------------------------------------------- helpers
    def _set_status(self, text: str, warning: bool = False) -> None:
        self.status_label.configure(text=text, text_color=WARNING if warning else MUTED)

    def _set_busy(self, busy: bool) -> None:
        state = "disabled" if busy else "normal"
        self.fetch_btn.configure(state=state)
        self.url_entry.configure(state=state)
        self.quality_picker.configure(state=state)
        self.download_btn.configure(state="disabled" if busy or not self.current_info else "normal")
        self.cancel_btn.configure(state="normal" if busy else "disabled")

    def _run_on_ui(self, callback) -> None:
        """Schedule a callback on the Tk thread, unless the window is already gone."""
        if self._closed:
            return
        try:
            self.after(0, callback)
        except RuntimeError:
            pass

    def _on_close(self) -> None:
        if self._closing:
            return
        self._closing = True
        self.downloader.cancel()
        self._fade_out(self._finalize_close)

    def _finalize_close(self) -> None:
        self._closed = True
        self.destroy()

    def _on_minimize(self) -> None:
        try:
            self.iconify()
        except Exception:
            pass

    # ---------------------------------------------------------------- actions
    def _on_browse(self) -> None:
        chosen = filedialog.askdirectory(initialdir=self.output_dir)
        if chosen:
            self.output_dir = chosen
            self.folder_label.configure(text=chosen)

    def _on_fetch(self) -> None:
        url = self.url_entry.get().strip()
        if not url:
            self._set_status("Enter a URL first.", warning=True)
            return
        self._set_busy(True)
        self._set_status("Fetching video info...")
        threading.Thread(target=self._fetch_worker, args=(url,), daemon=True).start()

    def _fetch_worker(self, url: str) -> None:
        try:
            info = fetch_info(url)
        except Exception as exc:  # yt-dlp raises various error types
            error = exc
            self._run_on_ui(lambda: self._on_fetch_error(error))
            return
        self._run_on_ui(lambda: self._on_fetch_success(info))

    def _on_fetch_error(self, exc: Exception) -> None:
        self._set_busy(False)
        self._set_status(f"Couldn't fetch that URL: {exc}", warning=True)
        messagebox.showerror("Fetch failed", str(exc))

    def _on_fetch_success(self, info: VideoInfo) -> None:
        self.current_info = info
        self._set_busy(False)
        self.title_label.configure(text=info.title)
        self.meta_label.configure(text=f"{info.uploader} · {_human_duration(info.duration)}")
        self._set_status("Ready to download.")
        self.download_btn.configure(state="normal")
        if info.thumbnail_url:
            threading.Thread(target=self._load_thumbnail, args=(info.thumbnail_url,), daemon=True).start()

    def _load_thumbnail(self, thumb_url: str) -> None:
        try:
            resp = requests.get(thumb_url, timeout=10)
            resp.raise_for_status()
            image = Image.open(io.BytesIO(resp.content)).convert("RGB")
            width = CONTENT_WIDTH - 28
            height = int(width * image.height / image.width)
            image = image.resize((width, height), Image.LANCZOS)
        except Exception:
            return
        self._run_on_ui(lambda: self._show_thumbnail(image))

    def _show_thumbnail(self, image: Image.Image) -> None:
        self._thumb_image = ctk.CTkImage(light_image=image, dark_image=image, size=image.size)
        self.thumb_label.configure(image=self._thumb_image, text="", height=image.size[1])

    def _on_download(self) -> None:
        if not self.current_info:
            return
        self._set_busy(True)
        self.progress_bar.set(0)
        self._set_status("Starting download...")
        quality = self.quality_picker.get()
        url = self.current_info.webpage_url
        threading.Thread(
            target=self._download_worker, args=(url, quality, self.output_dir), daemon=True
        ).start()

    def _on_cancel(self) -> None:
        self.downloader.cancel()
        self._set_status("Cancelling...")

    def _download_worker(self, url: str, quality: str, output_dir: str) -> None:
        try:
            path = self.downloader.download(url, quality, output_dir, self._progress_hook)
        except DownloadCancelled:
            self._run_on_ui(lambda: self._on_download_cancelled())
            return
        except Exception as exc:
            error = exc
            self._run_on_ui(lambda: self._on_download_error(error))
            return
        self._run_on_ui(lambda: self._on_download_success(path))

    def _progress_hook(self, status: dict) -> None:
        state = status.get("status")
        if state == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            downloaded = status.get("downloaded_bytes", 0)
            fraction = (downloaded / total) if total else 0
            speed = _human_size(status.get("speed")) + "/s" if status.get("speed") else "?"
            eta = status.get("eta")
            eta_text = f"{eta}s" if eta is not None else "?"
            text = (
                f"Downloading {_human_size(downloaded)} / {_human_size(total)}"
                f"  ·  {speed}  ·  ETA {eta_text}"
            )
            self._run_on_ui(lambda: (self.progress_bar.set(fraction), self._set_status(text)))
        elif state == "finished":
            self._run_on_ui(lambda: (self.progress_bar.set(1), self._set_status("Processing...")))

    def _on_download_success(self, path: Path) -> None:
        self._set_busy(False)
        self.progress_bar.set(1)
        self._set_status(f"Done: {path.name}")
        if messagebox.askyesno("Download complete", f"Saved to:\n{path}\n\nOpen containing folder?"):
            _reveal_in_file_manager(path.parent)

    def _on_download_cancelled(self) -> None:
        self._set_busy(False)
        self.progress_bar.set(0)
        self._set_status("Download cancelled.")

    def _on_download_error(self, exc: Exception) -> None:
        self._set_busy(False)
        self.progress_bar.set(0)
        self._set_status(f"Download failed: {exc}", warning=True)
        messagebox.showerror("Download failed", str(exc))


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
