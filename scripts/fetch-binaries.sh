#!/usr/bin/env bash
# Downloads the yt-dlp and ffmpeg sidecar binaries that get bundled into the app/installer
# via Tauri's `bundle.externalBin`. Linux/macOS counterpart to fetch-binaries.ps1.
#
# Run this once before `npm run tauri build` (or `npm start`) so the app ships with
# yt-dlp and ffmpeg built in — no separate install required on the end user's machine.
# Binaries are gitignored (large, platform-specific) so every dev/CI machine fetches
# its own copy via this script rather than committing them to source control.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="$root/src-tauri/binaries"
mkdir -p "$bin_dir"

if ! command -v rustc >/dev/null 2>&1; then
  echo "rustc not found on PATH — install the Rust toolchain first." >&2
  exit 1
fi

host_triple="$(rustc -vV | sed -n 's/^host: //p')"
echo "Target triple: $host_triple"

os="$(uname -s)"

ytdlp_dest="$bin_dir/yt-dlp-$host_triple"
if [ -f "$ytdlp_dest" ]; then
  echo "yt-dlp sidecar already present at $ytdlp_dest"
else
  echo "Downloading yt-dlp..."
  case "$os" in
    Darwin) ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" ;;
    *)      ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" ;;
  esac
  curl -fL --progress-bar -o "$ytdlp_dest" "$ytdlp_url"
  chmod +x "$ytdlp_dest"
  echo "Saved to $ytdlp_dest"
fi

ffmpeg_dest="$bin_dir/ffmpeg-$host_triple"
if [ -f "$ffmpeg_dest" ]; then
  echo "ffmpeg sidecar already present at $ffmpeg_dest"
else
  echo "Downloading ffmpeg..."
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  if [ "$os" = "Darwin" ]; then
    archive="$tmp_dir/ffmpeg.zip"
    curl -fL --progress-bar -o "$archive" "https://evermeet.cx/ffmpeg/getrelease/zip"
    unzip -o -q "$archive" -d "$tmp_dir"
    found="$(find "$tmp_dir" -type f -iname 'ffmpeg' | head -n1)"
  else
    archive="$tmp_dir/ffmpeg.tar.xz"
    curl -fL --progress-bar -o "$archive" \
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    tar -xJf "$archive" -C "$tmp_dir"
    found="$(find "$tmp_dir" -type f -name 'ffmpeg' | head -n1)"
  fi

  if [ -z "$found" ]; then
    echo "Couldn't find an ffmpeg binary inside the downloaded archive." >&2
    exit 1
  fi
  cp "$found" "$ffmpeg_dest"
  chmod +x "$ffmpeg_dest"
  echo "Saved to $ffmpeg_dest"
fi
