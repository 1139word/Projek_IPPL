-- Migrasi ke sistem credit (tanpa Free/Premium) untuk database LAMA,
-- yaitu database yang tabel users-nya masih punya kolom plan, premium_until, dan credit_reset_at.
-- Database baru yang dibuat dari schema.sql terbaru TIDAK perlu menjalankan file ini.
--
-- Dijalankan SEKALI oleh root dari folder proyek: masuk dengan  mysql -u root -p  lalu ketik
--   SOURCE backend/db/migrasi-credit.sql;
-- Bila dijalankan dua kali, MySQL berhenti di langkah 2 dengan
-- "Can't DROP 'plan'; check that column/key exists": itu tandanya migrasi sudah pernah dijalankan, aman diabaikan.
--
-- Yang TIDAK berubah: akun (users) dan sesi login tetap ada, saldo credit_left tiap akun tetap seperti sekarang.
-- Yang DIHAPUS: seluruh isi tabel orders lama. Isinya pesanan Premium dari uji coba Midtrans Sandbox
-- (bukan uang sungguhan) dan bentuknya (kolom days) tidak cocok lagi dengan pesanan paket credit.

USE image_translator;

-- Langkah 1: tabel paket credit beserta tiga paket awal.
CREATE TABLE IF NOT EXISTS credit_packages (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name    VARCHAR(50)  NOT NULL,
  credits INT UNSIGNED NOT NULL,
  price   INT UNSIGNED NOT NULL,
  active  BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id)
) ENGINE = InnoDB;

INSERT IGNORE INTO credit_packages (id, name, credits, price) VALUES
  (1, 'Paket 30',  30,  10000),
  (2, 'Paket 100', 100, 30000),
  (3, 'Paket 250', 250, 65000);

-- Langkah 2: users tidak lagi punya paket, masa Premium, dan jadwal reset.
ALTER TABLE users
  DROP COLUMN plan,
  DROP COLUMN premium_until,
  DROP COLUMN credit_reset_at,
  MODIFY COLUMN credit_left INT UNSIGNED NOT NULL DEFAULT 10;

-- Langkah 3: orders menjadi pesanan paket credit.
DELETE FROM orders;

ALTER TABLE orders
  DROP COLUMN days,
  ADD COLUMN package_id INT UNSIGNED NOT NULL AFTER user_id,
  ADD COLUMN credits    INT UNSIGNED NOT NULL AFTER amount,
  ADD KEY idx_orders_package (package_id),
  ADD CONSTRAINT fk_orders_package FOREIGN KEY (package_id) REFERENCES credit_packages (id);
