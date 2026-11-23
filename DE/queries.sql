-- 10 project-specific PostgreSQL operations. Run against a fresh demo database
-- after schema.sql and sample_data.sql. Expected results are in query_results.md.

\echo '1. Read and sort the roster'
SELECT id, name, roll, department FROM students ORDER BY name;

\echo '2. Filter the roster by department and sort by roll'
SELECT roll, name FROM students WHERE department = 'CSE' ORDER BY roll;

\echo '3. Department roster sizes (aggregate, GROUP BY, HAVING)'
SELECT department, COUNT(*) AS student_count
FROM students GROUP BY department HAVING COUNT(*) >= 2 ORDER BY department;

\echo '4. Join attendance facts to student details for a class date'
SELECT s.roll, s.name, a.status, a.source
FROM attendance_records AS a JOIN students AS s ON s.id = a.student_id
WHERE a.attendance_date = '2026-11-23' ORDER BY s.roll;

\echo '5. Attendance totals for the demo date'
SELECT COUNT(*) AS marked,
       COUNT(*) FILTER (WHERE status IN ('present', 'late')) AS attended,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present', 'late')) / NULLIF(COUNT(*), 0), 1) AS attendance_percent
FROM attendance_records WHERE attendance_date = '2026-11-23';

\echo '6. Add a new student (INSERT)'
INSERT INTO students (id, name, roll, department)
VALUES ('de-stu-005', 'Tara Demo', 'DE-IT-001', 'IT')
ON CONFLICT (roll) DO NOTHING
RETURNING id, roll, department;

\echo '7. Update a student follow-up flag (UPDATE)'
UPDATE students SET notified = TRUE WHERE roll = 'DE-CS-002'
RETURNING roll, notified;

\echo '8. Use a subquery and HAVING to find departments under 80% attendance'
SELECT department, attendance_percent
FROM (
  SELECT s.department,
         ROUND(100.0 * SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) / COUNT(*), 1) AS attendance_percent
  FROM students AS s JOIN attendance_records AS a ON a.student_id = s.id
  WHERE a.attendance_date = '2026-11-23'
  GROUP BY s.department
) AS department_totals
WHERE attendance_percent < 80
ORDER BY department;

\echo '9. Show recent QR check-ins using the date/time index'
SELECT roll, name, distance_m, created_at FROM checkins
WHERE attendance_date = '2026-11-23' ORDER BY created_at DESC LIMIT 8;

\echo '10. Delete only expired tokens (DELETE)'
DELETE FROM session_tokens WHERE token = 'de-expired-token' AND expires_at < 1795395600001
RETURNING token;
