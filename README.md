<div align="center">

# LibreTube Downloader

A clean, modern desktop video downloader. Paste a URL, preview the video, pick a quality, and download.

Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp), so it works with YouTube and hundreds of other sites.

![Python](https://img.shields.io/badge/python-3.9%2B-3776AB?logo=python&logoColor=white)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-22c55e)
![UI](https://img.shields.io/badge/UI-customtkinter-1c1e22)

<img src="screenshots/preview.png" width="620" alt="LibreTube Downloader showing a fetched video ready to download">

</div>

## Screenshots

<table>
<tr>
<td align="center" width="33%">
<img src="screenshots/idle.png" width="260" alt="Idle state, waiting for a URL"><br>
<sub>Paste a URL to get started</sub>
</td>
<td align="center" width="33%">
<img src="screenshots/preview.png" width="260" alt="Fetched video with thumbnail, title, and quality picker"><br>
<sub>Preview, pick a quality, choose a folder</sub>
</td>
<td align="center" width="33%">
<img src="screenshots/downloading.png" width="260" alt="Download in progress with speed and ETA"><br>
<sub>Live progress with speed and ETA</sub>
</td>
</tr>
</table>

## Features

- Paste a URL and fetch title, uploader, duration, and thumbnail before downloading
- Quality presets: Best available, 1080p, 720p, 480p, or Audio only (MP3)
- Custom download folder picker
- Live progress bar with speed and ETA, and a cancel button mid-download
- Frameless window with a custom titlebar — drag anywhere on it to move, minimize/close on the right
- Smooth fade in on launch, fade out on close
- Scrollable content area, so the fixed-size window stays comfortable on small screens
- Dark, rounded, modern UI ([customtkinter](https://github.com/TomSchimansky/CustomTkinter))

## Compatibility

| | Windows | macOS | Linux |
|---|---|---|---|
| Runs | Yes | Yes | Yes |
| Extra setup | — | — | `python3-tk` system package ([see below](#1-python-dependencies)) |
| Taskbar entry while frameless | Restored automatically | OS default | OS/WM-dependent |

Requires **Python 3.9+**.

## Installation

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

## Usage

1. Paste a video URL and click **Fetch** (or press Enter)
2. Once the title and thumbnail load, pick a **quality** and, optionally, change the **save-to folder**
3. Click **Download** — the view scrolls down automatically to show progress
4. **Cancel** at any time, or let it finish; you'll be offered a shortcut to open the containing folder

The window is frameless by design — drag the titlebar to move it, and use the `—` / `✕` buttons on the top right to minimize or close. It launches centered on screen with a short fade-in, and fades out on close.

## Project layout

```
main.py                   entry point
libretube_dl/
  app.py                  UI (customtkinter): titlebar, fade animation, scrollable layout
  downloader.py           yt-dlp wrapper: metadata + threaded download with progress/cancel,
                          cross-platform ffmpeg discovery (PATH or bundled next to the app)
screenshots/              images used in this README
```
