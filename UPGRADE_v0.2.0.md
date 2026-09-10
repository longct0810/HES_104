# HES_104 v0.2.0 - Upgrade Guide

## 1. Cài dependency

Bản v0.2.0 bổ sung `pg` và `dotenv`. File `package-lock.json` cũ của v0.1.0 không phản ánh dependency thực tế nên đã loại khỏi bản phát hành.

```bash
npm install
```

Sau khi cài xong nên commit `package-lock.json` mới được sinh trên môi trường của project.

## 2. Tạo `.env`

```bash
cp .env.example .env
```

Tối thiểu điền PostgreSQL:

```env
DB_USER=...
DB_PASS=...
DB_HOST=...
DB_PORT=5432
DB_NAME=...
```

Đảm bảo certificate thực tế tồn tại tại `SSL_KEY_PATH` và `SSL_CERT_PATH`.

## 3. Redis

Mặc định:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Không xóa Redis queue khi restart. Các job chưa xử lý sẽ được worker tiếp tục tiêu thụ.

## 4. Test trước khi chạy

```bash
npm test
```

Kỳ vọng toàn bộ test pass.

## 5. Chạy thủ công

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run worker
```

Terminal 3 (nếu dùng cleanup log):

```bash
npm run cleanup
```

## 6. Chạy bằng PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

Kiểm tra:

```bash
pm2 status
pm2 logs hes-iec104
pm2 logs hes-db-worker
```

## 7. Các điểm cần kiểm tra khi chạy thực tế

- RTU trả `STARTDT_CON` và HES gửi GI thành công.
- Không xuất hiện liên tục `[IEC104][SEQ] sequence gap`.
- Redis queue `waiting/failed` không tăng bất thường.
- `CAMBIEN_LOG.TIME` tăng theo dữ liệu mới, không bị quay ngược.
- WebSocket client nhận telemetry đúng format legacy.

## Lưu ý bảo mật

Bản release không chứa `.git`, certificate hoặc private key. Private key từng nằm trong Git history của v0.1.0 vẫn nên được rotate và purge khỏi repository gốc.
