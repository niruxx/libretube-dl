mod downloader;
mod installer;

use downloader::DownloadState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            downloader::check_binaries,
            downloader::default_download_dir,
            downloader::fetch_info,
            downloader::start_download,
            downloader::cancel_download,
            downloader::pick_folder,
            downloader::reveal_in_folder,
            downloader::quit_app,
            installer::install_dependency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
