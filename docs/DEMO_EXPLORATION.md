# Kịch bản demo khám phá dữ liệu Pythera BI POC

**Người trình bày:** Nguyễn Thanh Phong, đại diện nhóm.  
**Thời lượng:** khoảng 10–12 phút; có thể bỏ phần tùy chọn để rút ngắn.  
**Mục tiêu:** trình bày phần dữ liệu và chất lượng do Phong hoàn thiện, nối với engine thống kê của Tú và giao diện/dashboard của Thanh.

Chỉ đọc phần **Lời nói**. Phần **Thao tác** và **Đối chiếu** dùng để nhìn và thực hiện. Dùng dữ liệu giả lập, không đọc số liệu của file 12 dòng hoặc 500.000 dòng vào kịch bản này.

## Chuẩn bị

- Web: http://127.0.0.1:8081/; đăng nhập admin bằng tài khoản demo trong README. Dịch vụ Python chạy ở cổng 8000, không cần mở pgAdmin.
- File chính: `D:\SE01C\TT\ThucTap\bi-poc\demo\exploration_dirty_242.csv`.
- Khi nhập mới, đặt tên `Demo khám phá dữ liệu bẩn`. Chọn dataset có hậu tố **Dữ liệu CSV**, không chọn **Theo tháng** để phân tích dữ liệu gốc.
- File cố ý có 242 dòng, 10 cột dữ liệu; 3 ô thiếu ban đầu, 3 ô sai kiểu, 2 dòng trùng dư và một giá trị revenue ngoại lệ 999999.
- Sau nhập, có 6 ô thiếu vì 3 ô sai kiểu chuyển NULL. Revenue có 238 giá trị hợp lệ, tổng 1.079.769, mean khoảng 4.536,844538, median 340.
- Đóng cửa sổ chứa API key/.env và tắt thông báo riêng tư. Chờ kết quả từng thao tác, không gửi lặp lúc AI đang phân tích.

## 1. Mở đầu và cách phân chia công việc — 40 giây

**Thao tác:** mở Tổng quan và giới thiệu menu **Khám phá dữ liệu**, **Chat AI**, **Dashboards**.

**Lời nói:**

> Dạ em chào anh. Em xin demo bản POC sau khi nhóm mở rộng theo roadmap khám phá dữ liệu.
>
> Phần em phụ trách là tổng quan, profiling, chất lượng dữ liệu và tích hợp API. Tú phụ trách engine thống kê và AI, Thanh phụ trách giao diện khám phá cùng dashboard. Nhóm đã ghép các phần để chạy trên cùng dataset thật.
>
> Em sẽ dùng một file giả lập có dữ liệu thiếu, sai kiểu, trùng lặp và một ngoại lệ để trình bày kết quả xử lý và phân tích.

## 2. Nhập file có dữ liệu bẩn — 1 phút

**Thao tác:**

1. Vào **Tải file & phân tích**, chọn `exploration_dirty_242.csv`.
2. Đặt tên `Demo khám phá dữ liệu bẩn`, bấm **Nhập file và tạo dashboard**.
3. Chỉ vào 242 dòng, 3 ô trống, 3 ô sai kiểu và ví dụ lỗi số/ngày trong báo cáo nhập.

**Lời nói:**

> File này có các trường ngày, chi nhánh, danh mục, doanh thu, chi phí và dữ liệu trước sau để thử thống kê.
>
> Khi nhập, hệ thống phát hiện 3 ô thiếu và 3 ô sai kiểu. Những ô không hợp lệ chuyển thành NULL theo quy tắc nhập hiện tại; hệ thống giữ nguyên số dòng và lưu riêng thông tin lỗi lúc nhập.
>
> Phần này giúp biết đầu vào có vấn đề gì. Hệ thống chưa tự điền dữ liệu thiếu hoặc xóa dòng trùng.

## 3. Tổng quan và chất lượng dữ liệu — 1 phút

**Thao tác:**

1. Vào **Khám phá dữ liệu**, chọn **Demo khám phá dữ liệu bẩn · Dữ liệu CSV · Vật lý**.
2. Tab **Tổng quan**: chỉ số dòng 242, số cột dữ liệu 10, kiểu dữ liệu và dung lượng logic.
3. Tab **Dữ liệu thiếu** hoặc **Profiling**: xem số thiếu, tỷ lệ thiếu và số giá trị duy nhất từng cột.
4. Tab **Chất lượng**: chỉ **Ô thiếu 6**, **Dòng trùng dư 2** và lịch sử nhập **3 ô thiếu / 3 ô sai kiểu**.

**Lời nói:**

> Báo cáo này tính trên toàn bộ dataset, không chỉ các dòng xem trước. Cột định danh do hệ thống tạo không được tính là cột dữ liệu trong báo cáo CSV.
>
> Cần phân biệt chất lượng lúc nhập với chất lượng hiện tại. Lúc nhập có 3 ô thiếu và 3 ô sai kiểu; sau khi chuyển giá trị sai thành NULL, báo cáo hiện tại có 6 ô thiếu.
>
> Hệ thống phát hiện 2 dòng trùng dư bằng cách so các cột dữ liệu, không so cột ID tự sinh. Các dòng trùng vẫn được giữ để người dùng quyết định cách xử lý. Dung lượng hiển thị là dung lượng logic PostgreSQL, không phải kích thước file gốc.

## 4. Thống kê mô tả và phát hiện ngoại lệ — 1 phút

**Thao tác:**

1. Tab **Thống kê cột**, chọn `c_revenue`: xem mean, median, min/max, phương sai, độ lệch chuẩn, quartiles và histogram.
2. Ở phần **Phân tích nâng cao**, chọn **Phát hiện ngoại lệ**, cột `c_revenue`, phương pháp **IQR**.
3. Bấm **Chạy phân tích thống kê**; chỉ một ngoại lệ có giá trị **999999**.

**Đối chiếu:** revenue có 238 giá trị hợp lệ; mean khoảng 4536,844538, median 340; IQR phát hiện 1 ngoại lệ, ngưỡng dưới −165 và trên 835.

**Lời nói:**

> Với cột doanh thu, người dùng có thể xem thống kê mô tả và phân phối. Trong file giả lập này em có đặt một giá trị rất lớn là 999999, nên mean cao hơn median khá nhiều.
>
> Em dùng IQR để kiểm tra ngoại lệ. Engine phát hiện một giá trị nằm ngoài ngưỡng. Ngoại lệ chỉ là dấu hiệu cần xem xét, không đồng nghĩa dữ liệu chắc chắn sai và không bị tự động xóa.
>
> Form này gọi engine thống kê trực tiếp, không cần Gemini tính ra các con số.

## 5. Kiểm định hai chi nhánh — 1 phút

**Thao tác:**

1. Trong **Phân tích nâng cao**, chọn **Independent T-test**.
2. **Cột phân tích:** `c_revenue`; **Cột phân nhóm:** `c_branch`.
3. **Nhóm cần so sánh tùy chọn:** `A, B`; **alpha:** `0.05`.
4. Bấm **Chạy phân tích thống kê**. Form này dùng Welch, không giả định phương sai bằng nhau.
5. Chỉ phương pháp, H0/H1, cỡ mẫu, p-value, CI, effect size và các giả định chưa xác nhận.

**Đối chiếu:** A và B mỗi nhóm 79 giá trị hợp lệ, tổng dùng 158. Có 81 dòng ngoài nhóm A/B, 3 dòng thiếu trong các nhóm được chọn. Statistic khoảng 0,166127; p-value khoảng 0,868272; CI 95% khoảng [−41,355449; 48,950386].

**Lời nói:**

> Em thử so sánh trung bình doanh thu của chi nhánh A và B bằng Welch T-test. Hệ thống hiển thị giả thuyết, số quan sát được dùng, p-value, khoảng tin cậy và effect size từ engine.
>
> Với p-value khoảng 0,868 lớn hơn alpha 0,05, kết quả hiện tại chưa đủ bằng chứng bác bỏ giả thuyết hai trung bình bằng nhau. Điều này không chứng minh hai chi nhánh tương đương.
>
> Tính độc lập của các quan sát vẫn cần xác nhận từ cách thu thập dữ liệu; hệ thống không tự đánh dấu giả định đó là đạt.

## 6. Hỏi thống kê bằng Chat AI — 1 đến 2 phút

**Thao tác:** vào **Chat AI**, chọn **Demo khám phá dữ liệu bẩn · Dữ liệu CSV**, tạo hội thoại. Gửi từng câu và chờ kết quả:

**Nhập câu 1:** Hãy thống kê số dòng, số cột, số ô thiếu và số dòng trùng của dataset này.

**Đối chiếu:** 242 dòng, 10 cột, 6 ô thiếu hiện tại, 2 dòng trùng dư.

**Nhập câu 2:** Tính median và độ lệch chuẩn mẫu của c_revenue trên toàn bộ dataset, không lọc.

**Đối chiếu:** median 340, độ lệch chuẩn khoảng 64798,647854.

**Nhập câu 3 tùy chọn:** Kiểm định Welch Independent T-test để so sánh trung bình c_revenue giữa hai nhóm A và B của c_branch. Chỉ chọn A và B, alpha 0.05, không giả định phương sai bằng nhau.

**Lời nói:**

> Người dùng cũng có thể yêu cầu các phân tích bằng ngôn ngữ tự nhiên. AI xác định ý định và cấu hình; Spring Boot kiểm tra dataset cùng tên cột rồi mới gọi PostgreSQL hoặc engine SciPy.
>
> Kết quả trong chat khớp với phần em vừa chạy trực tiếp. LLM không tự tính statistic hoặc p-value. Kết quả, giả định và cảnh báo được lưu trong hội thoại để mở lại.

**Thao tác tùy chọn:** chuyển sang Tổng quan, quay lại Chat AI và mở hội thoại vừa tạo. Không cần gửi lại câu hỏi để xem kết quả đã lưu.

## 7. Tạo dashboard từ hội thoại — 1 phút

**Thao tác:** tạo hội thoại mới trên cùng dataset, gửi nguyên câu:

**Nhập vào chat:** Tạo dashboard tổng quan doanh thu bằng mẫu sales-overview trên toàn bộ dataset. Dùng c_date làm ngày, c_revenue làm doanh thu, c_branch làm khu vực và c_category làm danh mục.

Chờ hoàn tất, ẩn danh sách hội thoại nếu cần và cuộn trong khung chat để xem ba biểu đồ. Bấm **Mở dashboard đầy đủ**.

**Lời nói:**

> Với yêu cầu dashboard, AI chọn template và ánh xạ các cột thật của dataset. Dashboard sau khi tạo được lưu lại và biểu đồ hiển thị ngay trong hội thoại.
>
> Dữ liệu vẫn có ngoại lệ nên biểu đồ thể hiện ảnh hưởng của giá trị lớn đó. Hệ thống không âm thầm bỏ ngoại lệ để làm biểu đồ đẹp hơn.

**Nếu cần giải thích tổng theo tháng:**

> Tổng doanh thu toàn bộ là 1 triệu 79 nghìn 769; tổng theo tháng hợp lệ là 1 triệu 79 nghìn 429. Chênh 340 do một dòng có ngày sai không được xếp vào tháng; doanh thu của dòng đó vẫn có trong phân tích theo chi nhánh và danh mục.

## 8. Bộ lọc drill down bố cục và xuất file — 1 đến 2 phút

**Thao tác:**

1. Ở dashboard đầy đủ, **Bộ lọc dashboard** → **Thêm điều kiện**.
2. Chọn đúng dataset, **Cột lọc:** `c_branch`, điều kiện bằng giá trị, nhập `A` → **Áp dụng bộ lọc**.
3. Các biểu đồ thuộc dataset này cập nhật theo cùng điều kiện. Tổng doanh thu chi nhánh A là **26880**.
4. Bấm **Xem dữ liệu chi tiết** ở biểu đồ tháng, chọn nhóm/điểm; xem dòng nguồn. Bấm **Đóng**.
5. Bấm **Xuất Excel**, mở file nếu muốn; bảng biểu đồ sau lọc phải khớp số đang xem. Có thể thử thêm **Xuất PNG** và **Xuất PDF**.
6. **Xóa bộ lọc** để trở lại toàn bộ dữ liệu.
7. **Chỉnh bố cục** → di chuyển/đổi kích thước một ô → lưu. Có thể sửa tên dashboard/tiêu đề hoặc loại biểu đồ và mở lại để cho thấy cấu hình được giữ.

**Lời nói:**

> Bộ lọc dashboard được áp dụng đồng thời cho các biểu đồ thuộc dataset đã chọn. Em lọc chi nhánh A và có thể drill-down từ nhóm tổng hợp xuống các dòng nguồn tương ứng.
>
> Khi xuất Excel, hệ thống xuất các bảng số liệu đã tải sau bộ lọc; PNG và PDF thể hiện dashboard theo bố cục đang xem. Excel không phải bản xuất toàn bộ 242 dòng gốc nếu biểu đồ đang là dữ liệu tổng hợp.
>
> Người dùng có thể chỉnh vị trí, kích thước và nội dung biểu đồ, lưu và mở lại dashboard.

## 9. Tổng kết — 35 giây

**Thao tác:** để màn hình ở báo cáo chất lượng hoặc dashboard đã bỏ bộ lọc.

**Lời nói:**

> Qua bản demo, phần dữ liệu đã nối được với giao diện khám phá, engine thống kê và Chat AI. Nhóm đã kiểm tra số liệu bằng bộ dữ liệu có kết quả đối chiếu, thử các kiểm định, quyền truy cập và xuất file.
>
> Phần em hoàn thiện giúp các chức năng chạy trên đúng dataset người dùng chọn, báo rõ phạm vi và dữ liệu thiếu, không thay nguồn lỗi bằng dữ liệu mẫu.
>
> Đây vẫn là POC. Kết luận thống kê có điều kiện theo giả định và chất lượng đầu vào; AI phụ thuộc dịch vụ ngoài. Em mong anh góp ý thêm để nhóm hoàn thiện theo nhu cầu sử dụng thực tế. Em cảm ơn anh.

## Phần tùy chọn với file 500 nghìn dòng

1. Nhập file `D:\SE01C\TT\ThucTap\Du_lieu_demo\doanh_thu_500000_dong.csv` với tên riêng.
2. Khám phá dataset **Dữ liệu CSV**, kiểm tra số dòng 500.000.
3. Chạy **Thống kê mô tả** trên `c_amount`: count 500.000, mean 50,5; tổng 25.250.000.
4. Nếu thử Shapiro–Wilk trên toàn bộ 500.000 dòng, hệ thống phải báo không đủ điều kiện vì giới hạn 3–5000, không tự lấy mẫu rồi gọi đó là toàn bộ dataset.

**Lưu ý:** file lớn giả lập lặp lại 300 tổ hợp dữ liệu nên báo 499.700 dòng trùng dư là đúng với đầu vào này. Không dùng số đó để kết luận hệ thống nhập lỗi hoặc làm mất dữ liệu.

**Lời nói:**

> Nhóm cũng đã kiểm tra đường đi từ CSV 500 nghìn dòng đến engine thật. Thống kê mô tả tính trên toàn bộ dữ liệu. Với phương pháp có giới hạn cỡ mẫu như Shapiro–Wilk, hệ thống báo rõ giới hạn thay vì cố trả một p-value không phù hợp.

## Lưu ý khi quay

- Không đọc kết quả thành công trước khi nó thực sự hiện trên màn hình. Có lỗi AI thì dừng quay, kiểm tra rồi thử lại; có thể cắt đoạn chờ khi dựng video.
- File chính có tên cột tiếng Anh, sau import có tiền tố `c_`. Không dùng `c_doanh_thu` hay `c_khu_vuc` của file demo cũ cho file này.
- Nếu đã có dataset đúng file này, có thể dùng lại. Không xóa toàn bộ dữ liệu demo để quay.
- Chưa tự làm sạch theo quy tắc nghiệp vụ hoặc xóa ngoại lệ. Không mô tả POC là sản phẩm production hoặc mọi phương pháp đều áp dụng được cho mọi dataset.
