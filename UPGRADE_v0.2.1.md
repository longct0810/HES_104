> Historical document for v0.2.1. Current security model: `SECURITY_v0.2.2.md`.

# HES_104 v0.2.1 - WebSocket Security Hotfix

## 1. Mục tiêu

v0.2.1 khóa bề mặt WebSocket của HES. Từ phiên bản này, việc mở được TCP/HTTPS port 6332 không đồng nghĩa với việc được nhận telemetry hoặc gửi command.

Luồng mới:

```text
Browser -> Web Backend đã đăng nhập -> phát JWT WebSocket ticket
                                      |
Browser ------------------------------+--> wss://HES:6332/ws?ticket=...
                                             |
                                             +-- verify signature / iss / aud / age / exp / jti
                                             +-- Origin allowlist
                                             +-- permissions + device scope
                                             +-- SUBSCRIBE device
                                             +-- telemetry đã lọc
```

## 2. Cấu hình bắt buộc trên HES

Copy `.env.example` thành `.env` và cấu hình ít nhất:

```env
WS_HOST=0.0.0.0
WS_PORT=6332
WS_PATH=/ws

WS_JWT_SECRET=<random-secret-at-least-32-characters>
WS_JWT_ISSUER=smartgrid-web
WS_JWT_AUDIENCE=hes104-ws
WS_JWT_MAX_AGE_SEC=120
WS_JWT_CLOCK_TOLERANCE_SEC=5
WS_TICKET_SINGLE_USE=true

WS_REQUIRE_ORIGIN=true
WS_ALLOWED_ORIGINS=https://smartgrid.ifc.com.vn
```

Sinh secret mạnh bằng Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`WS_JWT_SECRET` phải giống nhau giữa Web Backend phát ticket và HES verify ticket. Không gửi secret này xuống browser.

## 3. Ticket do Web Backend phát, không phải browser tự tạo

Ticket tối thiểu:

```json
{
  "sub": "123",
  "role": "viewer",
  "permissions": ["telemetry.read"],
  "devices": [366621, 366643],
  "iss": "smartgrid-web",
  "aud": "hes104-ws",
  "iat": 1788940000,
  "exp": 1788941800,
  "jti": "unique-random-id"
}
```

Quyền quan trọng:

- `telemetry.read`: được subscribe/nhận telemetry.
- `control.execute`: được gửi yêu cầu CONTROL, nhưng vẫn phải qua device scope và control-point whitelist.

`role` chỉ là metadata. HES quyết định quyền bằng `permissions`, không tin tên role.

**Không lấy danh sách `devices` từ request body của browser.** Web Backend phải tự truy vấn quyền của user trong DB/session và nhúng đúng device scope vào ticket.

Có thể tham khảo `examples/create-ws-ticket.js` để tạo JWT HS256 tương thích HES.

## 4. Ticket freshness và thời gian sống kết nối

`WS_JWT_MAX_AGE_SEC=120` nghĩa là ticket mới phát phải được dùng để handshake trong tối đa 120 giây.

`exp` quyết định thời điểm connection phải kết thúc. Ví dụ ticket có thể được phát với `exp` sau 30 phút; khi hết 30 phút HES tự đóng socket. Khi reconnect, frontend phải gọi Web Backend để lấy ticket mới.

Với `WS_TICKET_SINGLE_USE=true`, một `jti` đã dùng sẽ không thể dùng lại cho connection thứ hai.

## 5. Frontend kết nối

Sau khi frontend gọi Web Backend và nhận ticket:

```js
const ws = new WebSocket(
  `wss://smartgrid.ifc.com.vn:6332/ws?ticket=${encodeURIComponent(ticket)}`
);

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'READY') {
    ws.send(JSON.stringify({
      type: 'SUBSCRIBE',
      devices: [366621]
    }));
    return;
  }

  // Telemetry vẫn giữ format legacy array:
  // [[ten_thietbi, id_thietbi, IOA, value, time], ...]
});
```

Một client chỉ nhận telemetry khi đồng thời thỏa cả 3 điều kiện:

1. JWT có `telemetry.read`.
2. `deviceId` nằm trong claim `devices`.
3. Client đã gửi `SUBSCRIBE` device đó.

## 6. Không còn client-to-client broadcast

Các message tùy ý từ client sẽ bị trả:

```json
{
  "type": "ERROR",
  "code": "UNSUPPORTED_MESSAGE_TYPE"
}
```

HES không còn chuyển message từ WebSocket client này sang client khác.

## 7. Control mặc định bị khóa

v0.2.1 mặc định:

```env
CONTROL_ENABLED=false
```

Đây là fail-safe. Telemetry vẫn hoạt động nhưng mọi CONTROL bị từ chối.

Khi thực sự cần điều khiển:

```bash
cp config/control-points.example.json config/control-points.json
nano config/control-points.json
```

Ví dụ:

```json
{
  "366621": {
    "5001": {
      "type": "C_SE_NC_1",
      "min": 0,
      "max": 100,
      "commonAddress": 2
    }
  }
}
```

Sau khi kiểm tra chính xác control point mới bật:

```env
CONTROL_ENABLED=true
CONTROL_POINTS_PATH=./config/control-points.json
```

File runtime `config/control-points.json` đã được `.gitignore`; chỉ file example được commit/phân phối.

## 8. Payload CONTROL mới

Không còn gửi IP/port:

```json
{
  "type": "CONTROL",
  "requestId": "cmd-001",
  "deviceId": 366621,
  "ioa": 5001,
  "value": 10.5
}
```

HES kiểm tra theo thứ tự:

```text
JWT hợp lệ
  -> control.execute
  -> deviceId thuộc scope
  -> device tồn tại trong registry HES
  -> IOA nằm trong control-points whitelist
  -> value nằm trong min/max
  -> HES tự lấy IP/port/CA
  -> tạo IEC-104 command session
```

Payload legacy sau bị khóa:

```json
{
  "type": "DIEUKHIEN",
  "Data": [["192.168.1.1", 2404, 5001, 10.5]]
}
```

## 9. Giới hạn chống abuse

Các giá trị mặc định:

```env
WS_MAX_PAYLOAD_BYTES=65536
WS_HEARTBEAT_MS=30000
WS_MAX_MESSAGES_PER_MINUTE=120
WS_MAX_SUBSCRIPTIONS=1000
WS_MAX_CLIENTS=200
WS_MAX_CONNECTIONS_PER_IP=5
WS_TRUST_PROXY_IPS=
```

Điều chỉnh theo tải thực tế sau benchmark.

## 10. Reverse proxy / firewall

Khuyến nghị không public trực tiếp port HES nếu không cần thiết. Tốt nhất:

```text
Internet -> Nginx/Web Gateway -> HES private IP:6332
```

Firewall chỉ cho reverse proxy/web server truy cập port HES.

Nếu Nginx proxy WebSocket, lưu ý query `?ticket=...` có thể xuất hiện trong access log mặc định. Nên tắt/mask query string đối với `/ws`, vì ticket dù dùng một lần vẫn là credential ngắn hạn.

HES không bao giờ dùng IP/X-Forwarded-For để authorization; JWT vẫn là authority. Nếu cần rate-limit theo IP thật sau Nginx, chỉ khai báo IP reverse proxy do anh kiểm soát trong `WS_TRUST_PROXY_IPS`. HES chỉ đọc `X-Forwarded-For` khi TCP peer nằm trong allowlist proxy này. Firewall vẫn nên chặn mọi nguồn khác truy cập trực tiếp port HES.

## 11. Kiểm thử trước deploy

```bash
npm test
```

Expected v0.2.1:

```text
31 tests
31 pass
0 fail
```

Có thể tạo ticket demo:

```bash
npm run ticket:demo
```

## 12. Giới hạn còn lại

`CONTROL_ACCEPTED` chỉ có nghĩa HES đã chấp nhận request và bắt đầu command session. v0.2.1 chưa coi đó là xác nhận RTU đã thực thi lệnh.

Các phần nên làm ở v0.3.0:

- IEC-104 command state machine đầy đủ.
- Chờ STARTDT CON thay vì delay cố định.
- Activation Confirmation / Negative Confirmation / Activation Termination.
- Select-before-operate nếu RTU yêu cầu.
- Audit command vào PostgreSQL.
- Command idempotency / duplicate protection.
