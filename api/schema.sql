PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS unavailability_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_unavailability_periods_dates
  ON unavailability_periods (start_date, end_date);

CREATE TABLE IF NOT EXISTS reservation_requests (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  telephone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  commune TEXT NOT NULL,
  commune_code TEXT DEFAULT '',
  commune_code_postal TEXT DEFAULT '',
  nombre_chats INTEGER NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  frequence TEXT NOT NULL,
  frequence_autre TEXT DEFAULT '',
  observations TEXT DEFAULT '',
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_email',
  email_message_id TEXT DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  emailed_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservation_requests_dates
  ON reservation_requests (date_debut, date_fin);

CREATE INDEX IF NOT EXISTS idx_reservation_requests_ip_submitted
  ON reservation_requests (ip_hash, submitted_at);
