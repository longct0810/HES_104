'use strict';

// Demo/test only. Production ticket phải được tạo ở Web Backend.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const { signRs256 } = require('../WebSocket/jwt-rs256');

const privateKeyPath = process.env.HES_WS_PRIVATE_KEY_PATH;
if (!privateKeyPath) throw new Error('Set HES_WS_PRIVATE_KEY_PATH before generating a demo ticket');
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const token = signRs256(
  {
    role: 'viewer',
    permissions: ['telemetry.read'],
    devices: [366621],
  },
  privateKey,
  {
    subject: 'demo-user',
    issuer: process.env.WS_JWT_ISSUER || 'smartgrid-web',
    audience: process.env.WS_JWT_AUDIENCE || 'hes104-ws',
    expiresInSec: 90,
    jwtid: crypto.randomUUID(),
    keyId: process.env.WS_JWT_KEY_ID || 'smartgrid-ws-2026-01',
  }
);

console.log(token);
