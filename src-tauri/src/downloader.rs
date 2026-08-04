use command_group::{CommandGroup, GroupChild};
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const FINALPATH_PREFIX: &str = "LTDL_FINALPATH|";
const PROGRESS_PREFIX: &str = "LTDL_PROGRESS|";

#[derive(Default)]
pub struct DownloadState(Mutex<Option<GroupChild>>);

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

pub(crate) fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// The directory the "install missing dependency" flow saves binaries into: right next to
/// the running executable, the first place `find_binary` looks.
pub(crate) fn install_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not determine the app's install directory.".to_string())
}

/// Looks for `name` on PATH, then next to the running executable / current directory
/// (and a `bin/` subfolder of each) so a binary can simply be dropped alongside the app.
fn find_binary(name: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(name) {
        return Some(path);
    }
    let file_name = binary_name(name);
    let mut candidate_dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
            candidate_dirs.push(parent.join("bin"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.clone());
        candidate_dirs.push(cwd.join("bin"));
    }
    candidate_dirs
        .into_iter()
        .map(|dir| dir.join(&file_name))
        .find(|candidate| candidate.is_file())
}

fn find_ytdlp() -> Option<PathBuf> {
    find_binary("yt-dlp")
}

fn find_ffmpeg() -> Option<PathBuf> {
    find_binary("ffmpeg")
}

#[derive(Serialize)]
pub struct BinaryStatus {
    ytdlp: bool,
    ffmpeg: bool,
}

#[tauri::command]
pub fn check_binaries() -> BinaryStatus {
    BinaryStatus {
        ytdlp: find_ytdlp().is_some(),
        ffmpeg: find_ffmpeg().is_some(),
    }
}

#[tauri::command]
pub fn default_download_dir() -> String {
    let dir = dirs::download_dir()
        .filter(|p| p.is_dir())
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.to_string_lossy().to_string()
}

#[derive(Serialize)]
pub struct VideoInfo {
    title: String,
    uploader: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
    webpage_url: String,
}

#[tauri::command]
pub async fn fetch_info(url: String) -> Result<VideoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ytdlp = find_ytdlp().ok_or_else(|| {
            "yt-dlp was not found. Install it (winget/brew/apt) or place a yt-dlp binary next to the app.".to_string()
        })?;

        let mut cmd = Command::new(ytdlp);
        cmd.args(["-j", "--no-warnings", "--skip-download", &url]);
        hide_console(&mut cmd);
        let output = cmd.output().map_err(|e| e.to_string())?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(clean_error(&stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let first_line = stdout
            .lines()
            .next()
            .ok_or_else(|| "yt-dlp returned no data for that URL.".to_string())?;
        let data: serde_json::Value =
            serde_json::from_str(first_line).map_err(|e| format!("Couldn't parse video info: {e}"))?;

        // Playlists dump the first entry's data under "entries".
        let data = data
            .get("entries")
            .and_then(|e| e.as_array())
            .and_then(|arr| arr.first())
            .cloned()
            .unwrap_or(data);

        Ok(VideoInfo {
            title: data
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown title")
                .to_string(),
            uploader: data
                .get("uploader")
                .or_else(|| data.get("channel"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown uploader")
                .to_string(),
            duration: data.get("duration").and_then(|v| v.as_f64()),
            thumbnail: data
                .get("thumbnail")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            webpage_url: data
                .get("webpage_url")
                .and_then(|v| v.as_str())
                .unwrap_or(&url)
                .to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn format_selector(quality: &str) -> &'static str {
    match quality {
        "1080p" => "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "720p" => "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "480p" => "bestvideo[height<=480]+bestaudio/best[height<=480]",
        "Audio only (MP3)" => "bestaudio/best",
        _ => "bestvideo+bestaudio/best",
    }
}

fn clean_error(stderr: &str) -> String {
    let last_error_line = stderr
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with("ERROR:"))
        .or_else(|| stderr.lines().last());
    last_error_line
        .unwrap_or("The download failed for an unknown reason.")
        .trim()
        .trim_start_matches("ERROR:")
        .trim()
        .to_string()
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed: Option<f64>,
    eta: Option<u64>,
}

fn parse_num<T: std::str::FromStr>(s: &str) -> Option<T> {
    let s = s.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("na") || s == "None" {
        None
    } else {
        s.parse::<T>().ok()
    }
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    url: String,
    quality: String,
    output_dir: String,
) -> Result<String, String> {
    let ytdlp = find_ytdlp().ok_or_else(|| {
        "yt-dlp was not found. Install it (winget/brew/apt) or place a yt-dlp binary next to the app.".to_string()
    })?;
    let ffmpeg = find_ffmpeg();
    let extract_audio = quality == "Audio only (MP3)";

    let mut cmd = Command::new(ytdlp);
    cmd.args([
        &url,
        "-f",
        format_selector(&quality),
        "-o",
    ])
    .arg(format!("{output_dir}/%(title)s.%(ext)s"))
    .args([
        "--newline",
        "--progress",
        "--no-warnings",
        "--progress-template",
    ])
    .arg(format!(
        "download:{PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
    ))
    .arg("--print")
    .arg(format!("after_move:{FINALPATH_PREFIX}%(filepath)s"));

    if let Some(ffmpeg_path) = &ffmpeg {
        cmd.arg("--ffmpeg-location").arg(ffmpeg_path);
        if extract_audio {
            cmd.args(["--extract-audio", "--audio-format", "mp3", "--audio-quality", "192"]);
        } else {
            cmd.args(["--merge-output-format", "mp4"]);
        }
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_console(&mut cmd);

    let app_for_thread = app.clone();
    let app_for_state = app.clone();
    let final_path: std::sync::Arc<Mutex<Option<String>>> = std::sync::Arc::new(Mutex::new(None));
    let final_path_reader = final_path.clone();
    let stderr_lines: std::sync::Arc<Mutex<Vec<String>>> = std::sync::Arc::new(Mutex::new(Vec::new()));
    let stderr_reader = stderr_lines.clone();

    let wait_result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let download_state = app_for_state.state::<DownloadState>();
        let mut child = cmd.group_spawn().map_err(|e| e.to_string())?;
        let inner = child.inner();
        let stdout = inner.stdout.take();
        let stderr = inner.stderr.take();

        if let Some(stdout) = stdout {
            let app = app_for_thread.clone();
            std::thread::spawn(move || {
                let mut seen_progress = false;
                let mut announced_processing = false;
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(rest) = line.strip_prefix(PROGRESS_PREFIX) {
                        seen_progress = true;
                        let parts: Vec<&str> = rest.split('|').collect();
                        if parts.len() == 5 {
                            let downloaded: u64 = parse_num(parts[0]).unwrap_or(0);
                            let total: Option<u64> =
                                parse_num(parts[1]).or_else(|| parse_num(parts[2]));
                            let speed: Option<f64> = parse_num(parts[3]);
                            let eta: Option<u64> = parse_num(parts[4]);
                            let _ = app.emit(
                                "download-progress",
                                ProgressPayload {
                                    downloaded_bytes: downloaded,
                                    total_bytes: total,
                                    speed,
                                    eta,
                                },
                            );
                        }
                    } else if let Some(path) = line.strip_prefix(FINALPATH_PREFIX) {
                        *final_path_reader.lock().unwrap() = Some(path.to_string());
                    } else if seen_progress && !announced_processing && !line.trim().is_empty() {
                        announced_processing = true;
                        let _ = app.emit("download-status", "Processing...");
                    }
                }
            });
        }

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    let mut guard = stderr_reader.lock().unwrap();
                    guard.push(line);
                    if guard.len() > 50 {
                        guard.remove(0);
                    }
                }
            });
        }

        *download_state.0.lock().unwrap() = Some(child);

        let status = loop {
            std::thread::sleep(Duration::from_millis(150));
            let mut guard = download_state.0.lock().unwrap();
            match guard.as_mut() {
                None => break None,
                Some(c) => match c.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => continue,
                    Err(_) => break None,
                },
            }
        };
        *download_state.0.lock().unwrap() = None;

        match status {
            None => Err("__CANCELLED__".to_string()),
            Some(status) if status.success() => Ok(()),
            Some(_) => Err("__FAILED__".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // Give the reader threads a brief moment to flush their final lines.
    std::thread::sleep(Duration::from_millis(50));

    match wait_result {
        Ok(()) => final_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Download finished but the final file path was not reported.".to_string()),
        Err(marker) if marker == "__CANCELLED__" => Err("__CANCELLED__".to_string()),
        Err(_) => {
            let stderr_text = stderr_lines.lock().unwrap().join("\n");
            Err(clean_error(&stderr_text))
        }
    }
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        let _ = child.kill();
    }
    *guard = None;
    Ok(())
}

/// Force-terminates the app. Window.close() can leave a frameless (decorations: false)
/// window and its process stuck in a half-destroyed state on Windows instead of actually
/// exiting, so the frontend calls this after its own fade-out animation instead of relying
/// on the window-close pathway. Kills any in-progress download's process group first so
/// yt-dlp/ffmpeg aren't left running orphaned.
#[tauri::command]
pub fn quit_app(app: AppHandle, state: State<'_, DownloadState>) {
    if let Some(child) = state.0.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
    app.exit(0);
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, current: Option<String>) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file();
    if let Some(dir) = &current {
        builder = builder.set_directory(dir);
    }
    builder.pick_folder(move |result| {
        let _ = tx.send(result);
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
        .map(|p| p.to_string())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}
