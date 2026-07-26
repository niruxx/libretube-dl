"""yt-dlp wrapper: metadata fetching and threaded downloads with progress/cancel support."""
from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import yt_dlp

QUALITY_PRESETS = {
    "Best available": "bestvideo+bestaudio/best",
    "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "Audio only (MP3)": "bestaudio/best",
}

# Project root (the directory main.py lives in), used to look for a
# ffmpeg/ffmpeg.exe binary placed next to the app when it isn't on PATH.
APP_ROOT = Path(__file__).resolve().parent.parent
FFMPEG_BINARY_NAME = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"


class DownloadCancelled(Exception):
    """Raised internally to abort an in-progress yt-dlp download."""


@dataclass
class VideoInfo:
    title: str
    uploader: str
    duration: Optional[float]
    thumbnail_url: Optional[str]
    webpage_url: str
    raw: dict = field(repr=False, default_factory=dict)


def _local_ffmpeg_dirs() -> list[Path]:
    dirs = [APP_ROOT, APP_ROOT / "bin"]
    if getattr(sys, "frozen", False):  # PyInstaller-style bundled executable
        dirs.append(Path(sys.executable).resolve().parent)
    return dirs


def find_ffmpeg() -> Optional[str]:
    """Locate an ffmpeg binary on PATH, or bundled next to the app."""
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    for directory in _local_ffmpeg_dirs():
        candidate = directory / FFMPEG_BINARY_NAME
        if candidate.is_file():
            return str(candidate)
    return None


def ffmpeg_available() -> bool:
    return find_ffmpeg() is not None


def fetch_info(url: str) -> VideoInfo:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        data = ydl.extract_info(url, download=False)
    if "entries" in data and data["entries"]:
        data = data["entries"][0]
    return VideoInfo(
        title=data.get("title") or "Unknown title",
        uploader=data.get("uploader") or data.get("channel") or "Unknown uploader",
        duration=data.get("duration"),
        thumbnail_url=data.get("thumbnail"),
        webpage_url=data.get("webpage_url") or url,
        raw=data,
    )


class Downloader:
    """Runs a single yt-dlp download, reporting progress and honoring cancellation."""

    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def download(
        self,
        url: str,
        quality: str,
        output_dir: str,
        on_progress: Callable[[dict], None],
    ) -> Path:
        self._cancelled = False
        format_selector = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["Best available"])
        extract_audio = quality == "Audio only (MP3)"
        ffmpeg_path = find_ffmpeg()

        def hook(status: dict) -> None:
            if self._cancelled:
                raise DownloadCancelled()
            on_progress(status)

        opts = {
            "format": format_selector,
            "outtmpl": str(Path(output_dir) / "%(title)s.%(ext)s"),
            "progress_hooks": [hook],
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "restrictfilenames": False,
        }

        if ffmpeg_path:
            opts["ffmpeg_location"] = ffmpeg_path
            if extract_audio:
                opts["postprocessors"] = [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
                ]
            else:
                opts["merge_output_format"] = "mp4"

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
                if extract_audio and ffmpeg_path:
                    filename = str(Path(filename).with_suffix(".mp3"))
                return Path(filename)
        except DownloadCancelled:
            raise
        except yt_dlp.utils.DownloadError as exc:
            if self._cancelled:
                raise DownloadCancelled() from exc
            raise
