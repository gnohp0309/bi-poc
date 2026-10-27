CREATE TABLE IF NOT EXISTS public.orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_date date NOT NULL,
  region text NOT NULL,
  category text NOT NULL,
  product text NOT NULL,
  amount numeric(12,2) NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL
);
INSERT INTO public.orders(order_date,region,category,product,amount,quantity,status)
SELECT sample.order_date::date,sample.region,sample.category,sample.product,sample.amount,sample.quantity,sample.status FROM (VALUES
('2025-01-05','Miền Bắc','Điện tử','Tai nghe',1290000,3,'Hoàn tất'),
('2025-01-16','Miền Nam','Gia dụng','Máy lọc nước',4700000,2,'Hoàn tất'),
('2025-02-03','Miền Trung','Điện tử','Màn hình',6400000,2,'Hoàn tất'),
('2025-02-18','Miền Bắc','Văn phòng','Ghế công thái học',7200000,4,'Hoàn tất'),
('2025-03-08','Miền Nam','Điện tử','Laptop',19500000,3,'Hoàn tất'),
('2025-03-21','Miền Bắc','Gia dụng','Máy pha cà phê',3600000,2,'Hoàn tất'),
('2025-04-02','Miền Trung','Văn phòng','Bàn làm việc',5400000,3,'Hoàn tất'),
('2025-04-17','Miền Nam','Gia dụng','Máy lọc nước',9400000,4,'Hoàn tất'),
('2025-05-10','Miền Bắc','Điện tử','Laptop',26000000,4,'Hoàn tất'),
('2025-05-25','Miền Trung','Gia dụng','Máy pha cà phê',5400000,3,'Hoàn tất'),
('2025-06-04','Miền Nam','Văn phòng','Ghế công thái học',9000000,5,'Hoàn tất'),
('2025-06-20','Miền Bắc','Điện tử','Màn hình',9600000,3,'Hoàn tất'),
('2025-07-07','Miền Trung','Gia dụng','Máy lọc nước',7050000,3,'Hoàn tất'),
('2025-07-22','Miền Nam','Điện tử','Tai nghe',2580000,6,'Hoàn tất'),
('2025-08-11','Miền Bắc','Văn phòng','Bàn làm việc',9000000,5,'Hoàn tất'),
('2025-08-24','Miền Trung','Điện tử','Laptop',13000000,2,'Hoàn tất'),
('2025-09-06','Miền Nam','Gia dụng','Máy pha cà phê',7200000,4,'Hoàn tất'),
('2025-09-19','Miền Bắc','Điện tử','Màn hình',12800000,4,'Hoàn tất'),
('2025-10-03','Miền Trung','Văn phòng','Ghế công thái học',5400000,3,'Hoàn tất'),
('2025-10-17','Miền Nam','Điện tử','Laptop',32500000,5,'Hoàn tất'),
('2025-11-05','Miền Bắc','Gia dụng','Máy lọc nước',11750000,5,'Hoàn tất'),
('2025-11-22','Miền Trung','Điện tử','Tai nghe',2150000,5,'Hoàn tất'),
('2025-12-09','Miền Nam','Văn phòng','Bàn làm việc',7200000,4,'Hoàn tất'),
('2025-12-20','Miền Bắc','Điện tử','Laptop',19500000,3,'Hoàn tất')) AS sample(order_date,region,category,product,amount,quantity,status)
WHERE NOT EXISTS (SELECT 1 FROM public.orders);
CREATE TABLE IF NOT EXISTS public.products (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  product text NOT NULL,
  unit_price numeric(12,2) NOT NULL
);
INSERT INTO public.products(category,product,unit_price)
SELECT * FROM (VALUES
('Điện tử','Tai nghe',430000),('Điện tử','Màn hình',3200000),('Điện tử','Laptop',6500000),
('Gia dụng','Máy lọc nước',2350000),('Gia dụng','Máy pha cà phê',1800000),
('Văn phòng','Ghế công thái học',1800000),('Văn phòng','Bàn làm việc',1800000)) AS sample(category,product,unit_price)
WHERE NOT EXISTS (SELECT 1 FROM public.products);
GRANT USAGE ON SCHEMA public TO bi_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_reader;
