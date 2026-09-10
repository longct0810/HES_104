'use strict';

// FILE MẪU CHO WEB BACKEND, không chạy trong HES production.
// Web Backend giữ RSA PRIVATE key. HES chỉ nhận PUBLIC key tương ứng.
// allowedDeviceIds phải lấy từ DB/phân quyền server-side, tuyệt đối không tin danh sách từ browser.

const crypto = require('crypto');
const fs = require('fs');
const { signRs256 } = require('../WebSocket/jwt-rs256');

function createHesWsTicket({ userId, role, permissions, allowedDeviceIds }) {
  const privateKeyPath = process.env.HES_WS_PRIVATE_KEY_PATH;
  if (!privateKeyPath) throw new Error('HES_WS_PRIVATE_KEY_PATH is not configured');
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  return signRs256(
    {
      role,
      permissions,
      devices: allowedDeviceIds,
    },
    privateKey,
    {
      subject: String(userId),
      issuer: process.env.HES_WS_JWT_ISSUER || 'smartgrid-web',
      audience: process.env.HES_WS_JWT_AUDIENCE || 'hes104-ws',
      expiresInSec: Number(process.env.HES_WS_TICKET_TTL_SEC || 90),
      jwtid: crypto.randomUUID(),
      keyId: process.env.HES_WS_JWT_KEY_ID || 'smartgrid-ws-2026-01',
    }
  );
}

module.exports = { createHesWsTicket };
