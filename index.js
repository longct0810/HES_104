const net = require("net");
const http = require("http");
const parser = require("./analyser.js");
const timer = 100000;
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const IEC104Client = require('./SendIEC104');
const cambienQueue = require("./Import/queue.js");

//CREATE WEBSOCKET SERVER
const https = require('https');
const WebSocket = require('ws');
const express = require("express");
const app = express();
const port = process.env.PORT || "2022";
// Load SSL certificates
var privateKey = fs.readFileSync('/opt/cer/ifcssl2026-privatekey.key', 'utf8');
var certificate = fs.readFileSync('/opt/cer/fullchain.pem', 'utf8');
var credentials = { key: privateKey, cert: certificate };

var httpsServer = https.createServer(credentials, app);
httpsServer.listen(6332);

var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({
  server: httpsServer,
  verifyClient: (info, done) => {
    // Cho phép tất cả origin
    done(true);
  }
});

wss.on('connection', function connection(ws) {
  const ip = request.socket.remoteAddress;
  const port = request.socket.remotePort;
  console.log('Client connected:', { ip, port });
  
  ws.on('message', function incoming(message) {
    const msg = JSON.parse(message);
    if (msg.type === 'DIEUKHIEN' && Array.isArray(msg.Data)) { //nhan ban tin dieu khien cong suat
      const allData = msg.Data;
      allData.forEach(row => {
        const device_ip = row[0];
        const device_port = row[1];
        const device_ioa = row[2];
        const device_value = row[3];
        const client = new IEC104Client(device_ip, 1, device_port);
        client.connect();

        setTimeout(() => {
          client.sendFloatValue(device_ioa, device_value);
        }, 500);
      });

    }
    else {
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {

          var _data = msg;
          client.send(JSON.stringify(_data));
        }
      });
    }
  });

});
const WS_URL = 'wss://smartgrid.ifc.com.vn:6332';
const WS_RECONNECT_DELAY = 5000;

// FUNCTIONS
let ws = null;
let wsReady = false;
let wsReconnectTimer = null;

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`[WS] Creating client -> ${WS_URL}`);
  const socket = new WebSocket(WS_URL, { handshakeTimeout: 15000 });
  ws = socket;

  socket.on('open', () => {
    if (ws !== socket) return;
    wsReady = true;
    console.log(
        `[WS] CONNECTED
time=${new Date().toISOString()}
readyState=${socket.readyState}`
    );
  });

  socket.on('close', (code, reason) => {
    if (ws !== socket) return;
    wsReady = false;
    ws = null;
    console.warn(`[WS] CLOSED code=${code} reason=${reason.toString()}`);
    scheduleWebSocketReconnect();
  });

  socket.on('error', (err) => {

    console.error(`
================ WS ERROR ================
time       : ${new Date().toISOString()}
message    : ${err.message}
code       : ${err.code}
errno      : ${err.errno}
syscall    : ${err.syscall}
hostname   : ${err.hostname}
stack:
${err.stack}
==========================================
`);
    if (ws === socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
  });
}

function scheduleWebSocketReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, WS_RECONNECT_DELAY);
}

connectWebSocket();

function sendToWS(data) {
  if (wsReady && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    console.warn('WebSocket chưa sẵn sàng, không gửi được dữ liệu.');
  }
}




const data = {
  v_userid: 1,
};
let arr_ipAddresses = [];
const ipAddConnected = [];
const clients = [];
const connectionMap = new Map();

startAutoRefresh();
function startAutoRefresh() {
  // gọi lần đầu
  get_connect();
  // gọi định kỳ
  setInterval(() => {
    console.log("REFRESH DEVICE LIST...");
    get_connect();
  }, timer);
}

function deviceKey(device) {
  return `${device.ip}:${device.port}`;
}

function get_connect() {
  console.log("RELOAD DEVICE LIST...");

  axios.post("https://smartgrid.ifc.com.vn:6336/api/ds_thietbi_IEC_104", data)
    .then((res) => {
      const latestDevices = [];

      res.data.forEach((device) => {
        try {
          const obj = JSON.parse(device[0]);
          obj.index = 0;
          latestDevices.push(obj);
        } catch (e) {
          console.error("Parse error:", e);
        }
      });

      arr_ipAddresses = latestDevices;

      syncConnections(latestDevices);
    })
    .catch((err) => {
      console.error("get_connect error:", err);
    });
}

function syncConnections(latestDevices) {
  const latestKeys = new Set(latestDevices.map(deviceKey));

  // 1) add mới
  latestDevices.forEach((device) => {
    const key = deviceKey(device);
    const existing = connectionMap.get(key);

    if (!existing) {
      console.log(`ADD NEW DEVICE: ${key}`);
      connectToHardwareDevice(device);
      return;
    }

    // cập nhật lại metadata mới nhất nếu API đổi name/id_thietbi...
    existing.device = device;
  });

  // 2) remove device không còn tồn tại trong API
  for (const [key, conn] of connectionMap.entries()) {
    if (!latestKeys.has(key)) {
      console.log(`REMOVE DEVICE: ${key}`);
      destroyConnection(key, false); // false = không reconnect nữa
    }
  }
}


function connectToHardwareDevice(ipAddress) {
  const key = deviceKey(ipAddress);
  const existing = connectionMap.get(key);

  if (existing?.connecting) {
    console.log(`SKIP connecting, đang kết nối: ${key}`);
    return;
  }

  if (existing?.client && !existing.client.destroyed) {
    console.log(`SKIP connected: ${key}`);
    return;
  }

  const state = existing || {
    device:ipAddress,
    client: null,
    heartbeat: null,
    reconnectTimer: null,
    connecting: false,
  };

  state.device = ipAddress;
  state.connecting = true;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  connectionMap.set(key, state);

  const client = net.createConnection(
    { host: ipAddress.ip, port: ipAddress.port },
    () => {
      console.log(`Connected to ${key}`);
      if (state.client !== client) {
        client.destroy();
        return;
      }
      state.connecting = false;

      client.write(hexStringToByte("680407000000"));

      state.heartbeat = setInterval(() => {
        if (!client.destroyed) {
          client.write(hexStringToByte("680443000000"));
        }
      }, 20000);
    }
  );
  state.client = client;
  // Thiết lập timeout là 5 giây (5000ms)
  client.setTimeout(15000);

  client.on("timeout", () => {
    console.log(`Connection timed out: ${key}`);
    client.destroy();
  });


  client.on("data", (data) => {
    var checkData = getAckNrFromDeviceApdu(data);
    if (checkData.success && checkData.message != 'U-Frame parsed') {
      var tenthietbi = "";
      var idthietbi = "";
      for (k = 0; k < arr_ipAddresses.length; k++) {
        var info = arr_ipAddresses[k];
        if (info.ip == ipAddress.ip && info.port == ipAddress.port) {
          tenthietbi = arr_ipAddresses[k].name;
          idthietbi = arr_ipAddresses[k].id_thietbi;
        }
      }
      var result = parser.analyser(data.toString("hex"), tenthietbi, idthietbi);
      if (result.Data && result.Data.length > 0) {
        cambienQueue.add(
          { dataArray: result.Data },
          {
            jobId: `sensor-${Date.now()}`,
            attempts: 3, // Retry 3 lần nếu lỗi
            backoff: { type: "fixed", delay: 5000 }, // mỗi lần retry cách nhau 5s
          }
        );
	      console.log(result.Data);
        sendToWS(result.Data);
      }
      var supervisory = buildSFrame(checkData.data.ackNr);
      client.write(supervisory); //supervisory
    }
    else {
      var type_msg = getTypemsg(data.toString("hex"));
      switch (type_msg) {
        case "Test Frame Activation":
          //console.log('test frame ' + '=> 680483000000')
          client.write(hexStringToByte("680483000000"));
          break;
        case "Start Data Transfer Activation":
          //console.log('start data transfer ' + '=> 68040B000000')
          client.write(hexStringToByte("680e0000000064010601020000000014"));
          break;
        case "Stop Data Transfer Activation":
          //console.log('stop data transfer ' + '=> 680423000000')
          client.write(hexStringToByte("680423000000"));
          break;
      }
    }
  });
  client.on("close", () => {
    console.log(`Socket closed: ${key}`);
    if (state.client !== client) return;
    cleanupConnectionResources(key, client);
    // chỉ reconnect nếu device vẫn còn trong danh sách API hiện tại
    if (isDeviceStillActive(key)) {
      scheduleReconnect(key);
    } else {
      connectionMap.delete(key);
    }
  });
  client.on("end", () => {
    console.log(`Disconnected from ${key}`);
    if (!client.destroyed) client.destroy();
  });
  client.on("error", (err) => {
    console.error(`Socket error ${key}:`, err.message);
    if (!client.destroyed) client.destroy();
  });
}
function cleanupConnectionResources(key, client) {
  const state = connectionMap.get(key);
  if (!state) return;
  if (client && state.client !== client) return;

  state.connecting = false;

  if (state.heartbeat) {
    clearInterval(state.heartbeat);
    state.heartbeat = null;
  }

  state.client = null;
}
function scheduleReconnect(key, delay = 5000) {
  const state = connectionMap.get(key);
  if (!state) return;

  if (state.reconnectTimer) return;

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

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.heartbeat) {
    clearInterval(state.heartbeat);
    state.heartbeat = null;
  }

  const client = state.client;
  state.client = null;
  state.connecting = false;

  if (client && !client.destroyed) {
    client.destroy();
  }

  if (!shouldReconnect) {
    connectionMap.delete(key);
  }
}

function isDeviceStillActive(key) {
  return arr_ipAddresses.some((d) => deviceKey(d) === key);
}
function buildSFrame(ackNr) {
  const nr = ackNr & 0x7fff;
  const enc = nr << 1;

  const buf = Buffer.alloc(6);
  buf[0] = 0x68;
  buf[1] = 0x04;
  buf[2] = 0x01;
  buf[3] = 0x00;
  buf.writeUInt16LE(enc, 4); // C3,C4 carry N(R)<<1
  return buf;
}
function getAckNrFromDeviceApdu(apdu) {
  try {
    const b = Buffer.isBuffer(apdu)
      ? apdu
      : Buffer.from(String(apdu).replace(/\s+/g, ""), "hex");

    if (b.length < 6) {
      return { success: false, message: "APDU too short", data: null };
    }

    if (b[0] !== 0x68) {
      return { success: false, message: "Invalid IEC-104 start byte", data: null };
    }

    const len = b[1];
    const total = 2 + len;

    if (b.length < total) {
      return { success: false, message: "Truncated APDU", data: null };
    }

    const c1 = b[2];
    const c2 = b[3];
    const c3 = b[4];
    const c4 = b[5];

    const isI = (c1 & 0x01) === 0;
    const isS = (c1 & 0x03) === 0x01;
    const isU = (c1 & 0x03) === 0x03;

    if (isI) {
      const ns = (((c2 << 8) | c1) >> 1) & 0x7fff;
      const nr = (((c4 << 8) | c3) >> 1) & 0x7fff;
      const ackNr = (ns + 1) & 0x7fff;

      return {
        success: true,
        message: "I-Frame parsed",
        data: { isI, isS, isU, ns, nr, ackNr }
      };
    }

    if (isS) {
      const nr = (((c4 << 8) | c3) >> 1) & 0x7fff;

      return {
        success: true,
        message: "S-Frame parsed",
        data: { isI, isS, isU, nr, ackNr: nr }
      };
    }

    return {
      success: true,
      message: "U-Frame parsed",
      data: { isI, isS, isU }
    };

  } catch (err) {
    return {
      success: false,
      message: err.message,
      data: null
    };
  }
}
function getTypemsg(data) {
  var msgType = data.substr(4, 2);
  switch (msgType) {
    case "43":
      return "Test Frame Activation";
    case "0b":
      return "Start Data Transfer Activation";
    case "13":
      return "Stop Data Transfer Activation";
  }
}

function hexStringToByte(str) {
  if (!str) {
    return new Uint8Array();
  }

  var a = [];
  for (var i = 0, len = str.length; i < len; i += 2) {
    a.push(parseInt(str.substr(i, 2), 16));
  }

  return new Uint8Array(a);
}


