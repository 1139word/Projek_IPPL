-- Migrasi tahap Premium untuk database yang dibuat SEBELUM kolom premium_until ada.
-- Dijalankan SEKALI oleh root: masuk dengan  mysql -u root -p  lalu ketik  SOURCE backend/db/migrasi-premium.sql;
-- Database baru (dibuat dari schema.sql terbaru) sudah punya kolom ini, jadi tidak perlu menjalankan file ini.
-- Bila dijalankan dua kali, MySQL menolak dengan "Duplicate column name 'premium_until'": itu tandanya sudah ada, aman diabaikan.

USE image_translator;

ALTER TABLE users
  ADD COLUMN premium_until DATETIME NULL AFTER plan;  -- Premium aktif sampai kapan (NULL = tidak Premium)
