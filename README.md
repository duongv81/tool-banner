# 🎮 Bộ Tạo Banner Kho Trang Phục Liên Quân Mobile 4K (GitHub Pages)

Công cụ tạo Banner kho trang phục Liên Quân Mobile theo chuẩn giải đấu chuyên nghiệp, xuất ảnh siêu nét 4K chạy **100% trên trình duyệt (Client-side HTML5 Canvas)**, không cần cài đặt Python hay bất kỳ server nào!

---

## 🚀 Hướng Dẫn Đẩy Lên GitHub Pages (Chỉ mất 1 phút)

### Bước 1: Tạo Repository Mới Trên GitHub
1. Đăng nhập vào tài khoản [GitHub.com](https://github.com/) của bạn.
2. Bấm nút **New** (Tạo repository mới).
3. Đặt tên repository (ví dụ: `lien-quan-banner` hoặc `tool-banner`).
4. Để chế độ **Public** và bấm **Create repository**.

### Bước 2: Tải Toàn Bộ Thư Mục Này Lên GitHub
#### Cách 1: Dùng GitHub Desktop (Khuyên dùng - Cực dễ, không cần gõ lệnh)
1. Tải và cài đặt [GitHub Desktop](https://desktop.github.com/).
2. Đăng nhập tài khoản GitHub.
3. Vào menu **File** -> **Add Local Repository...** -> chọn thư mục:
   `C:\Users\Administrator\Downloads\github tool`
4. Nếu hiện thông báo repository chưa được khởi tạo, bấm **Create a Repository** -> bấm **Create**.
5. Bấm nút **Publish repository** ở góc trên để đẩy toàn bộ lên GitHub.

#### Cách 2: Dùng Git Terminal (Dành cho ai đã cài Git CLI)
Mở **PowerShell** hoặc **Command Prompt** tại thư mục này và chạy:
```bash
git init
git add .
git commit -m "Khoi tao tool banner Lien Quan Mobile"
git branch -M main
git remote add origin https://github.com/<TEN_TAI_KHOAN_CUA_BAN>/<TEN_REPO>.git
git push -u origin main
```

### Bước 3: Kích Hoạt GitHub Pages Miễn Phí
1. Trên trang GitHub repository vừa tạo, vào mục **Settings** (ở thanh menu trên cùng).
2. Ở thanh bên trái, chọn mục **Pages**.
3. Tại phần **Build and deployment** -> **Branch**:
   - Chọn nhánh: **`main`**
   - Chọn thư mục: **`/(root)`**
4. Bấm **Save**.
5. Chờ khoảng 1-2 phút, GitHub sẽ hiển thị đường link trang web của bạn:
   👉 **`https://<TEN_TAI_KHOAN_CUA_BAN>.github.io/<TEN_REPO>/`**

Bạn có thể gửi link này cho bạn bè, khách hàng hoặc mở trực tiếp trên điện thoại (iPhone, iPad, Android) để tạo banner bất cứ lúc nào!

---

## ✨ Các Tính Năng Đã Tích Hợp Sẵn:
1. **Chạy 100% Client-side**: Toàn bộ dữ liệu 1,139 skin, 123 tướng và xử lý ảnh ghép 4K chạy trực tiếp trong trình duyệt, không cần máy chủ Python.
2. **Không Cần Cắt Ô Thông Số**: Tự động vẽ chuẩn icon Quân huy, Vàng, Ruby, Thẻ đổi tên, Số tướng, Số skin vào Hàng 2.
3. **Khối Lớn 2x2 Mặc Định**: Avatar và thông tin tài khoản hiển thị to rõ ở góc trên cùng.
4. **Bảng Chọn Skin Thông Minh**:
   - Tự động ẩn cột tướng trống khi lọc bậc (EVO, SSS...).
   - Chế độ Lưới Thẻ Nhanh (Gallery Grid) xem skin liền mạch.
   - Nạp tự động từ danh sách text (mỗi dòng 1 tên skin).
   - Tùy chỉnh thu phóng: 50%, 65% (mặc định), 80%, 100%.
5. **Tối Ưu 100% Cho Điện Thoại & Quay Ngang (Landscape)**: Tự động ẩn thanh tiêu đề shop khi chọn skin, tối đa diện tích xem.
6. **Xuất Ảnh 4K Trực Tiếp (HTML5 Canvas)**: Tự động cắt gọn các hàng trống (Auto-trim), ảnh xuất ra sắc nét chuẩn Ultra HD.
