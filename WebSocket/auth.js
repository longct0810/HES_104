'use strict';

const fs = require('fs');
const path = require('path');
const { verifyRs256, validateRsaPublicKey } = require('./jwt-rs256');

const DEFAULT_READ_PERMISSION = 'telemetry.read';
const DEFAULT_CONTROL_PERMISSION = 'control.execute';
const WS_APPLICATION_PROTOCOL = 'hes104-v1';
const WS_TICKET_PROTOCOL_PREFIX = 'ticket.';

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeDeviceScope(devices) {
  if (devices === '*') return '*';
  if (!Array.isArray(devices)) return new Set();
  return new Set(devices.map((x) => String(x)).filter(Boolean));
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return new Set();
  return new Set(permissions.map((x) => String(x)).filter(Boolean));
}

function createAuthConfig(env = process.env) {
  const publicKeyPath = String(env.WS_JWT_PUBLIC_KEY_PATH || '').trim();
  const issuer = String(env.WS_JWT_ISSUER || 'smartgrid-web');
  const audience = String(env.WS_JWT_AUDIENCE || 'hes104-ws');
  const keyId = String(env.WS_JWT_KEY_ID || '').trim();
  const allowedOrigins = new Set(parseCsv(env.WS_ALLOWED_ORIGINS));
  const requireOrigin = String(env.WS_REQUIRE_ORIGIN ?? 'true').toLowerCase() !== 'false';
  const maxTokenAgeSec = Number(env.WS_TICKET_MAX_AGE_SEC || env.WS_JWT_MAX_AGE_SEC || 120);
  const clockToleranceSec = Number(env.WS_JWT_CLOCK_TOLERANCE_SEC || 5);
  const ticketTransport = String(env.WS_TICKET_TRANSPORT || 'protocol').toLowerCase();
  const allowLegacyQueryTicket = String(env.WS_ALLOW_LEGACY_QUERY_TICKET ?? 'false').toLowerCase() === 'true';

  let publicKey = null;
  if (publicKeyPath) {
    const absolutePath = path.resolve(__dirname, '..', publicKeyPath);
    const pem = fs.readFileSync(absolutePath, 'utf8');
    publicKey = validateRsaPublicKey(pem, 2048);
  }

  return {
    algorithm: 'RS256',
    publicKeyPath,
    publicKey,
    issuer,
    audience,
    keyId,
    allowedOrigins,
    requireOrigin,
    maxTokenAgeSec,
    clockToleranceSec,
    ticketTransport,
    allowLegacyQueryTicket,
  };
}

function validateAuthConfig(config) {
  if (!config.publicKeyPath || !config.publicKey) {
    throw new Error('WS_JWT_PUBLIC_KEY_PATH is required and must point to an RSA public key');
  }
  if (!config.issuer) throw new Error('WS_JWT_ISSUER is required');
  if (!config.audience) throw new Error('WS_JWT_AUDIENCE is required');
  if (!config.keyId) throw new Error('WS_JWT_KEY_ID is required');
  if (config.requireOrigin && config.allowedOrigins.size === 0) {
    throw new Error('WS_ALLOWED_ORIGINS is required when WS_REQUIRE_ORIGIN=true');
  }
  if (!Number.isFinite(config.maxTokenAgeSec) || config.maxTokenAgeSec <= 0) {
    throw new Error('WS_TICKET_MAX_AGE_SEC must be > 0');
  }
  if (!['protocol', 'query'].includes(config.ticketTransport)) {
    throw new Error('WS_TICKET_TRANSPORT must be protocol or query');
  }
}

function isOriginAllowed(origin, config) {
  if (!origin) return !config.requireOrigin;
  return config.allowedOrigins.has(origin);
}

function parseSubprotocols(headerValue) {
  return String(headerValue || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function extractProtocolTicket(request) {
  const protocols = parseSubprotocols(request?.headers?.['sec-websocket-protocol']);
  const applicationProtocol = protocols.includes(WS_APPLICATION_PROTOCOL);
  const ticketProtocol = protocols.find((p) => p.startsWith(WS_TICKET_PROTOCOL_PREFIX));

  if (!applicationProtocol) {
    throw new Error(`Missing required WebSocket subprotocol ${WS_APPLICATION_PROTOCOL}`);
  }
  if (!ticketProtocol || ticketProtocol.length <= WS_TICKET_PROTOCOL_PREFIX.length) {
    throw new Error('Missing WebSocket ticket subprotocol');
  }

  return ticketProtocol.slice(WS_TICKET_PROTOCOL_PREFIX.length);
}

function extractQueryTicket(requestUrl, host = 'localhost') {
  const url = new URL(requestUrl || '/', `https://${host}`);
  return url.searchParams.get('ticket') || '';
}

function extractTicket(request, config) {
  if (config.ticketTransport === 'protocol') {
    try {
      return extractProtocolTicket(request);
    } catch (err) {
      if (!config.allowLegacyQueryTicket) throw err;
      const legacy = extractQueryTicket(request?.url, request?.headers?.host || 'localhost');
      if (legacy) return legacy;
      throw err;
    }
  }

  return extractQueryTicket(request?.url, request?.headers?.host || 'localhost');
}

function verifyTicket(ticket, config) {
  if (!ticket) {
    const err = new Error('Missing WebSocket ticket');
    err.code = 'WS_AUTH_MISSING_TICKET';
    throw err;
  }

  const payload = verifyRs256(ticket, config.publicKey, {
    issuer: config.issuer,
    audience: config.audience,
    keyId: config.keyId || undefined,
    clockToleranceSec: config.clockToleranceSec,
    maxAgeSec: config.maxTokenAgeSec,
  });

  if (!payload || typeof payload !== 'object' || !payload.sub) {
    const err = new Error('WebSocket ticket must contain sub');
    err.code = 'WS_AUTH_INVALID_SUBJECT';
    throw err;
  }

  if (!payload.iat || !payload.exp) {
    const err = new Error('WebSocket ticket must contain iat and exp');
    err.code = 'WS_AUTH_MISSING_LIFETIME';
    throw err;
  }

  const permissions = normalizePermissions(payload.permissions);
  const allowedDevices = normalizeDeviceScope(payload.devices);

  if (allowedDevices !== '*' && allowedDevices.size === 0) {
    const err = new Error('WebSocket ticket must contain a non-empty devices scope');
    err.code = 'WS_AUTH_EMPTY_DEVICE_SCOPE';
    throw err;
  }

  return {
    userId: String(payload.sub),
    role: payload.role ? String(payload.role) : '',
    permissions,
    allowedDevices,
    tokenId: payload.jti ? String(payload.jti) : '',
    issuedAt: Number(payload.iat),
    expiresAt: Number(payload.exp),
  };
}

function hasPermission(principal, permission) {
  return Boolean(principal?.permissions?.has(permission));
}

function canAccessDevice(principal, deviceId) {
  if (!principal) return false;
  if (principal.allowedDevices === '*') return true;
  return principal.allowedDevices.has(String(deviceId));
}

module.exports = {
  DEFAULT_READ_PERMISSION,
  DEFAULT_CONTROL_PERMISSION,
  WS_APPLICATION_PROTOCOL,
  WS_TICKET_PROTOCOL_PREFIX,
  createAuthConfig,
  validateAuthConfig,
  isOriginAllowed,
  parseSubprotocols,
  extractProtocolTicket,
  extractQueryTicket,
  extractTicket,
  verifyTicket,
  hasPermission,
  canAccessDevice,
  normalizeDeviceScope,
};
