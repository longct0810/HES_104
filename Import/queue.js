'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const Queue = require('bull');

const cambienQueue = new Queue('cambien-log-queue', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    retryStrategy(times) {
      const delay = Math.min(times * 1000, 30000);
      console.log(`⏳ Redis reconnect in ${delay} ms`);
      return delay;
    },
  },
  defaultJobOptions: {
    attempts: Number(process.env.QUEUE_ATTEMPTS || 3),
    backoff: {
      type: 'fixed',
      delay: Number(process.env.QUEUE_RETRY_DELAY_MS || 5000),
    },
    removeOnComplete: Number(process.env.QUEUE_KEEP_COMPLETED || 1000),
    removeOnFail: Number(process.env.QUEUE_KEEP_FAILED || 5000),
  },
});

module.exports = cambienQueue;
