-- Clearly synthetic demonstration records for an isolated DE demo database.
-- The DE- prefix makes the records easy to identify and clean up.

INSERT INTO students (id, name, roll, department, percentage, today, notified) VALUES
  ('de-stu-001', 'Aarav Demo', 'DE-CS-001', 'CSE', 100, 'present', FALSE),
  ('de-stu-002', 'Anaya Demo', 'DE-CS-002', 'CSE', 0, 'absent', FALSE),
  ('de-stu-003', 'Rohan Demo', 'DE-EC-001', 'ECE', 100, 'present', TRUE),
  ('de-stu-004', 'Mira Demo', 'DE-ME-001', 'Mechanical', 100, 'late', FALSE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, roll = EXCLUDED.roll, department = EXCLUDED.department,
  percentage = EXCLUDED.percentage, today = EXCLUDED.today, notified = EXCLUDED.notified;

INSERT INTO attendance_sessions (id, active, started_at, ended_at) VALUES
  ('de-session-001', FALSE, 1795392000000, 1795395600000)
ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active,
  started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at;

INSERT INTO session_tokens (token, session_id, created_at, expires_at) VALUES
  ('de-expired-token', 'de-session-001', 1795392000000, 1795395600000)
ON CONFLICT (token) DO UPDATE SET session_id = EXCLUDED.session_id,
  created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at;

INSERT INTO attendance_records
  (student_id, attendance_date, status, source, recorded_by, recorded_at) VALUES
  ('de-stu-001', '2026-11-23', 'present', 'qr', 'faculty-demo@example.test', '2026-11-23T09:00:00.000Z'),
  ('de-stu-002', '2026-11-23', 'absent', 'manual', 'faculty-demo@example.test', '2026-11-23T09:01:00.000Z'),
  ('de-stu-003', '2026-11-23', 'present', 'manual', 'faculty-demo@example.test', '2026-11-23T09:02:00.000Z'),
  ('de-stu-004', '2026-11-23', 'late', 'manual', 'faculty-demo@example.test', '2026-11-23T09:03:00.000Z')
ON CONFLICT (student_id, attendance_date) DO UPDATE SET
  status = EXCLUDED.status, source = EXCLUDED.source,
  recorded_by = EXCLUDED.recorded_by, recorded_at = EXCLUDED.recorded_at;

INSERT INTO checkins
  (id, student_id, name, roll, attendance_date, created_at, distance_m, latitude, longitude) VALUES
  ('de-checkin-001', 'de-stu-001', 'Aarav Demo', 'DE-CS-001', '2026-11-23', '2026-11-23T09:00:00.000Z', 12, 12.971600, 77.594600),
  ('de-checkin-003', 'de-stu-003', 'Rohan Demo', 'DE-EC-001', '2026-11-23', '2026-11-23T09:02:00.000Z', 18, 12.971700, 77.594700)
ON CONFLICT (student_id, attendance_date) DO UPDATE SET
  name = EXCLUDED.name, roll = EXCLUDED.roll, created_at = EXCLUDED.created_at,
  distance_m = EXCLUDED.distance_m, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude;
