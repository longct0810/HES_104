# HES_104 v0.2.2 - Upgrade Guide

## Mục tiêu

v0.2.2 thay trust boundary của WebSocket từ shared-secret HS256 sang RSA RS256.

- Web App giữ **private key** và ký WS ticket.
- HES chỉ giữ **public key** và verify.
- WS ticket mặc định được truyền qua `Sec-WebSocket-Protocol`, không nằm trên query string.
- Ticket ngắn hạn chỉ dùng cho handshake; WebSocket session có lifetime riêng.

## 1. Không copy private key vào HES

RSA key pair phải được tạo trên Web App server hoặc máy quản trị key.

Có thể dùng script đi kèm:

```bash
node scripts/generate-ws-rsa-keypair.js /secure/hes-ws-key
```

Kết quả:

```text
webapp-ws-private.pem   -> chỉ Web App được giữ
webapp-ws-public.pem    -> copy sang HES
```

Copy public key sang HES, ví dụ:

```text
/opt/hes104/keys/webapp-ws-public.pem
```

## 2. Cấu hình HES

```env
WS_JWT_PUBLIC_KEY_PATH=/opt/hes104/keys/webapp-ws-public.pem
WS_JWT_ISSUER=smartgrid-web
WS_JWT_AUDIENCE=hes104-ws
WS_JWT_KEY_ID=smartgrid-ws-2026-01
WS_TICKET_MAX_AGE_SEC=120
WS_JWT_CLOCK_TOLERANCE_SEC=5
WS_TICKET_SINGLE_USE=true
WS_TICKET_TRANSPORT=protocol
WS_ALLOW_LEGACY_QUERY_TICKET=false
WS_SESSION_MAX_AGE_SEC=3600
WS_REQUIRE_ORIGIN=true
WS_ALLOWED_ORIGINS=https://smartgrid.ifc.com.vn
```

`WS_JWT_PUBLIC_KEY_PATH`, issuer, audience, key id và allowed origins là cấu hình bảo mật bắt buộc.

## 3. Kiểm thử

```bash
npm install
npm test
```

## 4. Restart

Nếu dùng PM2:

```bash
pm2 restart hes-iec104 --update-env
pm2 restart hes-db-worker --update-env
pm2 status
```

## 5. Breaking change so với v0.2.1

Client v0.2.1 kiểu:

```text
wss://hes:6332/ws?ticket=<JWT>
```

sẽ bị từ chối mặc định.

Client v0.2.2 phải dùng:

```js
new WebSocket('wss://hes:6332/ws', [
  'hes104-v1',
  `ticket.${ticket}`,
]);
```

Có thể bật tạm `WS_ALLOW_LEGACY_QUERY_TICKET=true` trong thời gian migrate, nhưng không khuyến nghị để lâu.

## 6. Ticket và session

`WS_TICKET_MAX_AGE_SEC=120` chỉ giới hạn WS ticket dùng để mở connection. Ticket không phải session token lâu dài.

`WS_SESSION_MAX_AGE_SEC=3600` giới hạn tuổi thọ connection. Khi hết thời gian, HES đóng socket với reason `Session renewal required`; Web Client phải xin ticket mới rồi reconnect + subscribe lại.
