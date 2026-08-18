import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { attachRippleAll } from "./ripple";

interface VideoInfo {
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
}

type QueueItemStatus = "fetching" | "pending" | "downloading" | "done" | "error" | "cancelled";

interface QueueItem {
  id: number;
  url: string;
  status: QueueItemStatus;
  info: VideoInfo | null;
  error: string | null;
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
const btnThemeToggle = el<HTMLButtonElement>("theme-toggle");
const themeToggleIcon = el<HTMLSpanElement>("theme-toggle-icon");
const btnMinimize = el<HTMLButtonElement>("btn-minimize");
const btnClose = el<HTMLButtonElement>("btn-close");
const depStatusDot = el<HTMLButtonElement>("dep-status-dot");
const depStatusIndicator = el<HTMLSpanElement>("dep-status-indicator");
const depPanel = el<HTMLDivElement>("dep-panel");
const btnSettings = el<HTMLButtonElement>("btn-settings");
const mainView = el<HTMLDivElement>("main-view");
const settingsView = el<HTMLDivElement>("settings-view");
const btnSettingsBack = el<HTMLButtonElement>("btn-settings-back");
const settingsFolderPath = el<HTMLParagraphElement>("settings-folder-path");
const btnSettingsChangeFolder = el<HTMLButtonElement>("btn-settings-change-folder");
const btnSettingsResetFolder = el<HTMLButtonElement>("btn-settings-reset-folder");
const urlInput = el<HTMLInputElement>("url-input");
const btnAdd = el<HTMLButtonElement>("btn-add");
const queueSection = el<HTMLDivElement>("queue-section");
const queueCount = el<HTMLParagraphElement>("queue-count");
const queueList = el<HTMLDivElement>("queue-list");
const btnClearQueue = el<HTMLButtonElement>("btn-clear-queue");
const qualityPicker = el<HTMLDivElement>("quality-picker");
const folderPath = el<HTMLParagraphElement>("folder-path");
const btnChangeFolder = el<HTMLButtonElement>("btn-change-folder");
const btnDownload = el<HTMLButtonElement>("btn-download");
const btnDownloadLabel = el<HTMLSpanElement>("btn-download-label");
const progressFill = el<HTMLDivElement>("progress-fill");
const statusText = el<HTMLParagraphElement>("status-text");
const btnCancel = el<HTMLButtonElement>("btn-cancel");
const scrollArea = document.querySelector<HTMLDivElement>(".scroll-area")!;

let queue: QueueItem[] = [];
let queueIdCounter = 0;
// Tracks in-flight fetch_info calls per queue item, so processQueue can await one that
// was still resolving when the batch download started instead of skipping the item.
const fetchPromises = new Map<number, Promise<void>>();
let isProcessingQueue = false;
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

// Queue row markup is built as innerHTML strings; video titles and error messages come
// from the remote site / yt-dlp output, so they must be escaped before interpolation.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(text: string, warning = false) {
  statusText.textContent = text;
  statusText.classList.toggle("text-warning", warning);
  statusText.classList.toggle("text-muted", !warning);
}

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "theme";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Show the icon for the theme a click would switch *to*.
  themeToggleIcon.textContent = theme === "dark" ? "☀" : "☾";
  btnThemeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const theme: Theme =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  applyTheme(theme);

  btnThemeToggle.addEventListener("click", () => {
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  });

  // Follow the OS theme live, but only until the user picks one explicitly.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (localStorage.getItem(THEME_STORAGE_KEY) != null) return;
    applyTheme(e.matches ? "dark" : "light");
  });
}

type View = "main" | "settings";

const VIEW_TRANSITION_MS = 160;

function setViewOffset(view: HTMLElement, opacity: number, offsetPx: number) {
  view.style.opacity = String(opacity);
  view.style.transform = offsetPx === 0 ? "" : `translateX(${offsetPx}px)`;
}

// Settings slides in from the right / back out to the right (a standard "forward"
// navigation direction); returning to the main view mirrors that from the left.
function showView(view: View) {
  const showMain = view === "main";
  const enter = showMain ? mainView : settingsView;
  const leave = showMain ? settingsView : mainView;

  if (leave.classList.contains("hidden")) {
    // Already on the target view (the initial call from init()) — set final state, no animation.
    enter.classList.remove("hidden");
    enter.classList.add("flex");
    setViewOffset(enter, 1, 0);
    return;
  }

  const exitOffsetPx = showMain ? 16 : -16;
  const enterFromOffsetPx = showMain ? -16 : 16;

  setViewOffset(leave, 0, exitOffsetPx);

  window.setTimeout(() => {
    leave.classList.add("hidden");
    leave.classList.remove("flex");
    setViewOffset(leave, 1, 0);

    enter.classList.remove("hidden");
    enter.classList.add("flex");
    enter.style.transition = "none";
    setViewOffset(enter, 0, enterFromOffsetPx);
    void enter.offsetWidth; // force a reflow so the transition below actually plays
    enter.style.transition = "";
    requestAnimationFrame(() => setViewOffset(enter, 1, 0));

    if (!showMain) scrollContentTo("top");
  }, VIEW_TRANSITION_MS);
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

  btnAdd.disabled = !depStatus.ytdlp;
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
          <p class="font-medium text-ink">${label}</p>
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
          <p class="font-medium text-ink">${label}</p>
          <p class="text-muted">${pct != null ? `${pct}%` : ""}</p>
        </div>
        <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-variant">
          <div class="h-full rounded-full bg-primary transition-width duration-150" style="width:${pct ?? 0}%"></div>
        </div>
        <p class="mt-1 text-muted">Installing — ${progressText}</p>
      </div>`;
  }

  const errorHtml =
    installError && installError.dep === dep
      ? `<p class="mt-1 text-danger">${installError.message} <button data-manual-download="${dep}" class="underline hover:text-primary">Download manually</button> instead.</p>`
      : "";
  return `
    <div class="py-1.5">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="font-medium text-ink">${label}</p>
          <p class="text-muted">Not found — ${note}</p>
        </div>
        <button
          data-install="${dep}"
          class="ripple-host shrink-0 rounded-full bg-primary px-3 py-1 font-medium text-white hover:bg-primary-hover"
        >Install</button>
      </div>
      ${errorHtml}
    </div>`;
}

function renderDepPanel() {
  depPanel.innerHTML = `
    <p class="mb-1 font-medium text-ink">Dependencies</p>
    <div class="divide-y divide-outline">
      ${depRowHtml("yt-dlp", depStatus.ytdlp)}
      ${depRowHtml("ffmpeg", depStatus.ffmpeg)}
    </div>
  `;
  attachRippleAll(".ripple-host", depPanel);
}

// Opens with a quick scale + fade from the anchor (Material-menu style); closing is
// instant, matching the rest of the app's "animate in, snap closed" pattern.
function openDepPanel() {
  depPanel.classList.remove("hidden");
  depPanel.classList.add("panel-enter");
  void depPanel.offsetWidth; // force a reflow so removing panel-enter next animates
  requestAnimationFrame(() => depPanel.classList.remove("panel-enter"));
}

function closeDepPanel() {
  depPanel.classList.add("hidden");
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

// Unlike the old single-fetch flow, adding links to the queue stays available while a
// batch is downloading — pasting "link after link" is meant to work during downloads too.
function setQueueBusy(busy: boolean) {
  qualityPicker.querySelectorAll("button").forEach((b) => {
    (b as HTMLButtonElement).disabled = busy;
  });
  btnCancel.disabled = !busy;
  updateDownloadButtonState();
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
    btn.classList.toggle("bg-primary-container", active);
    btn.classList.toggle("border-transparent", active);
    btn.classList.toggle("text-on-primary-container", active);
    btn.classList.toggle("border-border", !active);
    btn.querySelector(".quality-check")?.classList.toggle("hidden", !active);
  });
}

function updateDownloadButtonState() {
  const downloadable = queue.filter((q) => q.status === "pending" || q.status === "fetching").length;
  btnDownloadLabel.textContent = downloadable > 1 ? `Download (${downloadable})` : "Download";
  btnDownload.disabled = isProcessingQueue || downloadable === 0 || !depStatus.ytdlp;
}

function queueItemTrailingHtml(item: QueueItem): string {
  switch (item.status) {
    case "fetching":
    case "downloading":
      return `<span class="spinner shrink-0" aria-hidden="true"></span>`;
    case "done":
      return `<span class="shrink-0 text-base font-bold text-success" aria-hidden="true">&#10003;</span>`;
    case "error":
      return `<span class="shrink-0 text-base font-bold text-danger" aria-hidden="true" title="${escapeHtml(item.error ?? "")}">&#33;</span>`;
    case "cancelled":
      return `<span class="shrink-0 text-11 text-muted">Cancelled</span>`;
    default:
      return `<button data-remove="${item.id}" class="ripple-host flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-button-hover hover:text-danger" aria-label="Remove from queue" title="Remove">&#10005;</button>`;
  }
}

function queueItemRowHtml(item: QueueItem): string {
  const title = escapeHtml(item.info?.title ?? item.url);
  const hasThumb = Boolean(item.info?.thumbnail);
  const thumbHtml = hasThumb
    ? `<img src="${escapeHtml(item.info!.thumbnail!)}" class="h-full w-full object-cover" alt="" onload="this.classList.add('thumb-fade-in')" />`
    : `<span class="text-sm font-bold text-white" aria-hidden="true">&#8595;</span>`;

  let subtitle: string;
  if (item.status === "fetching") {
    subtitle = "Fetching info...";
  } else if (item.status === "error") {
    subtitle = escapeHtml(item.error ?? "Couldn't fetch that link.");
  } else if (item.status === "cancelled") {
    subtitle = "Cancelled";
  } else if (item.info) {
    const kind = item.info.duration != null ? humanDuration(item.info.duration) : "Image";
    subtitle = `${escapeHtml(item.info.uploader)} · ${kind}`;
  } else {
    subtitle = "";
  }

  return `
    <div class="queue-row-enter flex items-center gap-3 rounded-2xl bg-surface-variant p-2" data-id="${item.id}">
      <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl ${hasThumb ? "bg-surface" : "bg-primary"}">
        ${thumbHtml}
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink">${title}</p>
        <p class="truncate text-11 ${item.status === "error" ? "text-danger" : "text-muted"}">${subtitle}</p>
      </div>
      ${queueItemTrailingHtml(item)}
    </div>`;
}

function renderQueue() {
  queueSection.classList.toggle("hidden", queue.length === 0);
  queueCount.textContent = `Queue (${queue.length})`;
  btnClearQueue.classList.toggle("hidden", !queue.some((q) => q.status !== "downloading"));
  queueList.innerHTML = queue.map(queueItemRowHtml).join("");
  queueList.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeQueueItem(Number(btn.dataset.remove)));
  });
  attachRippleAll(".ripple-host", queueList);
  updateDownloadButtonState();
}

function addToQueue() {
  const url = urlInput.value.trim();
  if (!url) return;
  const item: QueueItem = { id: ++queueIdCounter, url, status: "fetching", info: null, error: null };
  queue.push(item);
  urlInput.value = "";
  renderQueue();
  fetchPromises.set(item.id, fetchQueueItemInfo(item.id));
}

async function fetchQueueItemInfo(id: number): Promise<void> {
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  try {
    item.info = await invoke<VideoInfo>("fetch_info", { url: item.url });
    item.status = "pending";
  } catch (err) {
    item.status = "error";
    item.error = String(err);
  }
  renderQueue();
}

function removeQueueItem(id: number) {
  const item = queue.find((q) => q.id === id);
  if (!item || item.status === "downloading") return;
  queue = queue.filter((q) => q.id !== id);
  fetchPromises.delete(id);
  renderQueue();
}

function clearQueue() {
  queue = queue.filter((q) => q.status === "downloading");
  renderQueue();
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
  initTheme();
  showView("main");
  attachRippleAll(".ripple-host");

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
    if (e.key === "Enter") addToQueue();
  });
  btnAdd.addEventListener("click", addToQueue);
  btnDownload.addEventListener("click", processQueue);
  btnCancel.addEventListener("click", cancelDownload);
  btnChangeFolder.addEventListener("click", changeFolder);
  btnClearQueue.addEventListener("click", clearQueue);

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
    if (depPanel.classList.contains("hidden")) openDepPanel();
    else closeDepPanel();
  });
  document.addEventListener("click", (e) => {
    if (depPanel.classList.contains("hidden")) return;
    if (e.target instanceof Node && (depPanel.contains(e.target) || depStatusDot.contains(e.target))) return;
    closeDepPanel();
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

  const storedOutputDir = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY);
  if (storedOutputDir) {
    setOutputDir(storedOutputDir);
  } else {
    try {
      setOutputDir(await invoke<string>("default_download_dir"));
    } catch {
      folderPath.textContent = "(default)";
      settingsFolderPath.textContent = "(default)";
    }
  }

  btnSettings.addEventListener("click", () => showView("settings"));
  btnSettingsBack.addEventListener("click", () => showView("main"));
  btnSettingsChangeFolder.addEventListener("click", changeFolder);
  btnSettingsResetFolder.addEventListener("click", resetOutputDir);

  await refreshDependencyStatus();

  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.add("is-visible")));
}

function nextQueueItem(): QueueItem | undefined {
  return queue.find((q) => q.status === "pending" || q.status === "fetching");
}

// Drains the queue in order: waits out any still-running fetch_info, downloads the item,
// then moves to whatever is next-in-line — re-reading the live `queue` array each time
// (rather than a fixed snapshot) so links pasted in *while* a batch is already downloading
// still get picked up automatically instead of needing a second press of Download.
async function processQueue() {
  if (isProcessingQueue || !nextQueueItem()) return;

  isProcessingQueue = true;
  setQueueBusy(true);
  let completed = 0;
  let lastFinalPath: string | null = null;

  let item = nextQueueItem();
  while (item) {
    if (fetchPromises.has(item.id)) {
      await fetchPromises.get(item.id);
      fetchPromises.delete(item.id);
    }

    if (item.status === "pending" && item.info && queue.includes(item)) {
      completed++;
      isDownloading = true;
      item.status = "downloading";
      renderQueue();
      progressFill.style.width = "0%";
      setStatus(`Downloading item ${completed}: ${item.info.title}`);
      scrollContentTo("bottom");

      try {
        lastFinalPath = await invoke<string>("start_download", {
          url: item.info.webpage_url,
          quality: selectedQuality,
          outputDir,
        });
        item.status = "done";
        progressFill.style.width = "100%";
      } catch (err) {
        if (err === "__CANCELLED__") {
          item.status = "cancelled";
        } else {
          item.status = "error";
          item.error = String(err);
        }
      }
      isDownloading = false;
      renderQueue();
    }

    item = nextQueueItem();
  }

  isProcessingQueue = false;
  setQueueBusy(false);
  finishQueueBatch(lastFinalPath);
}

function finishQueueBatch(lastFinalPath: string | null) {
  const succeeded = queue.filter((q) => q.status === "done").length;
  const failed = queue.filter((q) => q.status === "error").length;

  if (succeeded === 0) {
    setStatus(failed > 0 ? "All downloads failed." : "Download cancelled.", failed > 0);
    return;
  }

  statusText.textContent = "";
  statusText.classList.toggle("text-warning", failed > 0);
  statusText.classList.toggle("text-muted", failed === 0);

  const summary = document.createElement("span");
  summary.textContent =
    failed > 0
      ? `Finished — ${succeeded} downloaded, ${failed} failed.  ·  `
      : `Finished — ${succeeded} downloaded.  ·  `;
  statusText.append(summary);

  if (lastFinalPath) {
    const openLink = document.createElement("button");
    openLink.textContent = "Open folder";
    openLink.className = "text-primary hover:underline";
    openLink.addEventListener("click", () => {
      invoke("reveal_in_folder", { path: lastFinalPath }).catch(() => {});
    });
    statusText.append(openLink);
  }
}

async function cancelDownload() {
  setStatus("Cancelling...");
  try {
    await invoke("cancel_download");
  } catch {
    // best effort
  }
}

const OUTPUT_DIR_STORAGE_KEY = "outputDir";

// The chosen folder is the default for every future download too, not just the current
// session — both the main "Save to" row and Settings' "Default download location" edit
// the same value, so it's kept in sync everywhere and persisted immediately on change.
function setOutputDir(dir: string) {
  outputDir = dir;
  folderPath.textContent = dir;
  settingsFolderPath.textContent = dir;
  localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, dir);
}

async function changeFolder() {
  try {
    const picked = await invoke<string | null>("pick_folder", { current: outputDir });
    if (picked) setOutputDir(picked);
  } catch {
    // user cancelled or dialog failed; leave folder unchanged
  }
}

async function resetOutputDir() {
  try {
    setOutputDir(await invoke<string>("default_download_dir"));
  } catch {
    // leave folder unchanged if the system default couldn't be determined
  }
}

init();
