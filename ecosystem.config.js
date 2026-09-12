'use strict';

module.exports = {
  apps: [
    {
      name: 'hes-iec104',
      cwd: __dirname,
      script: './index.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'hes-db-worker',
      cwd: __dirname,
      script: './Import/worker.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'hes-log-cleaner',
      cwd: __dirname,
      script: './Files/clean-file.js',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
    },
  ],
};
