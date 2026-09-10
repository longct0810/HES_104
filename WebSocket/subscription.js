'use strict';

const { canAccessDevice, hasPermission, DEFAULT_READ_PERMISSION } = require('./auth');

function normalizeRequestedDevices(devices) {
  if (!Array.isArray(devices)) return [];
  return [...new Set(devices.map((x) => String(x)).filter(Boolean))];
}

function subscribe(ws, requestedDevices, maxSubscriptions = 1000) {
  if (!hasPermission(ws.principal, DEFAULT_READ_PERMISSION)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Missing telemetry.read permission' };
  }

  const requested = normalizeRequestedDevices(requestedDevices);
  if (requested.length === 0) {
    return { ok: false, code: 'INVALID_SUBSCRIPTION', message: 'devices must be a non-empty array' };
  }

  if (requested.length > maxSubscriptions) {
    return { ok: false, code: 'TOO_MANY_SUBSCRIPTIONS', message: `Maximum ${maxSubscriptions} devices per client` };
  }

  const denied = requested.filter((id) => !canAccessDevice(ws.principal, id));
  if (denied.length > 0) {
    return { ok: false, code: 'DEVICE_FORBIDDEN', message: 'One or more devices are outside the ticket scope', denied };
  }

  ws.subscriptions = new Set(requested);
  return { ok: true, devices: requested };
}

function unsubscribe(ws, requestedDevices) {
  const requested = normalizeRequestedDevices(requestedDevices);
  if (!ws.subscriptions) ws.subscriptions = new Set();
  for (const id of requested) ws.subscriptions.delete(id);
  return { ok: true, devices: [...ws.subscriptions] };
}

function shouldReceiveTelemetry(ws, deviceId) {
  if (!hasPermission(ws.principal, DEFAULT_READ_PERMISSION)) return false;
  if (!canAccessDevice(ws.principal, deviceId)) return false;
  return Boolean(ws.subscriptions?.has(String(deviceId)));
}

module.exports = {
  subscribe,
  unsubscribe,
  shouldReceiveTelemetry,
  normalizeRequestedDevices,
};
