'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { signRs256 } = require('../WebSocket/jwt-rs256');
const {
  createAuthConfig,
  validateAuthConfig,
  isOriginAllowed,
  extractTicket,
  verifyTicket,
  canAccessDevice,
  hasPermission,
  WS_APPLICATION_PROTOCOL,
} = require('../WebSocket/auth');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hes104-rs256-'));
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPath = path.join(tmpDir, 'webapp-public.pem');
const weakPublicKeyPath = path.join(tmpDir, 'weak-public.pem');
fs.writeFileSync(publicKeyPath, keyPair.publicKey.export({ type: 'spki', format: 'pem' }));
const weakPair = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
fs.writeFileSync(weakPublicKeyPath, weakPair.publicKey.export({ type: 'spki', format: 'pem' }));

const BASE_ENV = {
  WS_JWT_PUBLIC_KEY_PATH: publicKeyPath,
  WS_JWT_ISSUER: 'smartgrid-web',
  WS_JWT_AUDIENCE: 'hes104-ws',
  WS_JWT_KEY_ID: 'smartgrid-ws-2026-01',
  WS_ALLOWED_ORIGINS: 'https://smartgrid.ifc.com.vn,https://iss.ifc.com.vn',
  WS_REQUIRE_ORIGIN: 'true',
  WS_TICKET_MAX_AGE_SEC: '120',
  WS_TICKET_TRANSPORT: 'protocol',
};

function ticket(overrides = {}, options = {}) {
  return signRs256({
    role: 'viewer',
    permissions: ['telemetry.read'],
    devices: [366621, 366643],
    ...overrides,
  }, options.privateKey || keyPair.privateKey, {
    subject: options.subject || 'user-1',
    issuer: options.issuer || 'smartgrid-web',
    audience: options.audience || 'hes104-ws',
    expiresInSec: options.expiresInSec ?? 90,
    jwtid: options.jwtid || crypto.randomUUID(),
    keyId: options.keyId === undefined ? 'smartgrid-ws-2026-01' : options.keyId,
  });
}

test('auth config fail-closed nếu thiếu RSA public key', () => {
  const config = createAuthConfig({ ...BASE_ENV, WS_JWT_PUBLIC_KEY_PATH: '' });
  assert.throws(() => validateAuthConfig(config), /PUBLIC_KEY_PATH/);
});

test('RSA public key nhỏ hơn 2048 bit bị từ chối', () => {
  assert.throws(() => createAuthConfig({ ...BASE_ENV, WS_JWT_PUBLIC_KEY_PATH: weakPublicKeyPath }), /at least 2048/);
});

test('auth config bắt buộc kid để khóa đúng signing key', () => {
  const config = createAuthConfig({ ...BASE_ENV, WS_JWT_KEY_ID: '' });
  assert.throws(() => validateAuthConfig(config), /KEY_ID/);
});

test('origin allowlist chỉ nhận đúng origin đã cấu hình', () => {
  const config = createAuthConfig(BASE_ENV);
  validateAuthConfig(config);
  assert.equal(isOriginAllowed('https://smartgrid.ifc.com.vn', config), true);
  assert.equal(isOriginAllowed('https://evil.example', config), false);
  assert.equal(isOriginAllowed('', config), false);
});

test('ticket được lấy từ Sec-WebSocket-Protocol, không cần query string', () => {
  const value = ticket();
  const config = createAuthConfig(BASE_ENV);
  const request = {
    url: '/ws',
    headers: {
      host: 'smartgrid.ifc.com.vn:6332',
      'sec-websocket-protocol': `${WS_APPLICATION_PROTOCOL}, ticket.${value}`,
    },
  };
  assert.equal(extractTicket(request, config), value);
});

test('protocol transport từ chối nếu thiếu application protocol', () => {
  const config = createAuthConfig(BASE_ENV);
  const request = {
    url: '/ws',
    headers: { 'sec-websocket-protocol': `ticket.${ticket()}` },
  };
  assert.throws(() => extractTicket(request, config), /hes104-v1/);
});

test('legacy query ticket mặc định bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  const request = {
    url: `/ws?ticket=${encodeURIComponent(ticket())}`,
    headers: { host: 'smartgrid.ifc.com.vn:6332' },
  };
  assert.throws(() => extractTicket(request, config), /subprotocol/);
});

test('JWT RS256 hợp lệ tạo principal có permission và device scope', () => {
  const config = createAuthConfig(BASE_ENV);
  const principal = verifyTicket(ticket(), config);
  assert.equal(principal.userId, 'user-1');
  assert.equal(hasPermission(principal, 'telemetry.read'), true);
  assert.equal(hasPermission(principal, 'control.execute'), false);
  assert.equal(canAccessDevice(principal, 366621), true);
  assert.equal(canAccessDevice(principal, 999999), false);
  assert.ok(principal.tokenId);
});

test('JWT ký bằng private key khác bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  const forged = ticket({}, { privateKey: otherKeyPair.privateKey });
  assert.throws(() => verifyTicket(forged, config), /signature/);
});

test('JWT sai audience bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  assert.throws(() => verifyTicket(ticket({}, { audience: 'other-service' }), config), /audience/);
});

test('JWT sai kid bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  assert.throws(() => verifyTicket(ticket({}, { keyId: 'old-key' }), config), /key id/);
});

test('JWT lifetime dài hơn ticket policy bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  assert.throws(() => verifyTicket(ticket({}, { expiresInSec: 3600 }), config), /lifetime exceeds/);
});

test('JWT không có device scope bị từ chối', () => {
  const config = createAuthConfig(BASE_ENV);
  const noDevices = signRs256({ permissions: ['telemetry.read'] }, keyPair.privateKey, {
    subject: 'user-1',
    issuer: 'smartgrid-web',
    audience: 'hes104-ws',
    expiresInSec: 90,
    jwtid: 'x',
    keyId: 'smartgrid-ws-2026-01',
  });
  assert.throws(() => verifyTicket(noDevices, config), /devices scope/);
});
