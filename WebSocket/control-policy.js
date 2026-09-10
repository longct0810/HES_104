'use strict';

const fs = require('fs');
const path = require('path');
const { canAccessDevice, hasPermission, DEFAULT_CONTROL_PERMISSION } = require('./auth');

function loadControlPolicy(filePath) {
  if (!filePath) return {};
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return {};

  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Control policy must be a JSON object');
  }
  return raw;
}

function validateControlRequest(principal, message, policy) {
  if (!hasPermission(principal, DEFAULT_CONTROL_PERMISSION)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Missing control.execute permission' };
  }

  const deviceId = message?.deviceId;
  const ioa = Number(message?.ioa);
  const value = Number(message?.value);

  if (deviceId === undefined || deviceId === null || !Number.isInteger(ioa) || ioa < 0 || ioa > 0xFFFFFF || !Number.isFinite(value)) {
    return { ok: false, code: 'INVALID_CONTROL', message: 'deviceId, IEC-104 IOA (0..16777215) and numeric value are required' };
  }

  if (!canAccessDevice(principal, deviceId)) {
    return { ok: false, code: 'DEVICE_FORBIDDEN', message: 'Device is outside the ticket scope' };
  }

  const devicePolicy = policy?.[String(deviceId)];
  const point = devicePolicy?.[String(ioa)];
  if (!point) {
    return { ok: false, code: 'IOA_FORBIDDEN', message: 'Control point is not whitelisted' };
  }

  const type = String(point.type || 'C_SE_NC_1');
  if (type !== 'C_SE_NC_1') {
    return { ok: false, code: 'UNSUPPORTED_CONTROL_TYPE', message: `Unsupported control type ${type}` };
  }

  if (Number.isFinite(Number(point.min)) && value < Number(point.min)) {
    return { ok: false, code: 'VALUE_OUT_OF_RANGE', message: `Value is below minimum ${point.min}` };
  }
  if (Number.isFinite(Number(point.max)) && value > Number(point.max)) {
    return { ok: false, code: 'VALUE_OUT_OF_RANGE', message: `Value is above maximum ${point.max}` };
  }

  return {
    ok: true,
    command: {
      deviceId: String(deviceId),
      ioa,
      value,
      type,
      commonAddress: Number.isFinite(Number(point.commonAddress)) ? Number(point.commonAddress) : null,
      requestId: message.requestId ? String(message.requestId) : null,
    },
  };
}

module.exports = {
  loadControlPolicy,
  validateControlRequest,
};
