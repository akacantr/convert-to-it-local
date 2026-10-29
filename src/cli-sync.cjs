const updater = require("./updater.cjs");

async function main() {
  console.log("Checking for updates...");
  const check = await updater.checkForUpdates();
  console.log("Check result:", check);

  if (check.hasUpdate || process.argv.includes("--force")) {
    const version = await updater.performDeltaUpdate({
      onStatus: (s) => {
        console.log(`[${s.progress || 0}%] (${s.step || s.state}) ${s.message}`);
      },
    });
    console.log("Successfully built and deployed offline version:", version);
  } else {
    console.log("Already up to date:", check.localVersion);
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
