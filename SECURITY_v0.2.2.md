# HES_104 v0.2.2 - WebSocket Security Model

## Trust boundary

```text
Web App Backend                         HES_104
----------------                       ----------------
RSA PRIVATE KEY                        RSA PUBLIC KEY
User authentication                    Verify WS ticket
User/role/device ACL                    Enforce claims
Sign short-lived ticket   ---------->  Accept/reject handshake
```

Private key không được đặt trên HES và không được gửi tới browser.

## WS ticket bắt buộc

Algorithm duy nhất: `RS256`.

Claims bắt buộc/được kiểm tra:

- `sub`: user identity
- `iss`: đúng `WS_JWT_ISSUER`
- `aud`: chứa `WS_JWT_AUDIENCE`
- `iat`: thời điểm phát hành
- `exp`: thời điểm hết hạn
- `jti`: bắt buộc khi `WS_TICKET_SINGLE_USE=true`
- `permissions`: ví dụ `telemetry.read`, `control.execute`
- `devices`: device scope hoặc `*`

JWT header phải có:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "smartgrid-ws-2026-01"
}
```

HES chỉ chấp nhận đúng `kid` đã cấu hình.

## Ticket transport

Mặc định:

```env
WS_TICKET_TRANSPORT=protocol
WS_ALLOW_LEGACY_QUERY_TICKET=false
```

Browser mở socket bằng:

```js
new WebSocket(wsUrl, ['hes104-v1', `ticket.${ticket}`]);
```

Điều này tránh đưa bearer ticket vào URL. Reverse proxy vẫn phải tránh log toàn bộ `Sec-WebSocket-Protocol` header vì header này chứa ticket trong handshake.

## Authorization telemetry

Một client chỉ nhận telemetry khi đồng thời thỏa mãn:

```text
permission telemetry.read
AND deviceId thuộc ticket.devices
AND client đã SUBSCRIBE deviceId
```

HES không relay message giữa các WebSocket client.

## Authorization control

Control mặc định tắt:

```env
CONTROL_ENABLED=false
```

Khi bật, yêu cầu đồng thời:

- `control.execute`
- device nằm trong ticket scope
- IOA nằm trong `control-points.json`
- value hợp lệ theo min/max
- HES tự resolve IP/port/CA; browser không được chỉ định RTU endpoint

## RSA key requirements

- RSA public key tối thiểu 2048 bit; generator đi kèm dùng 3072 bit.
- Private key chỉ nằm trên Web App backend/key vault.
- Public key có thể nằm trên HES.
- Rotate key bằng `kid`: tạo pair mới, deploy public key + `kid` mới tới HES, rồi chuyển Web App sang ký bằng private key mới.

## Operational controls

v0.2.2 tiếp tục áp dụng:

- Origin allowlist
- payload limit
- connection/IP limit
- global client limit
- message rate limit
- heartbeat/ping-pong
- device subscription limit
- single-use `jti`
- session maximum age

## Không dùng login JWT trực tiếp

Login JWT của Web App không nên gửi trực tiếp cho HES. Web Backend nên exchange login session/JWT thành WS ticket riêng với:

- audience chỉ dành cho HES
- TTL 60-120 giây
- scope chỉ gồm device client đang cần xem
- permissions tối thiểu
- `jti` duy nhất
