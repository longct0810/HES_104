'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateControlRequest } = require('../WebSocket/control-policy');

const policy = {
  '366621': {
    '5001': { type: 'C_SE_NC_1', min: 0, max: 100, commonAddress: 2 },
  },
};

function principal(permissions = ['telemetry.read', 'control.execute']) {
  return {
    permissions: new Set(permissions),
    allowedDevices: new Set(['366621']),
  };
}

test('control hợp lệ chỉ cần deviceId/ioa/value, không nhận IP/port từ client', () => {
  const result = validateControlRequest(principal(), {
    type: 'CONTROL', deviceId: 366621, ioa: 5001, value: 50, requestId: 'cmd-1',
  }, policy);
  assert.equal(result.ok, true);
  assert.deepEqual(result.command, {
    deviceId: '366621', ioa: 5001, value: 50, type: 'C_SE_NC_1', commonAddress: 2, requestId: 'cmd-1',
  });
  assert.equal('ip' in result.command, false);
  assert.equal('port' in result.command, false);
});

test('thiếu control.execute bị từ chối', () => {
  const result = validateControlRequest(principal(['telemetry.read']), {
    deviceId: 366621, ioa: 5001, value: 50,
  }, policy);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FORBIDDEN');
});

test('IOA không whitelist bị từ chối', () => {
  const result = validateControlRequest(principal(), {
    deviceId: 366621, ioa: 9999, value: 50,
  }, policy);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'IOA_FORBIDDEN');
});

test('value vượt min/max bị từ chối', () => {
  const result = validateControlRequest(principal(), {
    deviceId: 366621, ioa: 5001, value: 101,
  }, policy);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALUE_OUT_OF_RANGE');
});

test('IOA ngoài miền 24-bit IEC-104 bị từ chối', () => {
  const result = validateControlRequest(principal(), {
    deviceId: 366621, ioa: 0x1000000, value: 10,
  }, policy);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_CONTROL');
});
