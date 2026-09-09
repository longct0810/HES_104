// worker.js

// Ghi chú:
// - Bắt toàn bộ lỗi unhandled
// - Redis có retry strategy
// - Log chi tiết trạng thái job

// BẮT LỖI TOÀN CỤC
process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception thrown:", err);
});

const cambienQueue = require("./queue");
const db = require("./db");

(async () => {
  await db.initPool();
  // 🧹 Clean queue khi khởi động
  try {
    await cambienQueue.obliterate({ force: true });

    console.log("🧹 Queue đã được clean hoàn toàn.");
  } catch (err) {
    console.error("❌ Lỗi khi clean queue:", err);
  }
})();

cambienQueue.process(3, async (job) => {
  console.log(`🔥 [${new Date().toISOString()}] Worker nhận job: ${job.id}`);

  const { dataArray } = job.data;

  if (!dataArray || dataArray.length === 0) {
    console.log(`⚠️ Job ${job.id} không có dữ liệu.`);
    return;
  }

  const timeoutMs = 60000; // 60 giây
  let timeout;

  try {
    await Promise.race([
      db.insertCambienLog(dataArray),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Job ${job.id} quá hạn ${timeoutMs / 1000}s`));
        }, timeoutMs);
      }),
    ]);

    console.log(`✅ Job ${job.id} Insert thành công.`);
  } catch (err) {
    console.error(`❌ Job ${job.id} lỗi:`, err);
    throw err; // Bull sẽ đánh dấu failed
  } finally {
    clearTimeout(timeout);
  }
});

// Các event log
cambienQueue.on("waiting", (jobId) => {
  console.log(`⏳ Job waiting: ${jobId}`);
});
cambienQueue.on("active", (job) => {
  console.log(`🚀 Job đang xử lý: ${job.id}`);
});
cambienQueue.on("completed", (job) => {
  console.log(`✅ Job hoàn tất: ${job.id}`);
});
cambienQueue.on("failed", (job, err) => {
  console.error(`❌ Job lỗi: ${job.id}`, err);
});
cambienQueue.on("error", (err) => {
  console.error(`❌ Queue lỗi Redis:`, err);
});
cambienQueue.on("ready", () => {
  console.log(`✅ Queue sẵn sàng.`);
});
