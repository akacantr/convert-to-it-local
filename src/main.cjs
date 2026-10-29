const { app, BrowserWindow, protocol, net, shell, ipcMain, session } = require("electron");
const { URL, pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const updater = require("./updater.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let lastSaveDirectory = app.getPath("downloads");

let currentStatus = {
  state: "idle",
  online: true,
  message: "Ready for offline use",
  version: updater.getLocalVersion(),
};

function broadcastStatus(patch) {
  currentStatus = {
    ...currentStatus,
    ...patch,
    version: patch.version !== undefined ? patch.version : updater.getLocalVersion(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", currentStatus);
  }
}

function getBootstrapHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Convert to it! — Initial Setup</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f131a;
      color: #f3f4f6;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      background: #181e29;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 32px 40px;
      max-width: 460px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    h1 { margin: 0 0 10px; font-size: 22px; color: #60a5fa; }
    p { margin: 0 0 20px; font-size: 14px; color: #9ca3af; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Preparing Convert to it!</h1>
    <p>Building the local offline bundle for first launch. You can follow the progress in the status bar at the bottom right...</p>
  </div>
</body>
</html>`;
}

async function generateCacheViaElectron(distDir) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {}
      resolve(val);
    };

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });

    const timeout = setTimeout(() => finish(null), 60000);

    win.webContents.on("console-message", async (event, _level, legacyMessage) => {
      const message = event?.message ?? legacyMessage;
      if (message === "Built initial format list.") {
        try {
          const cacheJson = await win.webContents.executeJavaScript(
            "window.printSupportedFormatCache && window.printSupportedFormatCache()",
          );
          clearTimeout(timeout);
          finish(cacheJson || null);
        } catch {
          clearTimeout(timeout);
          finish(null);
        }
      }
    });

    win.loadURL("app://cache-build/index.html").catch(() => {
      clearTimeout(timeout);
      finish(null);
    });
  });
}

async function checkAndAutoUpdate({ manual = false } = {}) {
  try {
    broadcastStatus({
      state: "checking",
      message: "Checking for updates on GitHub...",
      progress: 5,
    });

    const checkResult = await updater.checkForUpdates();

    if (!checkResult.online) {
      broadcastStatus({
        state: "offline",
        online: false,
        message: "Offline — local bundle is active",
      });
      return checkResult;
    }

    if (!checkResult.hasUpdate) {
      broadcastStatus({
        state: "idle",
        online: true,
        message: manual
          ? "You are using the latest version"
          : checkResult.localVersion?.message || "Ready for offline use",
        version: checkResult.localVersion,
      });
      return checkResult;
    }

    const wasOfflineReady = updater.isOfflineReady();

    const newVersion = await updater.performDeltaUpdate({
      onStatus: (statusPatch) => broadcastStatus({ ...statusPatch, online: true }),
      generateCacheViaElectron,
    });

    if (!wasOfflineReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL("app://-/index.html");
    }

    return { ...checkResult, updatedTo: newVersion };
  } catch (err) {
    broadcastStatus({
      state: "error",
      message: `Update error: ${err.message || String(err)}`.slice(0, 90),
    });
    return { error: err.message };
  }
}

function setupDownloadSaveAsDialog() {
  session.defaultSession.on("will-download", (_event, item) => {
    const fileName = item.getFilename();
    const ext = path.extname(fileName).replace(/^\./, "");
    const filters = ext
      ? [
          { name: `${ext.toUpperCase()} File`, extensions: [ext] },
          { name: "All Files", extensions: ["*"] },
        ]
      : [{ name: "All Files", extensions: ["*"] }];

    item.setSaveDialogOptions({
      title: "Save Converted File As",
      defaultPath: path.join(lastSaveDirectory, fileName),
      filters,
    });

    item.once("done", (_e, state) => {
      if (state === "completed") {
        const savedPath = item.getSavePath();
        if (savedPath) {
          lastSaveDirectory = path.dirname(savedPath);
        }
      }
    });
  });
}

function resolveAppIcon() {
  const candidates = [
    path.join(updater.ROOT_DIR, "assets", "icon.ico"),
    path.join(updater.ROOT_DIR, "assets", "logo.png"),
    path.join(updater.UPSTREAM_DIR, "favicon.ico"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 540,
    title: "Convert to it! (Local Offline)",
    icon: resolveAppIcon(),
    autoHideMenuBar: true,
    backgroundColor: "#0f131a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  mainWindow.loadURL("app://-/index.html");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {}
    return { action: "deny" };
  });
}

ipcMain.handle("updater:get-state", () => {
  return {
    ...currentStatus,
    version: updater.getLocalVersion(),
  };
});

ipcMain.handle("updater:check-and-update", (_event, opts) => {
  return checkAndAutoUpdate(opts || { manual: true });
});

ipcMain.handle("updater:reload", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    broadcastStatus({
      state: "idle",
      online: true,
      message: "Ready for offline use",
      version: updater.getLocalVersion(),
    });
    mainWindow.loadURL("app://-/index.html");
  }
});

app.whenReady().then(() => {
  setupDownloadSaveAsDialog();

  protocol.handle("app", async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.protocol !== "app:") {
        return new Response("Invalid Request", { status: 400 });
      }

      const baseDir =
        parsedUrl.hostname === "cache-build"
          ? path.join(updater.UPSTREAM_DIR, "dist")
          : updater.APP_DIST_DIR;

      let urlPath = parsedUrl.pathname;
      if (urlPath.startsWith("/")) {
        urlPath = urlPath.slice(1);
      }
      if (urlPath.startsWith("convert/")) {
        urlPath = urlPath.replace("convert/", "");
      }
      if (!urlPath || urlPath === "/") {
        urlPath = "index.html";
      }

      let decodedPath = urlPath;
      try {
        while (decodedPath !== decodeURIComponent(decodedPath)) {
          decodedPath = decodeURIComponent(decodedPath);
        }
      } catch {
        return new Response("Malformed URL", { status: 400 });
      }
      urlPath = decodedPath;

      const resolvedPath = path.resolve(baseDir, urlPath);
      const relativePath = path.relative(baseDir, resolvedPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("File requested outside dist directory.");
      }

      if (!fs.existsSync(resolvedPath)) {
        if (urlPath === "index.html") {
          return new Response(getBootstrapHtml(), {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cross-Origin-Opener-Policy": "same-origin",
              "Cross-Origin-Embedder-Policy": "credentialless",
            },
          });
        }
        return new Response("File Not Found", { status: 404 });
      }

      const fileUrl = pathToFileURL(resolvedPath).href;
      const response = await net.fetch(fileUrl);

      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response("File Not Found", { status: 404 });
    }
  });

  createWindow();

  if (process.argv.includes("--smoke-test")) {
    mainWindow.webContents.on("console-message", async (event, _level, legacyMsg) => {
      const msg = event?.message ?? legacyMsg;
      if (msg === "Built initial format list.") {
        const check = await mainWindow.webContents.executeJavaScript(`({
          title: document.title,
          crossOriginIsolated: window.crossOriginIsolated,
          hasStatusBar: Boolean(document.getElementById("convert-desktop-bar-host")),
          handlersCount: Array.isArray(window.handlerDefs) ? window.handlerDefs.length : 0
        })`);
        console.log("SMOKE_TEST_SUCCESS:", JSON.stringify(check));
        app.quit();
      }
    });
    setTimeout(() => {
      console.error("SMOKE_TEST_TIMEOUT");
      app.exit(1);
    }, 20000);
    return;
  }

  // Trigger silent background update check shortly after window opens
  setTimeout(() => {
    void checkAndAutoUpdate({ manual: false });
  }, 1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.protocol !== "app:") {
        event.preventDefault();
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
          shell.openExternal(navigationUrl);
        }
      }
    } catch {}
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
