-- PostgreSQL schema snapshot matching server/postgres-store.js.
-- Run only in a dedicated demo database. Application startup also initializes
-- these tables with CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  roll TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  percentage REAL NOT NULL DEFAULT 100,
  today TEXT NOT NULL DEFAULT 'unmarked',
  notified BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS attendance_records (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  source TEXT NOT NULL DEFAULT 'manual',
  recorded_by TEXT,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  started_at BIGINT NOT NULL,
  ended_at BIGINT
);

CREATE TABLE IF NOT EXISTS session_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  roll TEXT NOT NULL,
  attendance_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  distance_m INTEGER NOT NULL,
  latitude REAL,
  longitude REAL,
  UNIQUE (student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS staff (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'faculty',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_migrations (
  migration_key TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  row_counts JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS attendance_date_idx
  ON attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS checkins_date_idx
  ON checkins (attendance_date, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx
  ON audit_log (created_at DESC);

INSERT INTO settings (setting_key, value)
VALUES ('geofence', '{"center": null, "radius": 50}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
