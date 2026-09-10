# Changelog

## v0.2.2 - 2026-09-10 - RS256 WebSocket Trust Boundary Hardening

- Thay HS256 shared secret bằng RS256: Web App giữ private key, HES chỉ giữ public key.
- Bắt buộc RSA public key >= 2048 bit và `WS_JWT_KEY_ID`.
- Verify `alg`, `kid`, `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, permissions và device scope.
- Chuyển WS ticket khỏi query string sang `Sec-WebSocket-Protocol` mặc định.
- Legacy `?ticket=` bị tắt mặc định; chỉ có cờ migration riêng.
- Tách ticket handshake TTL khỏi WebSocket session lifetime.
- Bổ sung generator RSA 3072 bit, ví dụ Web Backend và hướng dẫn tích hợp Web Client.
- Tiếp tục giữ subscription/device authorization/control whitelist của v0.2.1.
- Automated tests: 38/38 pass.

## v0.2.1 - 2026-09-09

### WebSocket Security Hotfix

- WebSocket chuyển từ `verifyClient: done(true)` sang secure `HTTP Upgrade` gateway, fail-closed.
- Bắt buộc JWT HS256 hợp lệ trước khi nâng cấp kết nối WebSocket.
- JWT bắt buộc có `sub`, `iat`, `exp`, device scope; hỗ trợ `permissions`, `role`, `jti`.
- Kiểm tra cố định `issuer`, `audience`, maximum ticket age và clock tolerance.
- `WS_TICKET_SINGLE_USE=true` mặc định: `jti` chỉ được dùng một lần để handshake.
- Socket tự đóng khi `exp` của ticket hết hạn.
- Bắt buộc Origin allowlist theo `WS_ALLOWED_ORIGINS` khi `WS_REQUIRE_ORIGIN=true`.
- WebSocket chuyển sang path riêng mặc định `/ws`.
- Thêm giới hạn payload, số client, số connection/IP, message rate và heartbeat/ping-pong.
- Bỏ hoàn toàn relay message tùy ý từ client A sang client B.
- Telemetry không còn broadcast toàn bộ: client phải có `telemetry.read`, device nằm trong JWT scope và đã `SUBSCRIBE` device đó.
- `SUBSCRIBE` ngoài device scope bị reject toàn bộ.
- Nhánh điều khiển legacy `DIEUKHIEN` bị vô hiệu hóa.
- Command mới chỉ nhận `deviceId`, `ioa`, `value`; client không còn được truyền `IP`, `port`, Common Address.
- HES tự resolve IP/port từ device registry do HES lấy từ API.
- Control bắt buộc `control.execute`, device scope và IOA whitelist.
- Control policy hỗ trợ min/max value và Common Address theo từng control point.
- `CONTROL_ENABLED=false` mặc định; thiếu policy => deny-all control.
- Thêm 15 test bảo mật WebSocket/JWT/subscription/control; tổng test hiện tại 31/31 pass.
- Không thêm dependency JWT ngoài: verifier/signing HS256 sử dụng `crypto` chuẩn của Node.js.

### Breaking changes

- Client cũ kết nối trực tiếp `wss://host:6332` không có ticket sẽ bị từ chối.
- URL mặc định mới: `wss://host:6332/ws?ticket=<JWT>`.
- Client phải gửi `SUBSCRIBE` trước khi nhận telemetry.
- Message `DIEUKHIEN` dạng `[ip, port, ioa, value]` không còn được chấp nhận.

## v0.2.0 - 2026-09-09

### IEC-104 Core Reliability Hardening

- Thêm receive buffer theo từng TCP connection để xử lý đúng fragmentation/coalescing.
- Tách APCI parser và quản lý N(S)/N(R), ACK S-frame, duplicate/gap/wrap sequence.
- General Interrogation sử dụng send/receive sequence hiện tại và Common Address cấu hình được.
- Viết lại ASDU parser theo offset an toàn; sửa lỗi bỏ byte ở SQ=0/SQ=1.
- Sửa M_SP_TA_1 / CP24Time2a về đúng 3 byte timestamp.
- Bổ sung parse nhóm monitoring type 1-16, 21, 30-37, gồm CP56Time2a.
- Parser phát hiện truncated ASDU thay vì đọc lệch dữ liệu.
- Fix WebSocket `request is not defined` và bắt lỗi JSON malformed.
- Realtime telemetry broadcast trực tiếp từ WSS server, bỏ loopback WSS client phụ thuộc public DNS.
- Job Bull dùng UUID, có retry/retention rõ ràng.
- Worker không còn `obliterate()` Redis queue khi khởi động.
- Worker chỉ bắt đầu consume sau khi PostgreSQL pool sẵn sàng.
- Worker concurrency mặc định = 1 để giữ thứ tự realtime an toàn.
- PostgreSQL writer chuyển sang batch `UNNEST` và chỉ update khi timestamp mới không cũ hơn dữ liệu hiện tại.
- Thêm `pg` vào dependencies và chuẩn hóa cấu hình bằng `.env.example`.
- Loại credentials DB khỏi source/config mặc định.
- Mở rộng `.gitignore` cho certificate/private key và `.log.gz`.
- Sửa đường dẫn `config.txt` của log cleaner theo `__dirname`.
- Thêm PM2 `ecosystem.config.js` cho HES, DB worker và log cleaner.
- Thêm automated tests cho frame buffer, APCI, ASDU và sequence state.

### Giữ nguyên trong v0.2.0

- Output telemetry vẫn giữ format legacy: `[ten_thietbi, id_thietbi, IOA, value, time]`.
- `IOA` vẫn được dùng trực tiếp làm `ID_CAMBIEN`.
- `CAMBIEN_LOG` vẫn là current-state upsert.
- Logic điều khiển `DIEUKHIEN` giữ tương thích v0.1.0; hardening auth/authorization và command confirmation dành cho v0.3.0.
