-- Migrasi tahap Premium langkah 2: tabel pesanan (orders) untuk database lama.
-- Dijalankan oleh root: masuk dengan  mysql -u root -p  lalu ketik  SOURCE backend/db/migrasi-pesanan.sql;
-- Aman dijalankan ulang (IF NOT EXISTS). Hak akses user image_translator sudah mencakup tabel baru
-- karena diberikan untuk image_translator.* (lihat docs/menjalankan.md).

USE image_translator;

CREATE TABLE IF NOT EXISTS orders (
  order_id   VARCHAR(50)     NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  amount     INT UNSIGNED    NOT NULL,
  days       INT UNSIGNED    NOT NULL,
  status     ENUM('pending', 'paid', 'expired', 'failed') NOT NULL DEFAULT 'pending',
  qr_url     VARCHAR(2048)   NULL,
  expires_at DATETIME        NOT NULL,
  paid_at    DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_orders_user (user_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
