# Triển khai khóa WebSocket Smartgrid / HES

## File cần chuyển

| Project | File | Quyền |
| --- | --- | --- |
| SMARTGRID_ | config/keys/webapp-ws-private.pem | 600, owner là user chạy Node |
| SMARTGRID_ | config/keys/webapp-ws-public.pem | Public key để đối chiếu |
| HES_104 | config/keys/webapp-ws-public.pem | Public key, user chạy Node đọc được |

Private key chỉ có trên Smartgrid. Thư mục config/keys không nằm trong public/.
Khóa Smartgrid bị loại khỏi Git nên phải chuyển riêng bằng kênh triển khai bảo mật.
Không tạo lại cặp khóa khi deploy; dùng cặp đang có. Public key phải được xuất
trực tiếp từ private key, không lấy từ một cặp khác.

## Smartgrid .env

```env
HES_WS_PRIVATE_KEY_PATH=./config/keys/webapp-ws-private.pem
HES_WS_JWT_KEY_ID=smartgrid-ws-2026-01
HES_WS_URL=wss://smartgrid.ifc.com.vn:6332/ws
```

LOGIN_JWT_SECRET là secret đăng nhập riêng, không sao chép sang HES.

## HES .env

```env
WS_JWT_PUBLIC_KEY_PATH=./config/keys/webapp-ws-public.pem
WS_JWT_KEY_ID=smartgrid-ws-2026-01
WS_JWT_ISSUER=smartgrid-web
WS_JWT_AUDIENCE=hes104-ws
WS_ALLOWED_ORIGINS=https://smartgrid.ifc.com.vn,http://localhost:6580,http://14.177.66.131:6580
WS_REQUIRE_ORIGIN=true
```

SSL_KEY_PATH / SSL_CERT_PATH là khóa và chứng chỉ TLS riêng; không đổi theo cặp JWT.
Origin phải khớp chính xác scheme, hostname và port của trang web đang mở.

## Kiểm tra trước khi deploy

Từ SMARTGRID_ chạy:

```sh
node scripts/check-hes-keys.js /duong/dan/HES_104
```

Script kiểm tra fingerprint và ký/xác thực bằng code HES, không in token hay private key.
Đường dẫn khóa tương đối được tính từ gốc từng project.
Sau khi chuyển file, khởi động lại Smartgrid và tiến trình HES thực tế để nạp khóa.
Nếu PM2 đã có biến môi trường cũ, cập nhật hoặc bỏ giá trị ghi đè: dotenv không
thay thế biến đã tồn tại trong process.env. Đặc biệt kiểm tra WS_ALLOWED_ORIGINS,
WS_JWT_PUBLIC_KEY_PATH và HES_WS_PRIVATE_KEY_PATH.

Kiểm tra offline đạt không đồng nghĩa server HES ở domain đã nạp file mới.
Không đưa các file backup public key cũ vào gói deploy.
