<#
.SYNOPSIS
  Downloads the yt-dlp sidecar binary that gets bundled into the app/installer via
  Tauri's `bundle.externalBin`, and checks for the ffmpeg sidecar.

.DESCRIPTION
  Run this once before `npm run tauri build` (or `npm start`) so the app ships with
  yt-dlp and ffmpeg built in — no separate install required on the end user's machine.
  Binaries are gitignored (large, platform-specific) so every dev/CI machine fetches
  its own copy via this script rather than committing them to source control.

  yt-dlp is fetched automatically from its official GitHub releases. ffmpeg has no
  single official direct-download URL (distributed via ffmpeg.org's per-platform
  builds/mirrors), so this script just checks for it and tells you where to put it
  if it's missing.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$hostTriple = (rustc -vV | Select-String "^host:").ToString().Split(" ")[1]
Write-Host "Target triple: $hostTriple"

$ytdlpDest = Join-Path $binDir "yt-dlp-$hostTriple.exe"
if (Test-Path $ytdlpDest) {
    Write-Host "yt-dlp sidecar already present at $ytdlpDest"
} else {
    Write-Host "Downloading yt-dlp..."
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlpDest
    Write-Host "Saved to $ytdlpDest"
}

$ffmpegDest = Join-Path $binDir "ffmpeg-$hostTriple.exe"
if (Test-Path $ffmpegDest) {
    Write-Host "ffmpeg sidecar already present at $ffmpegDest"
} else {
    Write-Host ""
    Write-Host "ffmpeg sidecar not found. Download a Windows build from https://ffmpeg.org/download.html"
    Write-Host "(or https://www.gyan.dev/ffmpeg/builds/ for prebuilt Windows binaries) and save it as:"
    Write-Host "  $ffmpegDest"
    Write-Host ""
    Write-Host "The app still builds and runs without it — ffmpeg just won't be bundled, and the"
    Write-Host "app will fall back to checking PATH / next to the installed app at runtime."
}
