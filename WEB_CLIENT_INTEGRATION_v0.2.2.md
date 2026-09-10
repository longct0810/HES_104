# Tích hợp Web App với HES_104 v0.2.2

Web App và HES là hai ứng dụng độc lập. Web App chịu trách nhiệm đăng nhập và phân quyền; HES chỉ verify ticket và enforce phạm vi đã được Web App ký.

## Luồng chuẩn

```text
Browser                         Web Backend                         HES
  |                                  |                              |
  |--- login / JWT hiện tại -------->|                              |
  |<-- login JWT/session ------------|                              |
  |                                  |                              |
  |--- POST /api/hes/ws-ticket ----->|                              |
  |    Authorization: login JWT      |                              |
  |    devices: [366621]             |                              |
  |                                  |-- kiểm tra ACL server-side   |
  |                                  |-- ký RS256 bằng PRIVATE key  |
  |<-- { ticket, wsUrl } ------------|                              |
  |                                                                 |
  |================ WSS handshake + ticket ========================>|
  |<================ READY =========================================|
  |--- SUBSCRIBE [366621] ----------------------------------------->|
  |<================ telemetry device 366621 =======================|
```

## Nguyên tắc quan trọng

1. Browser không giữ private key.
2. Browser không tự tạo WS ticket.
3. Browser có thể đề nghị `devices`, nhưng Web Backend phải kiểm tra quyền thật trong DB trước khi ký.
4. Ticket chỉ chứa device thực sự cần cho connection hiện tại để giảm scope và kích thước header.
5. Login JWT và WS ticket là hai token khác nhau.

## Web Backend - API cấp ticket

Ví dụ Express, giả sử middleware `requireLogin` đã verify JWT đăng nhập hiện tại và gắn `req.user`.

```js
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const router = express.Router();
const privateKey = fs.readFileSync(process.env.HES_WS_PRIVATE_KEY_PATH, 'utf8');

router.post('/api/hes/ws-ticket', requireLogin, async (req, res) => {
  const requested = Array.isArray(req.body.devices)
    ? [...new Set(req.body.devices.map(String))]
    : [];

  if (requested.length === 0 || requested.length > 100) {
    return res.status(400).json({ error: 'INVALID_DEVICE_SCOPE' });
  }

  // Hàm này phải query DB/phân quyền của Web App.
  const allowed = await getAllowedDeviceIds(req.user.id, requested);

  if (allowed.length !== requested.length) {
    return res.status(403).json({ error: 'DEVICE_FORBIDDEN' });
  }

  const ticket = jwt.sign(
    {
      role: req.user.role,
      permissions: ['telemetry.read'],
      devices: allowed,
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: process.env.HES_WS_JWT_KEY_ID,
      issuer: 'smartgrid-web',
      audience: 'hes104-ws',
      subject: String(req.user.id),
      jwtid: crypto.randomUUID(),
      expiresIn: '90s',
    }
  );

  res.json({
    ticket,
    wsUrl: 'wss://hes104.ifc.com.vn:6332/ws',
  });
});
```

Nếu Web App không dùng `jsonwebtoken`, có thể dùng helper RS256 tương đương trong `examples/web-backend-ticket-service.js` của release.

## Web App environment

Web App giữ private key:

```env
HES_WS_PRIVATE_KEY_PATH=/opt/webapp/keys/webapp-ws-private.pem
HES_WS_JWT_KEY_ID=smartgrid-ws-2026-01
```

Private key phải có permission filesystem chặt, ví dụ `chmod 600`.

## Frontend - lấy ticket bằng login JWT hiện tại

```js
async function getHesTicket(deviceIds) {
  const response = await fetch('/api/hes/ws-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJwt}`,
    },
    body: JSON.stringify({ devices: deviceIds }),
  });

  if (!response.ok) {
    throw new Error(`Cannot get HES ticket: ${response.status}`);
  }

  return response.json();
}
```

## Frontend - connect HES

```js
async function connectHes(deviceIds) {
  const { ticket, wsUrl } = await getHesTicket(deviceIds);

  const ws = new WebSocket(wsUrl, [
    'hes104-v1',
    `ticket.${ticket}`,
  ]);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg?.type === 'READY') {
      ws.send(JSON.stringify({
        type: 'SUBSCRIBE',
        devices: deviceIds,
      }));
      return;
    }

    if (Array.isArray(msg)) {
      // [[ten_thietbi, id_thietbi, ioa, value, time], ...]
      handleTelemetry(msg);
    }
  };

  return ws;
}
```

## Reconnect

WS ticket là single-use. Khi socket mất kết nối hoặc HES yêu cầu renew session, không dùng lại ticket cũ.

```text
socket close
   -> gọi /api/hes/ws-ticket lần nữa
   -> nhận ticket mới
   -> connect mới
   -> SUBSCRIBE lại
```

Nên dùng exponential backoff cho reconnect và không retry liên tục khi backend trả 401/403.

## Origin trên HES

Nếu Web App chạy tại:

```text
https://smartgrid.ifc.com.vn
```

thì HES cấu hình:

```env
WS_ALLOWED_ORIGINS=https://smartgrid.ifc.com.vn
```

Origin được browser gửi tự động trong WebSocket handshake.

## Reverse proxy

Nếu HES đi qua Nginx, proxy phải forward WebSocket Upgrade và không log `Sec-WebSocket-Protocol` vì header này chứa ticket ngắn hạn.

## Control

Chưa nên cấp `control.execute` cho browser ở giai đoạn tích hợp telemetry. Giữ:

```env
CONTROL_ENABLED=false
```

Khi triển khai control, backend chỉ cấp permission này cho đúng role và HES vẫn kiểm tra IOA whitelist riêng.
