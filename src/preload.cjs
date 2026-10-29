const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("convertDesktop", {
  getState: () => ipcRenderer.invoke("updater:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  startUpdate: () => ipcRenderer.invoke("updater:start"),
  reloadApp: () => ipcRenderer.invoke("updater:reload"),
  onStatus: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  },
});

function mountDesktopStatusBar() {
  if (document.getElementById("convert-desktop-bar-host")) return;

  const host = document.createElement("div");
  host.id = "convert-desktop-bar-host";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      bottom: 14px;
      right: 14px;
      z-index: 2147483647;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(18, 22, 31, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #e5e7eb;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 6px 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font-size: 12px;
      line-height: 1.3;
      transition: all 0.2s ease;
      max-width: 520px;
      user-select: none;
    }

    .bar.ready {
      border-color: rgba(16, 185, 129, 0.55);
      box-shadow: 0 8px 28px rgba(16, 185, 129, 0.22);
    }

    .bar.updating {
      border-color: rgba(59, 130, 246, 0.55);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #10b981;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
    }

    .dot.offline {
      background: #f59e0b;
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
    }

    .dot.updating {
      background: #3b82f6;
      box-shadow: 0 0 8px rgba(59, 130, 246, 0.7);
      animation: pulse 1.2s infinite ease-in-out;
    }

    .dot.ready {
      background: #10b981;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.9);
      animation: pulse 1.2s infinite ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.25); opacity: 0.65; }
    }

    .info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .status-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #f3f4f6;
      font-weight: 500;
    }

    .sub-text {
      font-size: 10.5px;
      color: #9ca3af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .progress-wrap {
      width: 100%;
      height: 3px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 3px;
      display: none;
    }

    .bar.updating .progress-wrap {
      display: block;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      width: 0%;
      transition: width 0.25s ease;
    }

    button {
      all: unset;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      transition: background 0.15s ease, transform 0.1s ease;
      flex-shrink: 0;
    }

    button:active {
      transform: scale(0.97);
    }

    .btn-check {
      background: rgba(255, 255, 255, 0.08);
      color: #d1d5db;
    }

    .btn-check:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
    }

    .btn-reload {
      background: #10b981;
      color: #052e16;
      display: none;
    }

    .btn-reload:hover {
      background: #34d399;
    }

    .bar.ready .btn-reload {
      display: inline-flex;
    }

    .bar.ready .btn-check,
    .bar.updating .btn-check {
      display: none;
    }
  `;

  const container = document.createElement("div");
  container.className = "bar";
  container.innerHTML = `
    <span class="dot" id="status-dot"></span>
    <div class="info">
      <div class="status-text" id="status-text">Local Offline Build</div>
      <div class="sub-text" id="sub-text">Ready</div>
      <div class="progress-wrap">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
    </div>
    <button class="btn-check" id="btn-check" title="Check for new converter updates on GitHub">Update</button>
    <button class="btn-reload" id="btn-reload" title="Load the newly built version now">New Version Ready • Reload</button>
  `;

  shadow.appendChild(style);
  shadow.appendChild(container);
  document.body.appendChild(host);

  const dotEl = shadow.getElementById("status-dot");
  const statusTextEl = shadow.getElementById("status-text");
  const subTextEl = shadow.getElementById("sub-text");
  const progressFillEl = shadow.getElementById("progress-fill");
  const btnCheck = shadow.getElementById("btn-check");
  const btnReload = shadow.getElementById("btn-reload");

  function renderStatus(payload) {
    if (!payload) return;
    const { state, message, progress, version, online } = payload;

    container.classList.remove("updating", "ready");
    dotEl.classList.remove("offline", "updating", "ready");

    if (state === "updating" || state === "checking") {
      container.classList.add("updating");
      dotEl.classList.add("updating");
      statusTextEl.textContent = message || "Updating...";
      subTextEl.textContent =
        typeof progress === "number"
          ? `Building in background (${progress}%)`
          : "Checking GitHub...";
      progressFillEl.style.width = `${progress || 15}%`;
    } else if (state === "ready") {
      container.classList.add("ready");
      dotEl.classList.add("ready");
      statusTextEl.textContent = message || "New version ready!";
      subTextEl.textContent = version?.message
        ? `${version.shortSha}: ${version.message}`
        : "Reload to apply update";
    } else if (state === "offline") {
      dotEl.classList.add("offline");
      statusTextEl.textContent = version?.shortSha
        ? `Offline Mode • #${version.shortSha}`
        : "Offline Mode";
      subTextEl.textContent = message || "No internet connection — local bundle active";
    } else if (state === "error") {
      dotEl.classList.add("offline");
      statusTextEl.textContent = version?.shortSha
        ? `Local Build • #${version.shortSha}`
        : "Local Build Active";
      subTextEl.textContent = message || "Could not check for updates";
    } else {
      if (online === false) dotEl.classList.add("offline");
      statusTextEl.textContent = version?.shortSha
        ? `Up to Date • #${version.shortSha}`
        : "Local Offline Build";
      subTextEl.textContent = message || (version?.message ? version.message : "Ready for offline use");
    }
  }

  btnCheck.addEventListener("click", () => {
    ipcRenderer.invoke("updater:check-and-update", { manual: true });
  });

  btnReload.addEventListener("click", () => {
    ipcRenderer.invoke("updater:reload");
  });

  ipcRenderer.on("updater:status", (_event, payload) => {
    renderStatus(payload);
  });

  ipcRenderer.invoke("updater:get-state").then(renderStatus).catch(() => {});
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", mountDesktopStatusBar);
} else {
  mountDesktopStatusBar();
}
