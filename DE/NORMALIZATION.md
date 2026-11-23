# Functional dependencies and normalization

## Nature of the data

The core data is structured and relational. Roster fields, dated attendance facts, session lifetimes, and QR tokens have stable keys and constraints. Settings and audit details include flexible metadata, so the schema stores only those payloads as JSONB.

## Functional dependencies

- `students`: `id → name, roll, department, percentage, today, notified`; `roll → id, name, department, percentage, today, notified` because roll is unique.
- `attendance_records`: `(student_id, attendance_date) → status, source, recorded_by, recorded_at`.
- `checkins`: `id → student_id, name, roll, attendance_date, created_at, distance_m, latitude, longitude`; also `(student_id, attendance_date) → id, ...` because that pair is unique.
- `attendance_sessions`: `id → active, started_at, ended_at`.
- `session_tokens`: `token → session_id, created_at, expires_at`.
- `staff`: `email → name, role, active, created_at`.
- `settings`: `setting_key → value`.
- `audit_log`: `id → actor, action, entity_type, entity_id, details, created_at`.

## Anomalies in an unnormalized design

Suppose one table stored student name, roll, department, attendance date, status, and check-in location together. Repeating student details for every class date creates update anomalies when a student changes department; insert anomalies because a new student cannot be recorded until an attendance event exists; and delete anomalies because deleting the last attendance row could remove the only copy of a student’s identity.

## Transformations

### First Normal Form (1NF)

Separate repeating attendance values into rows, one per student and date, and keep scalar values in columns. The attendance key is `(student_id, attendance_date)`. Each relational column contains one value; flexible JSONB settings and audit payloads are intentional exceptions for metadata, not repeating attendance groups.

### Second Normal Form (2NF)

The attendance table has a composite key. Status, source, recorder, and recording time depend on both the student and the date, not only on the student. Student name, roll, and department depend only on the student, so they are stored in `students`, not repeated in `attendance_records`. This removes partial dependencies on part of the composite key.

### Third Normal Form (3NF)

Non-key attributes depend on the key, the whole key, and no other non-key attribute. In `students`, department is stored as an attribute of the student rather than transitively through attendance rows. Staff profile data is stored by email in `staff`; session token data is stored separately from session data. This removes the remaining transitive dependencies in the normalized core tables.

The schema intentionally snapshots `name` and `roll` in `checkins` so historical check-in details remain readable if roster details change. `students.today` and `students.percentage` are convenient summary values; current PostgreSQL roster reads calculate attendance percentage from attendance history. These are deliberate denormalizations/snapshots, not hidden claims of strict normalization. The app’s `settings.value` and `audit_log.details` use JSONB for flexible payloads.

## Final normalized schema

The final schema is in [`schema.sql`](schema.sql). It uses primary keys, foreign keys, unique constraints, `NOT NULL`, and a status `CHECK`. Attendance facts use a composite key, implementing the associative entity between students and attendance dates. No artificial one-to-one relationship is added because the requirements do not contain a real one-to-one fact.
