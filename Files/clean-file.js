const fs = require("fs/promises");
const path = require("path");
const cron = require("node-cron");

const DRY_RUN = false;

let FOLDER = "";
let DAYS = 5;

async function loadConfig() {
  const content = await fs.readFile("../config.txt", "utf8");
  return JSON.parse(content);
}

async function initConfig() {
  const config = await loadConfig();

  FOLDER = path.resolve(__dirname, "..", config.dir_logfile);
  DAYS = parseInt(config.day_logfile || 5, 10);

  console.log("Folder log:", FOLDER);
  console.log("Days keep:", DAYS);
}

async function cleanup(dir) {
  const now = Date.now();
  const maxAge = DAYS * 24 * 60 * 60 * 1000;

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await cleanup(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const stat = await fs.stat(fullPath);
    const age = now - stat.mtimeMs;

    if (age > maxAge) {
      if (DRY_RUN) {
        console.log("[DRY RUN] Sẽ xóa:", fullPath);
      } else {
        await fs.unlink(fullPath);
        console.log("Đã xóa:", fullPath);
      }
    }
  }
}

async function runCleanup() {
  try {
    console.log(`[${new Date().toISOString()}] Start cleanup`);

    await cleanup(FOLDER);

    console.log(`[${new Date().toISOString()}] Cleanup completed`);
  } catch (err) {
    console.error(err);
  }
}

(async () => {
  await initConfig();

  // chạy ngay khi khởi động
  await runCleanup();

  // chạy lúc 02:00 sáng mỗi ngày
  cron.schedule("0 2 * * *", async () => {
    await runCleanup();
  });

  console.log("Cleanup scheduler started");
})();