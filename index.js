'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const https = require('https');
const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');

const parser = require('./analyser.js');
const IEC104Client = require('./SendIEC104');
const cambienQueue = require('./Import/queue.js');
const IEC104FrameBuffer = require('./IEC104/frame-buffer.js');
const ReceiveSequenceState = require('./IEC104/sequence-state.js');
const {
  U_FRAME,
  parseApci,
  buildUFrame,
  buildSFrame,
  buildGeneralInterrogationFrame,
  nextSequence,
} = require('./IEC104/apci.js');

const DEVICE_REFRESH_MS = Number(process.env.DEVICE_REFRESH_MS || 100000);
const RECONNECT_DELAY_MS = Number(process.env.IEC104_RECONNECT_DELAY_MS || 5000);
const HEARTBEAT_MS = Number(process.env.IEC104_HEARTBEAT_MS || 20000);
const SOCKET_IDLE_TIMEOUT_MS = Number(process.env.IEC104_SOCKET_IDLE_TIMEOUT_MS || 60000);
const API_URL = process.env.DEVICE_API_URL || 'https://smartgrid.ifc.com.vn:6336/api/ds_thietbi_IEC_104';
const DEFAULT_COMMON_ADDRESS = Number(process.env.IEC104_COMMON_ADDRESS || 2);
const ORIGINATOR_ADDRESS = Number(process.env.IEC104_ORIGINATOR_ADDRESS || 1);

// -----------------------------------------------------------------------------
// WebSocket realtime server - v0.2.2 RS256 secure gateway
// -----------------------------------------------------------------------------
const {
  createAuthConfig,
  validateAuthConfig,
  isOriginAllowed,
  extractTicket,
  verifyTicket,
  WS_APPLICATION_PROTOCOL,
} = require('./WebSocket/auth.js');
const {
  subscribe,
  unsubscribe,
  shouldReceiveTelemetry,
} = require('./WebSocket/subscription.js');
const {
  loadControlPolicy,
  validateControlRequest,
} = require('./WebSocket/control-policy.js');

const app = express();
const sslKeyPath = process.env.SSL_KEY_PATH || '/opt/cer/ifcssl2026-privatekey.key';
const sslCertPath = process.env.SSL_CERT_PATH || '/opt/cer/fullchain.pem';
const websocketPort = Number(process.env.WS_PORT || 6332);
const websocketHost = process.env.WS_HOST || '0.0.0.0';
const websocketPath = process.env.WS_PATH || '/ws';
const WS_MAX_PAYLOAD_BYTES = Number(process.env.WS_MAX_PAYLOAD_BYTES || 65536);
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS || 30000);
const WS_MAX_MESSAGES_PER_MINUTE = Number(process.env.WS_MAX_MESSAGES_PER_MINUTE || 120);
const WS_MAX_SUBSCRIPTIONS = Number(process.env.WS_MAX_SUBSCRIPTIONS || 1000);
const WS_MAX_CLIENTS = Number(process.env.WS_MAX_CLIENTS || 200);
const WS_MAX_CONNECTIONS_PER_IP = Number(process.env.WS_MAX_CONNECTIONS_PER_IP || 5);
const WS_TRUST_PROXY_IPS = new Set(
  String(process.env.WS_TRUST_PROXY_IPS || '')
    .split(',')
    .map((x) => normalizeIp(x.trim()))
    .filter(Boolean)
);
const WS_TICKET_SINGLE_USE = String(process.env.WS_TICKET_SINGLE_USE ?? 'true').toLowerCase() !== 'false';
const WS_SESSION_MAX_AGE_SEC = Number(process.env.WS_SESSION_MAX_AGE_SEC || 3600);
const CONTROL_ENABLED = String(process.env.CONTROL_ENABLED ?? 'false').toLowerCase() === 'true';

const wsAuthConfig = createAuthConfig(process.env);
validateAuthConfig(wsAuthConfig);
if (!Number.isFinite(WS_SESSION_MAX_AGE_SEC) || WS_SESSION_MAX_AGE_SEC <= 0) {
  throw new Error('WS_SESSION_MAX_AGE_SEC must be > 0');
}
console.log('[WS][AUTH] RS256 enabled:', {
  issuer: wsAuthConfig.issuer,
  audience: wsAuthConfig.audience,
  keyId: wsAuthConfig.keyId,
  ticketTransport: wsAuthConfig.ticketTransport,
});

const controlPolicyPath = process.env.CONTROL_POINTS_PATH || './config/control-points.json';
let controlPolicy = {};
try {
  controlPolicy = loadControlPolicy(controlPolicyPath);
  if (Object.keys(controlPolicy).length === 0) {
    console.warn(`[WS][CONTROL] No active control whitelist found at ${controlPolicyPath}. CONTROL is deny-all.`);
  }
} catch (err) {
  console.error('[WS][CONTROL] Cannot load control policy:', err.message);
  throw err;
}

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(sslKeyPath, 'utf8'),
    cert: fs.readFileSync(sslCertPath, 'utf8'),
  },
  app
);

const wss = new WebSocket.Server({
  noServer: true,
  maxPayload: WS_MAX_PAYLOAD_BYTES,
  perMessageDeflate: false,
  handleProtocols(protocols) {
    return protocols.has(WS_APPLICATION_PROTOCOL) ? WS_APPLICATION_PROTOCOL : false;
  },
});

const wsConnectionsByIp = new Map();
const usedTicketIds = new Map();

function normalizeIp(ip) {
  const value = String(ip || '').trim();
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function getRemoteIp(request) {
  const socketIp = normalizeIp(request?.socket?.remoteAddress) || 'unknown';
  if (!WS_TRUST_PROXY_IPS.has(socketIp)) return socketIp;

  const forwarded = String(request?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((x) => normalizeIp(x))
    .filter(Boolean);

  // Với một trusted reverse proxy cấu hình $proxy_add_x_forwarded_for,
  // phần tử cuối là peer ngay trước proxy và không thể do client trực tiếp
  // thay đổi nếu firewall chỉ cho proxy truy cập HES.
  return forwarded.at(-1) || socketIp;
}

function rejectUpgrade(socket, statusCode, statusText) {
  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(statusText)}\r\n` +
      '\r\n' +
      statusText
    );
  } finally {
    socket.destroy();
  }
}

httpsServer.on('upgrade', (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`).pathname;
  } catch {
    rejectUpgrade(socket, 400, 'Bad Request');
    return;
  }

  if (pathname !== websocketPath) {
    rejectUpgrade(socket, 404, 'Not Found');
    return;
  }

  const origin = request.headers.origin || '';
  if (!isOriginAllowed(origin, wsAuthConfig)) {
    console.warn('[WS][AUTH] Rejected origin:', origin || '<missing>');
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }

  if (wss.clients.size >= WS_MAX_CLIENTS) {
    rejectUpgrade(socket, 503, 'WebSocket capacity reached');
    return;
  }

  const ip = getRemoteIp(request);
  const currentIpConnections = wsConnectionsByIp.get(ip) || 0;
  if (WS_MAX_CONNECTIONS_PER_IP > 0 && currentIpConnections >= WS_MAX_CONNECTIONS_PER_IP) {
    console.warn('[WS][AUTH] Connection limit exceeded:', { ip });
    rejectUpgrade(socket, 429, 'Too Many Requests');
    return;
  }

  let principal;
  try {
    const ticket = extractTicket(request, wsAuthConfig);
    principal = verifyTicket(ticket, wsAuthConfig);

    if (WS_TICKET_SINGLE_USE) {
      if (!principal.tokenId) {
        throw new Error('Single-use WebSocket tickets require jti');
      }
      if (usedTicketIds.has(principal.tokenId)) {
        throw new Error('WebSocket ticket has already been used');
      }
      usedTicketIds.set(principal.tokenId, Number(principal.expiresAt) * 1000);
    }
  } catch (err) {
    console.warn('[WS][AUTH] Rejected ticket:', { ip, reason: err.message });
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  request.wsPrincipal = principal;
  request.wsRemoteIp = ip;

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  const ip = request.wsRemoteIp || getRemoteIp(request);
  const principal = request.wsPrincipal;

  ws.principal = principal;
  ws.remoteIp = ip;
  ws.subscriptions = new Set();
  ws.isAlive = true;
  ws.rateWindowStartedAt = Date.now();
  ws.rateWindowMessages = 0;
  ws.sessionExpiryTimer = null;
  ws.connectedAt = Date.now();

  // v0.2.2: ticket exp chỉ giới hạn thời gian dùng cho handshake.
  // WebSocket session có lifetime riêng để không buộc client reconnect mỗi 120 giây.
  if (Number.isFinite(WS_SESSION_MAX_AGE_SEC) && WS_SESSION_MAX_AGE_SEC > 0) {
    ws.sessionExpiresAt = ws.connectedAt + (WS_SESSION_MAX_AGE_SEC * 1000);
    ws.sessionExpiryTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Session renewal required');
    }, WS_SESSION_MAX_AGE_SEC * 1000);
    ws.sessionExpiryTimer.unref?.();
  } else {
    ws.sessionExpiresAt = null;
  }

  wsConnectionsByIp.set(ip, (wsConnectionsByIp.get(ip) || 0) + 1);

  console.log('[WS] Authenticated client connected:', {
    ip,
    userId: principal.userId,
    role: principal.role,
  });

  sendJson(ws, {
    type: 'READY',
    userId: principal.userId,
    role: principal.role,
    ticketExpiresAt: principal.expiresAt,
    sessionExpiresAt: ws.sessionExpiresAt ? Math.floor(ws.sessionExpiresAt / 1000) : null,
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    if (!allowIncomingMessage(ws)) {
      console.warn('[WS][RATE] Client exceeded message limit:', { ip, userId: principal.userId });
      sendError(ws, 'RATE_LIMITED', 'Too many WebSocket messages');
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(message.toString());
    } catch {
      sendError(ws, 'INVALID_JSON', 'Message must be valid JSON');
      return;
    }

    handleWsMessage(ws, msg);
  });

  ws.on('close', () => {
    if (ws.sessionExpiryTimer) clearTimeout(ws.sessionExpiryTimer);

    const current = wsConnectionsByIp.get(ip) || 0;
    if (current <= 1) wsConnectionsByIp.delete(ip);
    else wsConnectionsByIp.set(ip, current - 1);

    console.log('[WS] Client disconnected:', { ip, userId: principal.userId });
  });

  ws.on('error', (err) => {
    console.warn('[WS] Client error:', { ip, userId: principal.userId, error: err.message });
  });
});

function allowIncomingMessage(ws) {
  const now = Date.now();
  if (now - ws.rateWindowStartedAt >= 60000) {
    ws.rateWindowStartedAt = now;
    ws.rateWindowMessages = 0;
  }

  ws.rateWindowMessages += 1;
  return ws.rateWindowMessages <= WS_MAX_MESSAGES_PER_MINUTE;
}

function handleWsMessage(ws, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    sendError(ws, 'INVALID_MESSAGE', 'Message must be a JSON object');
    return;
  }

  switch (msg.type) {
    case 'PING':
      sendJson(ws, { type: 'PONG', time: new Date().toISOString() });
      return;

    case 'SUBSCRIBE': {
      const result = subscribe(ws, msg.devices, WS_MAX_SUBSCRIPTIONS);
      if (!result.ok) {
        sendError(ws, result.code, result.message, { denied: result.denied });
        return;
      }
      sendJson(ws, { type: 'SUBSCRIBED', devices: result.devices });
      return;
    }

    case 'UNSUBSCRIBE': {
      const result = unsubscribe(ws, msg.devices);
      sendJson(ws, { type: 'SUBSCRIBED', devices: result.devices });
      return;
    }

    case 'CONTROL':
      handleControlMessage(ws, msg);
      return;

    // Legacy command format intentionally disabled in v0.2.1 because it lets
    // the remote client choose RTU IP/port directly.
    case 'DIEUKHIEN':
      sendError(ws, 'LEGACY_CONTROL_DISABLED', 'Use CONTROL with deviceId, ioa and value');
      return;

    default:
      // v0.2.0 relayed arbitrary client messages to every other client.
      // v0.2.1 explicitly forbids client-to-client relay.
      sendError(ws, 'UNSUPPORTED_MESSAGE_TYPE', 'Unsupported WebSocket message type');
  }
}

function handleControlMessage(ws, msg) {
  if (!CONTROL_ENABLED) {
    sendError(ws, 'CONTROL_DISABLED', 'IEC-104 control is disabled on this HES');
    return;
  }

  const validation = validateControlRequest(ws.principal, msg, controlPolicy);
  if (!validation.ok) {
    console.warn('[WS][CONTROL] Rejected:', {
      userId: ws.principal.userId,
      ip: ws.remoteIp,
      deviceId: msg?.deviceId,
      ioa: msg?.ioa,
      reason: validation.code,
    });
    sendError(ws, validation.code, validation.message, { requestId: msg?.requestId || null });
    return;
  }

  const command = validation.command;
  const device = findDeviceById(command.deviceId);
  if (!device || !device.ip || !device.port) {
    sendError(ws, 'DEVICE_OFFLINE_OR_UNKNOWN', 'Device is not present in the active HES registry', {
      requestId: command.requestId,
    });
    return;
  }

  const commonAddress = command.commonAddress ?? Number(
    device.common_address ??
    device.commonAddress ??
    device.ca ??
    DEFAULT_COMMON_ADDRESS
  );

  console.warn('[WS][CONTROL] Accepted command:', {
    userId: ws.principal.userId,
    ip: ws.remoteIp,
    deviceId: command.deviceId,
    ioa: command.ioa,
    value: command.value,
    requestId: command.requestId,
  });

  try {
    const commandClient = new IEC104Client(device.ip, commonAddress, Number(device.port));
    commandClient.connect();
    setTimeout(() => commandClient.sendFloatValue(command.ioa, command.value), 500);

    sendJson(ws, {
      type: 'CONTROL_ACCEPTED',
      requestId: command.requestId,
      deviceId: command.deviceId,
      ioa: command.ioa,
    });
  } catch (err) {
    console.error('[WS][CONTROL] Command send failed:', err.message);
    sendError(ws, 'CONTROL_SEND_FAILED', 'HES could not start the IEC-104 command session', {
      requestId: command.requestId,
    });
  }
}

function findDeviceById(deviceId) {
  return arrIpAddresses.find((device) => String(device.id_thietbi) === String(deviceId)) || null;
}

function sendJson(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(data));
  return true;
}

function sendError(ws, code, message, extra = {}) {
  sendJson(ws, {
    type: 'ERROR',
    code,
    message,
    ...extra,
  });
}

function sendToWS(data) {
  if (!Array.isArray(data) || data.length === 0) return;

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const filtered = data.filter((row) => {
      const deviceId = Array.isArray(row) ? row[1] : null;
      return deviceId !== null && deviceId !== undefined && shouldReceiveTelemetry(client, deviceId);
    });

    if (filtered.length > 0) {
      // Giữ payload telemetry dạng array của HES cũ để giảm thay đổi frontend.
      client.send(JSON.stringify(filtered));
    }
  }
}

const wsHeartbeat = setInterval(() => {
  const now = Date.now();
  for (const [ticketId, expiresAtMs] of usedTicketIds.entries()) {
    if (expiresAtMs + 60000 < now) usedTicketIds.delete(ticketId);
  }

  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, WS_HEARTBEAT_MS);
wsHeartbeat.unref();

httpsServer.listen(websocketPort, websocketHost, () => {
  console.log(`[WS] Secure HTTPS/WebSocket server listening on ${websocketHost}:${websocketPort}${websocketPath}`);
});

// -----------------------------------------------------------------------------
// IEC-104 device manager
// -----------------------------------------------------------------------------
const requestData = { v_userid: 1 };
let arrIpAddresses = [];
const connectionMap = new Map();

startAutoRefresh();

function startAutoRefresh() {
  getConnect();
  setInterval(() => {
    console.log('REFRESH DEVICE LIST...');
    getConnect();
  }, DEVICE_REFRESH_MS);
}

function deviceKey(device) {
  return `${device.ip}:${device.port}`;
}

async function getConnect() {
  console.log('RELOAD DEVICE LIST...');

  try {
    const res = await axios.post(API_URL, requestData);
    const latestDevices = [];

    for (const device of res.data || []) {
      try {
        const obj = typeof device?.[0] === 'string' ? JSON.parse(device[0]) : device;
        if (!obj || !obj.ip || !obj.port) continue;
        obj.index = 0;
        latestDevices.push(obj);
      } catch (err) {
        console.error('Parse device error:', err.message);
      }
    }

    arrIpAddresses = latestDevices;
    syncConnections(latestDevices);
  } catch (err) {
    console.error('get_connect error:', err.message);
  }
}

function syncConnections(latestDevices) {
  const latestKeys = new Set(latestDevices.map(deviceKey));

  for (const device of latestDevices) {
    const key = deviceKey(device);
    const existing = connectionMap.get(key);

    if (!existing) {
      console.log(`ADD NEW DEVICE: ${key}`);
      connectToHardwareDevice(device);
      continue;
    }

    existing.device = device;
  }

  for (const [key] of connectionMap.entries()) {
    if (!latestKeys.has(key)) {
      console.log(`REMOVE DEVICE: ${key}`);
      destroyConnection(key, false);
    }
  }
}

function createConnectionState(device) {
  return {
    device,
    client: null,
    heartbeat: null,
    reconnectTimer: null,
    connecting: false,
    frameBuffer: new IEC104FrameBuffer(),
    receiveSequence: new ReceiveSequenceState(0),
    sendSeq: 0,
    peerAckSeq: 0,
    started: false,
    giSent: false,
  };
}

function connectToHardwareDevice(device) {
  const key = deviceKey(device);
  const existing = connectionMap.get(key);

  if (existing?.connecting) {
    console.log(`SKIP connecting, đang kết nối: ${key}`);
    return;
  }
  if (existing?.client && !existing.client.destroyed) {
    console.log(`SKIP connected: ${key}`);
    return;
  }

  const state = existing || createConnectionState(device);
  state.device = device;
  state.connecting = true;
  state.frameBuffer.reset();
  state.receiveSequence.reset(0);
  state.sendSeq = 0;
  state.peerAckSeq = 0;
  state.started = false;
  state.giSent = false;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  connectionMap.set(key, state);

  const client = net.createConnection(
    { host: device.ip, port: Number(device.port) },
    () => {
      if (state.client !== client) {
        client.destroy();
        return;
      }

      state.connecting = false;
      console.log(`Connected to ${key}`);
      safeWrite(client, buildUFrame(U_FRAME.STARTDT_ACT), key);

      state.heartbeat = setInterval(() => {
        if (!client.destroyed) {
          safeWrite(client, buildUFrame(U_FRAME.TESTFR_ACT), key);
        }
      }, HEARTBEAT_MS);
    }
  );

  state.client = client;
  client.setTimeout(SOCKET_IDLE_TIMEOUT_MS);

  client.on('timeout', () => {
    console.warn(`Connection idle timeout: ${key}`);
    client.destroy();
  });

  client.on('data', (chunk) => {
    let frames;
    try {
      frames = state.frameBuffer.push(chunk);
    } catch (err) {
      console.error(`[IEC104][FRAME_BUFFER] ${key}:`, err.message);
      client.destroy();
      return;
    }

    for (const apdu of frames) {
      try {
        handleApdu(state, client, key, apdu);
      } catch (err) {
        // Một frame lỗi không được làm chết toàn bộ HES. TCP session vẫn được giữ
        // để các frame kế tiếp có thể tiếp tục xử lý.
        console.error(`[IEC104][APDU] ${key}:`, err.message, apdu.toString('hex'));
      }
    }
  });

  client.on('close', () => {
    console.log(`Socket closed: ${key}`);
    if (state.client !== client) return;

    cleanupConnectionResources(key, client);
    if (isDeviceStillActive(key)) scheduleReconnect(key);
    else connectionMap.delete(key);
  });

  client.on('end', () => {
    console.log(`Disconnected from ${key}`);
    if (!client.destroyed) client.destroy();
  });

  client.on('error', (err) => {
    console.error(`Socket error ${key}:`, err.message);
    if (!client.destroyed) client.destroy();
  });
}

function handleApdu(state, client, key, apdu) {
  const apci = parseApci(apdu);

  if (apci.type === 'U') {
    handleUFrame(state, client, key, apci);
    return;
  }

  if (apci.type === 'S') {
    state.peerAckSeq = apci.nr;
    return;
  }

  state.peerAckSeq = apci.nr;

  const sequence = state.receiveSequence.accept(apci.ns);
  if (sequence.status === 'duplicate') {
    safeWrite(client, buildSFrame(state.receiveSequence.expected), key);
    return;
  }

  if (sequence.status === 'gap') {
    console.warn(
      `[IEC104][SEQ] ${key} sequence gap: received=${sequence.received}, expected=${sequence.expectedBefore}. ` +
      `Resynced expected=${sequence.expectedAfter}.`
    );
  }

  const device = state.device;
  const result = parser.analyser(apdu, device.name || '', device.id_thietbi || '');

  if (result.Data && result.Data.length > 0) {
    const jobId = `sensor-${device.id_thietbi || 'unknown'}-${crypto.randomUUID()}`;

    cambienQueue.add(
      { dataArray: result.Data },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }
    ).catch((err) => {
      console.error(`[QUEUE] Cannot enqueue ${jobId}:`, err.message);
    });

    sendToWS(result.Data);
  }

  // v0.2.0 ACK mỗi I-frame để ưu tiên reliability. Có thể tối ưu theo IEC k/w
  // window ở phiên bản throughput tuning sau.
  safeWrite(client, buildSFrame(state.receiveSequence.expected), key);
}

function handleUFrame(state, client, key, apci) {
  switch (apci.code) {
    case U_FRAME.TESTFR_ACT:
      safeWrite(client, buildUFrame(U_FRAME.TESTFR_CON), key);
      break;

    case U_FRAME.TESTFR_CON:
      break;

    case U_FRAME.STARTDT_ACT:
      state.started = true;
      safeWrite(client, buildUFrame(U_FRAME.STARTDT_CON), key);
      sendGeneralInterrogation(state, client, key);
      break;

    case U_FRAME.STARTDT_CON:
      state.started = true;
      sendGeneralInterrogation(state, client, key);
      break;

    case U_FRAME.STOPDT_ACT:
      state.started = false;
      safeWrite(client, buildUFrame(U_FRAME.STOPDT_CON), key);
      break;

    case U_FRAME.STOPDT_CON:
      state.started = false;
      break;

    default:
      console.warn(`[IEC104][U] ${key}: unsupported ${apci.name}`);
  }
}

function sendGeneralInterrogation(state, client, key) {
  if (state.giSent) return;

  const device = state.device || {};
  const commonAddress = Number(
    device.common_address ??
    device.commonAddress ??
    device.ca ??
    DEFAULT_COMMON_ADDRESS
  );

  const frame = buildGeneralInterrogationFrame({
    ns: state.sendSeq,
    nr: state.receiveSequence.expected,
    commonAddress,
    originatorAddress: ORIGINATOR_ADDRESS,
  });

  if (safeWrite(client, frame, key)) {
    console.log(`[IEC104] GI sent ${key}, CA=${commonAddress}, NS=${state.sendSeq}, NR=${state.receiveSequence.expected}`);
    state.sendSeq = nextSequence(state.sendSeq);
    state.giSent = true;
  }
}

function safeWrite(client, data, key) {
  if (!client || client.destroyed || !client.writable) return false;
  try {
    client.write(data);
    return true;
  } catch (err) {
    console.error(`[IEC104][WRITE] ${key}:`, err.message);
    return false;
  }
}

function cleanupConnectionResources(key, client) {
  const state = connectionMap.get(key);
  if (!state || (client && state.client !== client)) return;

  state.connecting = false;
  state.started = false;
  state.giSent = false;
  state.frameBuffer.reset();

  if (state.heartbeat) {
    clearInterval(state.heartbeat);
    state.heartbeat = null;
  }

  state.client = null;
}

function scheduleReconnect(key, delay = RECONNECT_DELAY_MS) {
  const state = connectionMap.get(key);
  if (!state || state.reconnectTimer) return;

  console.log(`Reconnect after ${delay}ms: ${key}`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;

    if (!isDeviceStillActive(key)) {
      connectionMap.delete(key);
      return;
    }

    connectToHardwareDevice(state.device);
  }, delay);
}

function destroyConnection(key, shouldReconnect = false) {
  const state = connectionMap.get(key);
  if (!state) return;

  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state.heartbeat) clearInterval(state.heartbeat);

  const client = state.client;
  state.client = null;
  state.connecting = false;
  state.reconnectTimer = null;
  state.heartbeat = null;

  if (client && !client.destroyed) client.destroy();
  if (!shouldReconnect) connectionMap.delete(key);
}

function isDeviceStillActive(key) {
  return arrIpAddresses.some((device) => deviceKey(device) === key);
}

function shutdown(signal) {
  console.log(`[SYSTEM] ${signal} received, closing IEC104 sessions...`);
  clearInterval(wsHeartbeat);
  for (const key of [...connectionMap.keys()]) {
    destroyConnection(key, false);
  }

  httpsServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
