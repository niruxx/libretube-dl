import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

interface VideoInfo {
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
}

interface ProgressPayload {
  downloaded_bytes: number;
  total_bytes: number | null;
  speed: number | null;
  eta: number | null;
}

interface BinaryStatus {
  ytdlp: boolean;
  ffmpeg: boolean;
}

interface InstallProgress {
  name: string;
  downloaded: number;
  total: number | null;
}

type DependencyKey = "yt-dlp" | "ffmpeg";

const appWindow = getCurrentWindow();

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
};

const appEl = el<HTMLDivElement>("app");
const btnMinimize = el<HTMLButtonElement>("btn-minimize");
const btnClose = el<HTMLButtonElement>("btn-close");
const depStatusDot = el<HTMLButtonElement>("dep-status-dot");
const depStatusIndicator = el<HTMLSpanElement>("dep-status-indicator");
const depPanel = el<HTMLDivElement>("dep-panel");
const urlInput = el<HTMLInputElement>("url-input");
const btnFetch = el<HTMLButtonElement>("btn-fetch");
const previewPlaceholder = el<HTMLSpanElement>("preview-placeholder");
const previewThumb = el<HTMLImageElement>("preview-thumb");
const previewTitle = el<HTMLParagraphElement>("preview-title");
const previewMeta = el<HTMLParagraphElement>("preview-meta");
const qualityPicker = el<HTMLDivElement>("quality-picker");
const folderPath = el<HTMLParagraphElement>("folder-path");
const btnChangeFolder = el<HTMLButtonElement>("btn-change-folder");
const btnDownload = el<HTMLButtonElement>("btn-download");
const progressFill = el<HTMLDivElement>("progress-fill");
const statusText = el<HTMLParagraphElement>("status-text");
const btnCancel = el<HTMLButtonElement>("btn-cancel");
const scrollArea = document.querySelector<HTMLDivElement>(".scroll-area")!;

let currentVideoInfo: VideoInfo | null = null;
let selectedQuality = "Best available";
let outputDir = "";
let isClosing = false;
// Progress/status events can arrive after cancellation already resolved (the Rust reader
// thread may have queued one before the kill took effect); ignore them once we're not
// actively downloading so a late event can't clobber the final status text.
let isDownloading = false;

let depStatus: BinaryStatus = { ytdlp: false, ffmpeg: false };
let installingDep: DependencyKey | null = null;
let installError: { dep: DependencyKey; message: string } | null = null;
let lastInstallProgress: InstallProgress | null = null;

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return "?";
  let n = bytes;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function humanDuration(seconds: number | null): string {
  if (!seconds) return "?";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(h > 0 ? 2 : 1, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function setStatus(text: string, warning = false) {
  statusText.textContent = text;
  statusText.classList.toggle("text-warning", warning);
  statusText.classList.toggle("text-muted", !warning);
}

const DEP_DOWNLOAD_URLS: Record<DependencyKey, string> = {
  "yt-dlp": "https://github.com/yt-dlp/yt-dlp/releases/latest",
  ffmpeg: "https://ffmpeg.org/download.html",
};

const DOT_COLOR_CLASSES = ["bg-muted", "bg-success", "bg-warning", "bg-danger"];

function setDotColor(cls: string) {
  depStatusIndicator.classList.remove(...DOT_COLOR_CLASSES);
  depStatusIndicator.classList.add(cls);
}

function updateDependencyUi() {
  const foundCount = Number(depStatus.ytdlp) + Number(depStatus.ffmpeg);
  if (foundCount === 2) {
    setDotColor("bg-success");
    depStatusDot.title = "yt-dlp and ffmpeg are both installed.";
  } else if (foundCount === 1) {
    setDotColor("bg-warning");
    depStatusDot.title = "One dependency is missing — click for details.";
  } else {
    setDotColor("bg-danger");
    depStatusDot.title = "yt-dlp and ffmpeg are both missing — click to install.";
  }

  btnFetch.disabled = !depStatus.ytdlp;
  urlInput.disabled = !depStatus.ytdlp;

  renderDepPanel();
}

function depRowHtml(dep: DependencyKey, found: boolean): string {
  const label = dep === "yt-dlp" ? "yt-dlp" : "ffmpeg";
  const note = dep === "yt-dlp" ? "required to fetch and download videos" : "needed for quality merges and MP3";

  if (found) {
    return `
      <div class="flex items-center justify-between py-1.5">
        <div>
          <p class="font-bold text-white">${label}</p>
          <p class="text-muted">Installed</p>
        </div>
        <span class="h-2 w-2 rounded-full bg-success"></span>
      </div>`;
  }

  if (installingDep === dep) {
    const p = lastInstallProgress;
    const pct = p && p.total ? Math.round((p.downloaded / p.total) * 100) : null;
    const progressText =
      p != null ? `${humanSize(p.downloaded)}${p.total ? ` / ${humanSize(p.total)}` : ""}` : "Starting...";
    return `
      <div class="py-1.5">
        <div class="flex items-center justify-between">
          <p class="font-bold text-white">${label}</p>
          <p class="text-muted">${pct != null ? `${pct}%` : ""}</p>
        </div>
        <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-background">
          <div class="h-full rounded-full bg-accent transition-width duration-150" style="width:${pct ?? 0}%"></div>
        </div>
        <p class="mt-1 text-muted">Installing — ${progressText}</p>
      </div>`;
  }

  const errorHtml =
    installError && installError.dep === dep
      ? `<p class="mt-1 text-warning">${installError.message} <button data-manual-download="${dep}" class="underline hover:text-white">Download manually</button> instead.</p>`
      : "";
  return `
    <div class="py-1.5">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="font-bold text-white">${label}</p>
          <p class="text-muted">Not found — ${note}</p>
        </div>
        <button
          data-install="${dep}"
          class="shrink-0 rounded-full bg-accent px-3 py-1 font-bold text-white hover:bg-accent-hover"
        >Install</button>
      </div>
      ${errorHtml}
    </div>`;
}

function renderDepPanel() {
  depPanel.innerHTML = `
    <p class="mb-1 font-bold text-white">Dependencies</p>
    <div class="divide-y divide-background">
      ${depRowHtml("yt-dlp", depStatus.ytdlp)}
      ${depRowHtml("ffmpeg", depStatus.ffmpeg)}
    </div>
  `;
}

async function refreshDependencyStatus() {
  try {
    depStatus = await invoke<BinaryStatus>("check_binaries");
  } catch {
    depStatus = { ytdlp: false, ffmpeg: false };
  }
  updateDependencyUi();
}

async function installDependency(dep: DependencyKey) {
  if (installingDep) return;
  installingDep = dep;
  installError = null;
  lastInstallProgress = null;
  renderDepPanel();
  try {
    await invoke("install_dependency", { name: dep });
    installingDep = null;
    await refreshDependencyStatus();
  } catch (err) {
    installingDep = null;
    installError = { dep, message: String(err) };
    updateDependencyUi();
  }
}

function setBusy(busy: boolean) {
  btnFetch.disabled = busy || !depStatus.ytdlp;
  urlInput.disabled = busy || !depStatus.ytdlp;
  qualityPicker.querySelectorAll("button").forEach((b) => {
    (b as HTMLButtonElement).disabled = busy;
  });
  btnDownload.disabled = busy || !currentVideoInfo;
  btnCancel.disabled = !busy;
}

function scrollContentTo(where: "top" | "bottom") {
  scrollArea.scrollTo({
    top: where === "top" ? 0 : scrollArea.scrollHeight,
    behavior: "smooth",
  });
}

function highlightSelectedQuality() {
  qualityPicker.querySelectorAll<HTMLButtonElement>(".quality-btn").forEach((btn) => {
    const active = btn.dataset.quality === selectedQuality;
    btn.classList.toggle("bg-accent", active);
    btn.classList.toggle("hover:bg-button-hover", !active);
  });
}

async function fadeOutAndClose() {
  if (isClosing) return;
  isClosing = true;
  appEl.classList.remove("is-visible");
  await new Promise((resolve) => setTimeout(resolve, 220));
  // Window.close() can leave a frameless window (and its process) stuck in a
  // half-destroyed, unresponsive state on Windows instead of actually exiting.
  // Force-terminating from the Rust side is the reliable path.
  try {
    await invoke("quit_app");
  } catch {
    // last-resort fallback if the command itself couldn't be reached
    await appWindow.close();
  }
}

async function init() {
  btnMinimize.addEventListener("click", () => appWindow.minimize());
  btnClose.addEventListener("click", fadeOutAndClose);
  await appWindow.onCloseRequested(async (event) => {
    if (isClosing) return;
    event.preventDefault();
    await fadeOutAndClose();
  });

  qualityPicker.querySelectorAll<HTMLButtonElement>(".quality-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedQuality = btn.dataset.quality ?? "Best available";
      highlightSelectedQuality();
    });
  });
  highlightSelectedQuality();

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchInfo();
  });
  btnFetch.addEventListener("click", fetchInfo);
  btnDownload.addEventListener("click", startDownload);
  btnCancel.addEventListener("click", cancelDownload);
  btnChangeFolder.addEventListener("click", changeFolder);

  await listen<ProgressPayload>("download-progress", (event) => {
    if (!isDownloading) return;
    const { downloaded_bytes, total_bytes, speed, eta } = event.payload;
    const fraction = total_bytes ? downloaded_bytes / total_bytes : 0;
    progressFill.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    const speedText = speed != null ? `${humanSize(speed)}/s` : "?";
    const etaText = eta != null ? `${eta}s` : "?";
    setStatus(
      `Downloading ${humanSize(downloaded_bytes)} / ${humanSize(total_bytes)}  ·  ${speedText}  ·  ETA ${etaText}`,
    );
  });

  await listen<string>("download-status", (event) => {
    if (!isDownloading) return;
    progressFill.style.width = "100%";
    setStatus(event.payload);
  });

  await listen<InstallProgress>("install-progress", (event) => {
    if (installingDep == null || event.payload.name !== installingDep) return;
    lastInstallProgress = event.payload;
    renderDepPanel();
  });

  depStatusDot.addEventListener("click", (e) => {
    e.stopPropagation();
    depPanel.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (depPanel.classList.contains("hidden")) return;
    if (e.target instanceof Node && (depPanel.contains(e.target) || depStatusDot.contains(e.target))) return;
    depPanel.classList.add("hidden");
  });
  depPanel.addEventListener("click", (e) => {
    // Installing re-renders the panel's innerHTML synchronously, which would detach
    // e.target mid-bubble; stop here so the document-level outside-click handler
    // (which checks `depPanel.contains(e.target)`) never sees that detached node.
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const installBtn = target.closest<HTMLElement>("[data-install]");
    if (installBtn) {
      installDependency(installBtn.dataset.install as DependencyKey);
      return;
    }
    const manualBtn = target.closest<HTMLElement>("[data-manual-download]");
    if (manualBtn) {
      const dep = manualBtn.dataset.manualDownload as DependencyKey;
      openUrl(DEP_DOWNLOAD_URLS[dep]).catch(() => {});
    }
  });

  try {
    outputDir = await invoke<string>("default_download_dir");
    folderPath.textContent = outputDir;
  } catch {
    folderPath.textContent = "(default)";
  }

  await refreshDependencyStatus();

  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.add("is-visible")));
}

async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    setStatus("Enter a URL first.", true);
    return;
  }
  setBusy(true);
  setStatus("Fetching video info...");
  try {
    const info = await invoke<VideoInfo>("fetch_info", { url });
    onFetchSuccess(info);
  } catch (err) {
    onFetchError(err);
  }
}

function onFetchSuccess(info: VideoInfo) {
  currentVideoInfo = info;
  setBusy(false);
  previewTitle.textContent = info.title;
  previewMeta.textContent = `${info.uploader} · ${humanDuration(info.duration)}`;
  setStatus("Ready to download.");
  btnDownload.disabled = false;
  scrollContentTo("top");

  previewThumb.classList.add("hidden");
  previewPlaceholder.classList.remove("hidden");
  if (info.thumbnail) {
    previewThumb.onload = () => {
      previewPlaceholder.classList.add("hidden");
      previewThumb.classList.remove("hidden");
      previewThumb.classList.add("thumb-fade-in");
    };
    previewThumb.onerror = () => {
      previewThumb.classList.add("hidden");
    };
    previewThumb.src = info.thumbnail;
  } else {
    previewThumb.removeAttribute("src");
  }
}

function onFetchError(err: unknown) {
  setBusy(false);
  setStatus(`Couldn't fetch that URL: ${String(err)}`, true);
}

async function startDownload() {
  if (!currentVideoInfo) return;
  isDownloading = true;
  setBusy(true);
  progressFill.style.width = "0%";
  setStatus("Starting download...");
  scrollContentTo("bottom");

  try {
    const finalPath = await invoke<string>("start_download", {
      url: currentVideoInfo.webpage_url,
      quality: selectedQuality,
      outputDir: outputDir,
    });
    onDownloadSuccess(finalPath);
  } catch (err) {
    if (err === "__CANCELLED__") {
      onDownloadCancelled();
    } else {
      onDownloadError(err);
    }
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function onDownloadSuccess(path: string) {
  isDownloading = false;
  setBusy(false);
  progressFill.style.width = "100%";
  statusText.textContent = "";
  statusText.classList.remove("text-warning");
  statusText.classList.add("text-muted");

  const doneSpan = document.createElement("span");
  doneSpan.textContent = `Done: ${basename(path)}  ·  `;
  const openLink = document.createElement("button");
  openLink.textContent = "Open folder";
  openLink.className = "text-accent hover:underline";
  openLink.addEventListener("click", () => {
    invoke("reveal_in_folder", { path }).catch(() => {});
  });
  statusText.append(doneSpan, openLink);
}

function onDownloadCancelled() {
  isDownloading = false;
  setBusy(false);
  progressFill.style.width = "0%";
  setStatus("Download cancelled.");
}

function onDownloadError(err: unknown) {
  isDownloading = false;
  setBusy(false);
  progressFill.style.width = "0%";
  setStatus(`Download failed: ${String(err)}`, true);
}

async function cancelDownload() {
  setStatus("Cancelling...");
  try {
    await invoke("cancel_download");
  } catch {
    // best effort
  }
}

async function changeFolder() {
  try {
    const picked = await invoke<string | null>("pick_folder", { current: outputDir });
    if (picked) {
      outputDir = picked;
      folderPath.textContent = outputDir;
    }
  } catch {
    // user cancelled or dialog failed; leave folder unchanged
  }
}

init();
