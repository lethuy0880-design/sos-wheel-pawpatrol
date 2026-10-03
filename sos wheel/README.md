# SOS Wheel

Nền tảng web cứu hộ xe lưu động 24/7, giao diện tiếng Việt, xây dựng với FastAPI, SQLAlchemy, SQLite, Jinja2, Tailwind CDN, JavaScript thuần và Leaflet/OpenStreetMap.

## Chạy ứng dụng

Yêu cầu Python 3.10 trở lên.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Mở http://127.0.0.1:8000. Schema và dữ liệu demo được tạo tự động lúc khởi động. Cần kết nối Internet để tải Tailwind, Leaflet, font và bản đồ OSM.

## Tài khoản demo

- Admin: `admin` / `admin123`
- Thợ đã duyệt: `0900000001`, `0900000002` hoặc `0900000003` / `soswheel123`
- Thợ đăng ký mới sẽ ở trạng thái chờ duyệt.

Đổi `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DEMO_MECHANIC_PASSWORD` và `SOSWHEEL_SECRET` trước khi triển khai. `SOSWHEEL_SECRET` mặc định chỉ dành cho phát triển. Có thể đặt `DATABASE_URL` sang PostgreSQL, ví dụ `postgresql+psycopg://...` và cài driver phù hợp.

## Luồng chính

- Khách bật định vị, chọn sự cố hoặc chạy wizard, xem giá ước tính và gửi yêu cầu đến thợ gần nhất.
- Đơn có token riêng cho khách và share token ngẫu nhiên. Trang chia sẻ chỉ lộ vị trí khi pending; danh tính và số điện thoại thợ chỉ hiển thị sau khi đã nhận đơn.
- Khách theo dõi trạng thái mỗi 7 giây, xác nhận phí phát sinh và đánh giá sau hoàn thành.
- Thợ đăng ký/đăng nhập, cập nhật trạng thái sẵn sàng kèm GPS, nhận đơn được gửi riêng và cập nhật tiến trình.
- Admin duyệt thợ và xem analytics tổng hợp bằng pandas.
- Tìm trạm xăng dùng Overpass API; bản đồ đường phố dùng OpenStreetMap.

## Cấu hình phí mặc định

Thiết lập mặc định nằm trong `main.py`: phí cơ bản 15.000đ, 2 km đầu, 5.000đ mỗi km vượt mức, hệ số quãng đường 1,3, bán kính tìm thợ 200 km (phục vụ kiểm thử), giá xăng 25.000đ/lít và lượng xăng mặc định 2 lít.

Đây là bộ khởi đầu demo. Trước khi dùng thực tế nên bổ sung rate limiting, HTTPS, quản lý secret, chính sách lưu/xóa vị trí, kiểm thử tích hợp, thông báo realtime và cấu hình phí vận hành theo khu vực.
