'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { subscribe, unsubscribe, shouldReceiveTelemetry } = require('../WebSocket/subscription');

function wsFixture() {
  return {
    principal: {
      permissions: new Set(['telemetry.read']),
      allowedDevices: new Set(['366621', '366643']),
    },
    subscriptions: new Set(),
  };
}

test('client chỉ subscribe được device nằm trong JWT scope', () => {
  const ws = wsFixture();
  const result = subscribe(ws, [366621], 10);
  assert.equal(result.ok, true);
  assert.equal(shouldReceiveTelemetry(ws, 366621), true);
  assert.equal(shouldReceiveTelemetry(ws, 366643), false);
});

test('subscribe device ngoài scope bị từ chối toàn bộ', () => {
  const ws = wsFixture();
  const result = subscribe(ws, [366621, 999999], 10);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DEVICE_FORBIDDEN');
  assert.equal(ws.subscriptions.size, 0);
});

test('client thiếu telemetry.read không được subscribe', () => {
  const ws = wsFixture();
  ws.principal.permissions.clear();
  const result = subscribe(ws, [366621], 10);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FORBIDDEN');
});

test('unsubscribe loại device khỏi tập subscription', () => {
  const ws = wsFixture();
  subscribe(ws, [366621, 366643], 10);
  unsubscribe(ws, [366621]);
  assert.equal(shouldReceiveTelemetry(ws, 366621), false);
  assert.equal(shouldReceiveTelemetry(ws, 366643), true);
});
