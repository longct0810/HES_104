# Whitelist điều khiển từ PostgreSQL

HES đọc `public.hes_control_points` mỗi lần nhận CONTROL. Không dùng JSON và không cache whitelist. Thiếu cấu hình, mất kết nối hoặc chưa có bảng: từ chối với `CONTROL_POLICY_UNAVAILABLE`. Điểm chưa khai báo hoặc `enabled=false`: `IOA_FORBIDDEN`.

## Áp dụng trên máy HES

1. Cấu hình `.env`: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` cho database chứa whitelist.
2. Chạy `node scripts/migrate-control-points.js` trong thư mục HES. Script tạo bảng và thêm IOA 1/2/3/4 của RMU 366502 (C_SC_NA_1, value=1); giữ nguyên các điểm đã tồn tại.
3. Tài khoản HES cần quyền SELECT trên bảng. Có thể chạy migration bằng tài khoản quản trị trước, rồi dùng tài khoản chỉ đọc cho HES.
4. Triển khai mã HES mới và chạy `pm2 restart hes-iec104 --update-env`.

Các điểm từ whitelist JSON cũ cần chuyển vào bảng trước khi triển khai. Migration chỉ thêm bốn điểm RMU đã yêu cầu, không nhập tự động các quyền khác.

## Cập nhật mà không sửa code hoặc restart

```sql
-- Khóa ngay điểm OFF.
UPDATE public.hes_control_points SET enabled = false
WHERE device_id = '366502' AND ioa = 2;

-- Bật lại.
UPDATE public.hes_control_points SET enabled = true
WHERE device_id = '366502' AND ioa = 2;

-- Xem cấu hình.
SELECT * FROM public.hes_control_points WHERE device_id = '366502';
```

`common_address=NULL` dùng CA của thiết bị trong registry. Whitelist không thay thế quyền `control.execute`, phạm vi thiết bị trong ticket hoặc điều kiện REMOTE trên web. HES chấp nhận lệnh không đồng nghĩa thiết bị đã thực hiện thành công.
