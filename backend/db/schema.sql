-- Struktur database Image Translator (akun, sesi, paket credit, dan pesanan).
-- Dijalankan oleh root dari folder proyek: masuk dengan  mysql -u root -p  lalu ketik  SOURCE backend/db/schema.sql;
-- Aman dijalankan ulang: yang sudah ada tidak dibuat dua kali dan datanya tidak dihapus.
-- Database lama (masih punya kolom plan / premium_until) diubah dengan backend/db/migrasi-credit.sql, bukan file ini.

CREATE DATABASE IF NOT EXISTS image_translator
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE image_translator;

-- Satu baris per pengguna. Akun dibuat otomatis saat login Google pertama (UC-09).
-- Tidak ada status Free atau Premium: yang membedakan akun hanya saldo credit-nya.
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_sub      VARCHAR(255)    NOT NULL,              -- ID akun Google, tidak pernah berubah
  email           VARCHAR(320)    NOT NULL,
  picture_url     VARCHAR(2048)   NULL,
  credit_left     INT UNSIGNED    NOT NULL DEFAULT 10,   -- saldo credit: tidak kedaluwarsa, tidak direset; akun baru 10
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_google_sub (google_sub)
) ENGINE = InnoDB;

-- Satu baris per login aktif. Yang disimpan hanya hash SHA-256 token, bukan token aslinya.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)        NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME        NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Daftar paket credit yang dijual (UC-07). Harga diubah di tabel ini, bukan di kode.
CREATE TABLE IF NOT EXISTS credit_packages (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name    VARCHAR(50)  NOT NULL,                         -- misalnya "Paket 30"
  credits INT UNSIGNED NOT NULL,                         -- jumlah credit yang didapat
  price   INT UNSIGNED NOT NULL,                         -- harga dalam rupiah
  active  BOOLEAN      NOT NULL DEFAULT TRUE,            -- FALSE = tidak dijual lagi (baris tidak dihapus karena dirujuk orders)
  PRIMARY KEY (id)
) ENGINE = InnoDB;

-- Tiga paket awal. INSERT IGNORE: bila id 1 sampai 3 sudah ada, baris itu dilewati,
-- jadi harga yang sudah Anda ubah sendiri tidak tertimpa saat file ini dijalankan ulang.
INSERT IGNORE INTO credit_packages (id, name, credits, price) VALUES
  (1, 'Paket 30',  30,  10000),
  (2, 'Paket 100', 100, 30000),
  (3, 'Paket 250', 250, 65000);

-- Satu baris per pembelian paket credit (UC-08). Status hanya diubah backend dari jawaban Midtrans.
CREATE TABLE IF NOT EXISTS orders (
  order_id   VARCHAR(50)     NOT NULL,                    -- ID pesanan yang juga dikirim ke Midtrans
  user_id    BIGINT UNSIGNED NOT NULL,
  package_id INT UNSIGNED    NOT NULL,                    -- paket yang dibeli
  amount     INT UNSIGNED    NOT NULL,                    -- harga saat pesanan dibuat (rupiah)
  credits    INT UNSIGNED    NOT NULL,                    -- credit yang ditambahkan saat lunas
  status     ENUM('pending', 'paid', 'expired', 'failed') NOT NULL DEFAULT 'pending',
  qr_url     VARCHAR(2048)   NULL,                        -- alamat gambar QR dari Midtrans
  expires_at DATETIME        NOT NULL,                    -- batas waktu membayar (15 menit)
  paid_at    DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_orders_user (user_id),
  KEY idx_orders_package (package_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_package FOREIGN KEY (package_id)
    REFERENCES credit_packages (id)
) ENGINE = InnoDB;
