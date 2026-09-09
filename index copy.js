const net = require("net");
const http = require("http");
const parser = require("./analyser.js");
const timer = 5000000;
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

var WebSocketServer = require('ws').Server;
const wss = new WebSocket.Server({ port: 6408 });

wss.on('connection', function connection(ws) {
  // Send a message to the client
  ws.on('message', (message) => {
    // Broadcast message to all connected clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});
const ws = new WebSocket('ws://localhost:6408');

// FUNCTIONS
let wsReady = false;
ws.on('open', () => {
  wsReady = true;
});

function sendToWS(data) {
  if (wsReady && ws.readyState === WebSocket.OPEN) {
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

  axios.post("https://ifcami.npc.com.vn/api/ds_thietbi_IEC_104", data)
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
      state.connecting = false;
      state.client = client;

      client.write(hexStringToByte("680407000000"));

      client.heartbeat = setInterval(() => {
        if (!client.destroyed) {
          client.write(hexStringToByte("680443000000"));
        }
      }, 20000);
    }
  );
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
    cleanupConnectionResources(key);
    // chỉ reconnect nếu device vẫn còn trong danh sách API hiện tại
    if (isDeviceStillActive(key)) {
      scheduleReconnect(key);
    } else {
      connectionMap.delete(key);
    }
  });
  client.on("end", () => {
    console.log(`Disconnected from ${key}`);
  });
  client.on("error", (err) => {
    console.error(`Socket error ${key}:`, err.message);
  });
}
function cleanupConnectionResources(key) {
  const state = connectionMap.get(key);
  if (!state) return;

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
function getD2(str) {
  str = str.toString();
  return str.length < 2 ? getD2("0" + str, 2) : str;
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

function byteToHexString(uint8arr) {
  if (!uint8arr) {
    return '';
  }

  var hexStr = '';
  for (var i = 0; i < uint8arr.length; i++) {
    var hex = (uint8arr[i] & 0xff).toString(16);
    hex = (hex.length === 1) ? '0' + hex : hex;
    hexStr += hex + " ";
  }

  return hexStr.toUpperCase();
}
