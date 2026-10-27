-- Struktur database Image Translator (tahap akun dan credit).
-- Dijalankan oleh root dari folder proyek: masuk dengan  mysql -u root -p  lalu ketik  SOURCE backend/db/schema.sql;
-- Aman dijalankan ulang: yang sudah ada tidak dibuat dua kali dan datanya tidak dihapus.

CREATE DATABASE IF NOT EXISTS image_translator
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE image_translator;

-- Satu baris per pengguna. Akun dibuat otomatis saat login Google pertama (UC-09).
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_sub      VARCHAR(255)    NOT NULL,              -- ID akun Google, tidak pernah berubah
  email           VARCHAR(320)    NOT NULL,
  picture_url     VARCHAR(2048)   NULL,
  plan            ENUM('free', 'premium') NOT NULL DEFAULT 'free',
  credit_left     INT UNSIGNED    NOT NULL,              -- sisa credit periode ini
  credit_reset_at DATETIME        NOT NULL,              -- saat credit diisi ulang ke kuota paket
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
