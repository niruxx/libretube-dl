//! Downloads and installs yt-dlp/ffmpeg directly into the app's install directory when the
//! bundled sidecars are missing (a corrupted install, or a platform without bundled binaries
//! yet) — the "click to install" action behind the dependency status dot in the titlebar.

use serde::Serialize;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::downloader::{binary_name, install_dir};

#[derive(Serialize, Clone)]
struct InstallProgress {
    name: String,
    downloaded: u64,
    total: Option<u64>,
}

fn emit_progress(app: &AppHandle, name: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            name: name.to_string(),
            downloaded,
            total,
        },
    );
}

/// Streams `url` to `dest`, emitting `install-progress` events as it goes.
fn download_with_progress(app: &AppHandle, url: &str, dest: &Path, name: &str) -> Result<(), String> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;
    let total: Option<u64> = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok());
    let mut reader = resp.into_reader();
    let mut file = File::create(dest).map_err(|e| format!("Couldn't create {}: {e}", dest.display()))?;

    let mut buf = [0u8; 65536];
    let mut downloaded: u64 = 0;
    emit_progress(app, name, 0, total);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download failed: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        emit_progress(app, name, downloaded, total);
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Extracts the first zip entry whose name ends with `entry_suffix` (case-insensitive) to
/// `dest`. Used for the ffmpeg archives, which bury the binary a few folders deep.
fn extract_from_zip(zip_path: &Path, entry_suffix: &str, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid archive: {e}"))?;
    let suffix_lower = entry_suffix.to_lowercase();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().to_lowercase().ends_with(&suffix_lower) {
            let mut out = File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("Couldn't find {entry_suffix} inside the downloaded archive."))
}

/// Extracts the first regular file named `file_name` found (searched recursively, since
/// tarballs like the ffmpeg one nest the binary inside a version-named folder) into `dest`.
fn find_and_extract_from_dir(search_root: &Path, file_name: &str, dest: &Path) -> Result<(), String> {
    fn walk(dir: &Path, file_name: &str) -> Option<PathBuf> {
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = walk(&path, file_name) {
                    return Some(found);
                }
            } else if path.file_name().and_then(|n| n.to_str()) == Some(file_name) {
                return Some(path);
            }
        }
        None
    }

    let found = walk(search_root, file_name)
        .ok_or_else(|| format!("Couldn't find {file_name} inside the downloaded archive."))?;
    std::fs::rename(&found, dest)
        .or_else(|_| std::fs::copy(&found, dest).map(|_| ()))
        .map_err(|e| e.to_string())
}

fn ytdlp_download_url() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    }
}

fn install_ytdlp(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let dest = dir.join(binary_name("yt-dlp"));
    download_with_progress(app, ytdlp_download_url(), &dest, "yt-dlp")?;
    make_executable(&dest)?;
    Ok(())
}

fn install_ffmpeg(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let dest = dir.join(binary_name("ffmpeg"));
    let tmp_dir = std::env::temp_dir();

    if cfg!(target_os = "windows") {
        let archive = tmp_dir.join("clipvault_ffmpeg_download.zip");
        download_with_progress(
            app,
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
            &archive,
            "ffmpeg",
        )?;
        let result = extract_from_zip(&archive, "bin/ffmpeg.exe", &dest);
        let _ = std::fs::remove_file(&archive);
        result
    } else if cfg!(target_os = "macos") {
        let archive = tmp_dir.join("clipvault_ffmpeg_download.zip");
        download_with_progress(app, "https://evermeet.cx/ffmpeg/getrelease/zip", &archive, "ffmpeg")?;
        let result = extract_from_zip(&archive, "ffmpeg", &dest).map(|_| make_executable(&dest));
        let _ = std::fs::remove_file(&archive);
        result?
    } else {
        let archive = tmp_dir.join("clipvault_ffmpeg_download.tar.xz");
        download_with_progress(
            app,
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
            &archive,
            "ffmpeg",
        )?;
        let extract_dir = tmp_dir.join("clipvault_ffmpeg_extract");
        let _ = std::fs::remove_dir_all(&extract_dir);
        std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
        let status = std::process::Command::new("tar")
            .args(["-xJf"])
            .arg(&archive)
            .arg("-C")
            .arg(&extract_dir)
            .status()
            .map_err(|e| format!("Couldn't run tar: {e}"))?;
        let result = if status.success() {
            find_and_extract_from_dir(&extract_dir, "ffmpeg", &dest).map(|_| make_executable(&dest))?
        } else {
            Err("Extracting the ffmpeg archive failed.".to_string())
        };
        let _ = std::fs::remove_file(&archive);
        let _ = std::fs::remove_dir_all(&extract_dir);
        result
    }
}

#[tauri::command]
pub async fn install_dependency(app: AppHandle, name: String) -> Result<(), String> {
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = install_dir()?;
        match name.as_str() {
            "yt-dlp" => install_ytdlp(&app_for_task, &dir),
            "ffmpeg" => install_ffmpeg(&app_for_task, &dir),
            other => Err(format!("Unknown dependency: {other}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
