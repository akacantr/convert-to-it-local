const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const ROOT_DIR = path.resolve(__dirname, "..");
const UPSTREAM_DIR = path.join(ROOT_DIR, "upstream");
const APP_DIST_DIR = path.join(ROOT_DIR, "app-dist");
const COMMIT_INFO_FILE = path.join(APP_DIST_DIR, ".commit-info.json");

function findBunExecutable() {
  const candidates = [
    path.join(ROOT_DIR, ".runtime", "bun", "bun.exe"),
    path.join(os.homedir(), ".bun", "bin", "bun.exe"),
    "bun",
  ];
  for (const candidate of candidates) {
    if (candidate === "bun" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "bun";
}

function findGitExecutable() {
  const candidates = [
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    "git",
  ];
  for (const candidate of candidates) {
    if (candidate === "git" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "git";
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const bunDir = path.dirname(findBunExecutable());
    const gitDir = path.dirname(findGitExecutable());
    const extraPath = [bunDir, gitDir].filter((d) => d && d !== ".").join(path.delimiter);

    const env = {
      ...process.env,
      ...(options.env || {}),
      PATH: extraPath
        ? `${extraPath}${path.delimiter}${process.env.PATH || ""}`
        : process.env.PATH,
    };

    const child = spawn(cmd, args, {
      cwd: options.cwd || UPSTREAM_DIR,
      env,
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (options.onOutput) options.onOutput(text);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (options.onOutput) options.onOutput(text);
      });
    }

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const err = new Error(
          `Command failed (${cmd} ${args.join(" ")}): exit code ${code}\n${stderr || stdout}`,
        );
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

function getLocalVersion() {
  try {
    if (!fs.existsSync(COMMIT_INFO_FILE)) return null;
    const indexHtml = path.join(APP_DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) return null;
    return JSON.parse(fs.readFileSync(COMMIT_INFO_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isOfflineReady() {
  return fs.existsSync(path.join(APP_DIST_DIR, "index.html"));
}

async function getCommitMetadata(ref = "HEAD") {
  const git = findGitExecutable();
  const { stdout } = await runCommand(git, [
    "log",
    "-1",
    "--format=%H%n%h%n%s%n%cI",
    ref,
  ]);
  const [sha, shortSha, subject, date] = stdout.split(/\r?\n/);
  return {
    sha: (sha || "").trim(),
    shortSha: (shortSha || "").trim(),
    message: (subject || "").trim(),
    date: (date || "").trim(),
  };
}

async function checkForUpdates() {
  const localVersion = getLocalVersion();
  const git = findGitExecutable();

  try {
    if (!fs.existsSync(path.join(UPSTREAM_DIR, ".git"))) {
      return {
        online: true,
        hasUpdate: true,
        localVersion,
        remoteVersion: null,
        reason: "Upstream repository not cloned yet",
      };
    }

    await runCommand(git, ["fetch", "--depth", "1", "origin", "master"]);
    const remoteVersion = await getCommitMetadata("origin/master");

    const hasUpdate =
      !localVersion ||
      !isOfflineReady() ||
      localVersion.sha !== remoteVersion.sha;

    return {
      online: true,
      hasUpdate,
      localVersion,
      remoteVersion,
    };
  } catch (err) {
    return {
      online: false,
      hasUpdate: false,
      localVersion,
      remoteVersion: null,
      error: err.message,
    };
  }
}

async function fetchOrBuildCacheJson(distDir, generateCacheViaElectron) {
  const cachePath = path.join(distDir, "cache.json");

  // Strategy 1: If generateCacheViaElectron is provided by Electron runtime, try fetching official cache.json first, then fallback to local Electron generation
  try {
    const response = await fetch("https://p2r3.github.io/convert/cache.json", {
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const text = await response.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        await fsp.writeFile(cachePath, JSON.stringify(parsed), "utf8");
        return true;
      }
    }
  } catch {
    // Fallback to local generation
  }

  if (typeof generateCacheViaElectron === "function") {
    try {
      const cacheText = await generateCacheViaElectron(distDir);
      if (cacheText) {
        await fsp.writeFile(cachePath, cacheText, "utf8");
        return true;
      }
    } catch (err) {
      console.warn("Electron cache generation fallback warning:", err);
    }
  }

  // Keep previous cache.json if available
  const existingCache = path.join(APP_DIST_DIR, "cache.json");
  if (!fs.existsSync(cachePath) && fs.existsSync(existingCache)) {
    await fsp.copyFile(existingCache, cachePath);
    return true;
  }

  return fs.existsSync(cachePath);
}

let updateInProgress = false;

async function performDeltaUpdate({ onStatus = () => {}, generateCacheViaElectron } = {}) {
  if (updateInProgress) {
    throw new Error("An update is already in progress.");
  }

  updateInProgress = true;
  const git = findGitExecutable();
  const bun = findBunExecutable();

  try {
    onStatus({
      state: "updating",
      step: "fetch",
      progress: 10,
      message: "Checking for latest changes from GitHub repository...",
    });

    if (!fs.existsSync(path.join(UPSTREAM_DIR, ".git"))) {
      await fsp.mkdir(UPSTREAM_DIR, { recursive: true });
      await runCommand(
        git,
        ["clone", "--depth", "1", "--recurse-submodules", "https://github.com/p2r3/convert.git", UPSTREAM_DIR],
        { cwd: ROOT_DIR },
      );
    } else {
      await runCommand(git, ["fetch", "--depth", "1", "origin", "master"]);
    }

    let headSha = "";
    try {
      const headRes = await runCommand(git, ["rev-parse", "HEAD"]);
      headSha = headRes.stdout;
    } catch {
      headSha = "";
    }

    const remoteMeta = await getCommitMetadata("origin/master");

    let changedFiles = [];
    if (headSha && headSha !== remoteMeta.sha) {
      try {
        const diffRes = await runCommand(git, ["diff", "--name-only", headSha, "origin/master"]);
        changedFiles = diffRes.stdout.split(/\r?\n/).filter(Boolean);
      } catch {
        changedFiles = ["package.json"];
      }
    }

    if (headSha !== remoteMeta.sha) {
      onStatus({
        state: "updating",
        step: "pull",
        progress: 20,
        message: `Applying new commit (${remoteMeta.shortSha}: ${remoteMeta.message})...`,
      });
      await runCommand(git, ["reset", "--hard", "origin/master"]);
      await runCommand(git, ["submodule", "update", "--init", "--recursive"]);
    }

    const nodeModulesExists = fs.existsSync(path.join(UPSTREAM_DIR, "node_modules"));
    const depsChanged =
      !nodeModulesExists ||
      changedFiles.some((f) => f === "package.json" || f === "bun.lock");

    if (depsChanged) {
      onStatus({
        state: "updating",
        step: "install",
        progress: 35,
        message: "Updating package dependencies (bun install)...",
      });
      await runCommand(bun, ["install", "--no-save", "--ignore-scripts"]);
    }

    onStatus({
      state: "updating",
      step: "assemble",
      progress: 55,
      message: "Assembling converter components (WASM & Recipes)...",
    });
    await runCommand(bun, ["run", "build:assemble", "--all"]);

    onStatus({
      state: "updating",
      step: "build",
      progress: 75,
      message: "Building application for local offline use (Vite)...",
    });
    await runCommand(bun, ["x", "vite", "build"], {
      env: {
        IS_DESKTOP: "true",
        VITE_COMMIT_SHA: remoteMeta.sha,
      },
    });

    const upstreamDist = path.join(UPSTREAM_DIR, "dist");
    if (!fs.existsSync(path.join(upstreamDist, "index.html"))) {
      throw new Error("Build completed, but dist/index.html was not found.");
    }

    onStatus({
      state: "updating",
      step: "cache",
      progress: 88,
      message: "Preparing supported format cache (cache.json)...",
    });
    await fetchOrBuildCacheJson(upstreamDist, generateCacheViaElectron);

    onStatus({
      state: "updating",
      step: "deploy",
      progress: 95,
      message: "Updating local offline files...",
    });

    await fsp.mkdir(APP_DIST_DIR, { recursive: true });
    await fsp.cp(upstreamDist, APP_DIST_DIR, { recursive: true, force: true });

    const newVersionInfo = {
      ...remoteMeta,
      builtAt: new Date().toISOString(),
    };
    await fsp.writeFile(
      COMMIT_INFO_FILE,
      JSON.stringify(newVersionInfo, null, 2),
      "utf8",
    );

    onStatus({
      state: "ready",
      step: "done",
      progress: 100,
      message: `New version ready (${newVersionInfo.shortSha})`,
      version: newVersionInfo,
    });

    return newVersionInfo;
  } finally {
    updateInProgress = false;
  }
}

module.exports = {
  ROOT_DIR,
  UPSTREAM_DIR,
  APP_DIST_DIR,
  findBunExecutable,
  findGitExecutable,
  getLocalVersion,
  isOfflineReady,
  checkForUpdates,
  performDeltaUpdate,
};
