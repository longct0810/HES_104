const Queue = require("bull");

const cambienQueue = new Queue("cambien-log-queue", {
  redis: {
    host: "127.0.0.1",
    port: 6379,
    retryStrategy: function (times) {
      const delay = Math.min(times * 1000, 30000);
      console.log(`⏳ Redis reconnect in ${delay} ms`);
      return delay;
    },
  },
});

module.exports = cambienQueue;
