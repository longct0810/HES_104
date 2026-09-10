> Historical document for v0.2.1. Current security model: `SECURITY_v0.2.2.md`.

# Security model - WebSocket v0.2.1

## Trust boundaries

- Browser là untrusted input.
- JWT chỉ được phát bởi authenticated Web Backend.
- HES không tin IP/port/CA/permission do browser khai báo.
- Device registry của HES và control-point policy là authority cho RTU endpoint/control IOA.

## Authorization formula

Telemetry được gửi khi:

```text
valid-ticket
AND telemetry.read
AND device-in-ticket-scope
AND device-in-client-subscription
```

Control được chấp nhận khi:

```text
CONTROL_ENABLED
AND valid-ticket
AND control.execute
AND device-in-ticket-scope
AND device-in-HES-registry
AND IOA-in-control-whitelist
AND value-in-range
```

## Fail-closed defaults

- Không có JWT secret hợp lệ => HES không start WebSocket gateway.
- Require Origin nhưng allowlist rỗng => HES không start.
- Ticket sai/expired/too-old => HTTP upgrade 401.
- Origin sai => HTTP upgrade 403.
- Chưa SUBSCRIBE => không nhận telemetry.
- Không có control policy => deny-all CONTROL.
- `CONTROL_ENABLED=false` mặc định.
- Legacy `DIEUKHIEN` bị reject.
- Unknown client message không được relay.

## Reverse proxy

`X-Forwarded-For` chỉ được đọc khi TCP peer nằm trong `WS_TRUST_PROXY_IPS`; header này không được dùng để cấp quyền, chỉ dùng cho logging/rate-limit.
