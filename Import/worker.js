'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const cambienQueue = require('./queue');
const db = require('./db');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 1);
const JOB_TIMEOUT_MS = Number(process.env.WORKER_JOB_TIMEOUT_MS || 60000);

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

async function startWorker() {
  // Quan trọng: chỉ đăng ký consumer sau khi PostgreSQL pool thực sự sẵn sàng.
  await db.initPool();

  // v0.2.0: KHÔNG obliterate/purge queue khi restart. Các job waiting/delayed
  // được giữ lại trong Redis để tiếp tục xử lý sau khi service quay lại.
  cambienQueue.process(CONCURRENCY, async (job) => {
    console.log(`🔥 [${new Date().toISOString()}] Worker nhận job: ${job.id}`);

    const { dataArray } = job.data || {};
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.log(`⚠️ Job ${job.id} không có dữ liệu.`);
      return;
    }

    let timeout;
    try {
      await Promise.race([
        db.insertCambienLog(dataArray),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`Job ${job.id} quá hạn ${JOB_TIMEOUT_MS / 1000}s`));
          }, JOB_TIMEOUT_MS);
        }),
      ]);

      console.log(`✅ Job ${job.id} Insert thành công.`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });

  console.log(`✅ Worker started. concurrency=${CONCURRENCY}`);
}

cambienQueue.on('waiting', (jobId) => console.log(`⏳ Job waiting: ${jobId}`));
cambienQueue.on('active', (job) => console.log(`🚀 Job đang xử lý: ${job.id}`));
cambienQueue.on('completed', (job) => console.log(`✅ Job hoàn tất: ${job.id}`));
cambienQueue.on('failed', (job, err) => console.error(`❌ Job lỗi: ${job?.id}`, err));
cambienQueue.on('error', (err) => console.error('❌ Queue lỗi Redis:', err));
cambienQueue.on('ready', () => console.log('✅ Queue sẵn sàng.'));

async function shutdown(signal) {
  console.log(`[WORKER] ${signal} received, closing...`);
  try {
    await cambienQueue.close();
    await db.closePool();
  } catch (err) {
    console.error('[WORKER] Shutdown error:', err.message);
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

startWorker().catch((err) => {
  console.error('❌ Worker không thể khởi động:', err);
  process.exit(1);
});
