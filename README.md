# libretube-dl-py

A clean, modern desktop video downloader. Paste a URL, preview the video, pick a quality, and download — powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) under the hood, so it works with YouTube and hundreds of other sites.

Runs on Windows, macOS, and Linux.

## Setup

### 1. Python dependencies

```bash
pip install -r requirements.txt
```

**Linux only:** Tk isn't bundled with pip — install it via your package manager first, e.g. `sudo apt install python3-tk` (Debian/Ubuntu), `sudo dnf install python3-tkinter` (Fedora), or `sudo pacman -S tk` (Arch). Windows and macOS python.org installers already include Tk.

### 2. ffmpeg (recommended)

ffmpeg is required to merge separate video/audio streams into a single file at 1080p/720p/480p, and to convert to MP3 for the audio-only option. Without it, the app still runs, but falls back to pre-merged formats where the site offers them.

The app looks for ffmpeg in two places, in order:

1. **On your `PATH`** — install it normally for your OS:
   - **Windows:** `winget install ffmpeg` (or download from [ffmpeg.org](https://ffmpeg.org/download.html) and add the `bin` folder to `PATH`)
   - **macOS:** `brew install ffmpeg`
   - **Linux:** `sudo apt install ffmpeg` (Debian/Ubuntu), `sudo dnf install ffmpeg` (Fedora), `sudo pacman -S ffmpeg` (Arch)
2. **Next to the app** — drop an `ffmpeg` (or `ffmpeg.exe` on Windows) binary directly in the project root, alongside `main.py`. No `PATH` changes needed; the app finds it automatically at startup. This is handy on Windows or for a portable/no-install setup.

Either way works — no extra configuration required. The status bar at the bottom of the app will warn you if no ffmpeg was found.

## Run

```bash
python main.py
```

On macOS/Linux this may need to be `python3 main.py` instead, depending on how Python is installed.

## Features

- Paste a URL and fetch title, uploader, duration, and thumbnail before downloading
- Quality presets: Best available, 1080p, 720p, 480p, or Audio only (MP3)
- Custom download folder picker
- Live progress bar with speed and ETA
- Cancel an in-progress download
- Frameless window with a custom titlebar (drag anywhere on it to move, minimize/close on the right) and a smooth fade in on launch / fade out on close
- Dark, rounded, modern UI ([customtkinter](https://github.com/TomSchimansky/CustomTkinter))
- Cross-platform: Windows, macOS, Linux

The window is fixed-size and undecorated by design (no native titlebar), so it isn't resizable by dragging an edge.

## Project layout

```
main.py                   entry point
libretube_dl/
  app.py                  UI (customtkinter)
  downloader.py           yt-dlp wrapper: metadata + threaded download with progress/cancel,
                           cross-platform ffmpeg discovery (PATH or bundled next to the app)
```