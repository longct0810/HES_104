'use strict';

module.exports = {
  apps: [
    {
      name: 'hes-iec104',
      script: './index.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'hes-db-worker',
      script: './Import/worker.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'hes-log-cleaner',
      script: './Files/clean-file.js',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
    },
  ],
};
