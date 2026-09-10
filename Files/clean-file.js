'use strict';

const fs = require('fs/promises');
const path = require('path');
const cron = require('node-cron');

const DRY_RUN = String(process.env.LOG_CLEANUP_DRY_RUN || 'false').toLowerCase() === 'true';
let folder = '';
let days = 5;

async function loadConfig() {
  const configPath = path.resolve(__dirname, '..', 'config.txt');
  const content = await fs.readFile(configPath, 'utf8');
  return JSON.parse(content);
}

async function initConfig() {
  const config = await loadConfig();
  folder = path.resolve(__dirname, '..', config.dir_logfile || 'LogFiles/Log');
  days = Number.parseInt(config.day_logfile || 5, 10);
  console.log('Folder log:', folder);
  console.log('Days keep:', days);
}

async function cleanup(dir) {
  const now = Date.now();
  const maxAge = days * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await cleanup(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;

    const stat = await fs.stat(fullPath);
    if (now - stat.mtimeMs <= maxAge) continue;

    if (DRY_RUN) console.log('[DRY RUN] Sẽ xóa:', fullPath);
    else {
      await fs.unlink(fullPath);
      console.log('Đã xóa:', fullPath);
    }
  }
}

async function runCleanup() {
  try {
    console.log(`[${new Date().toISOString()}] Start cleanup`);
    await cleanup(folder);
    console.log(`[${new Date().toISOString()}] Cleanup completed`);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    console.error(err);
  }
}

(async () => {
  await initConfig();
  await runCleanup();
  cron.schedule('0 2 * * *', runCleanup);
  console.log('Cleanup scheduler started');
})().catch((err) => {
  console.error('Cleanup scheduler failed:', err);
  process.exit(1);
});
