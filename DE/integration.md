# Backend integration and implementation decisions

## Request path

The React client calls same-origin `/api/...` routes through `src/api.js`. In development Vite proxies `/api` to the Express server. Express routes live in `server/index.js`; when `DATABASE_URL` is set, that module loads `server/postgres-store.js`. The PostgreSQL store owns the shared `pg.Pool`, parameterized SQL, and transaction helper. When `DATABASE_URL` is absent, local SQLite is used instead. Firebase Authentication can verify faculty identities; it is not the production attendance data store when PostgreSQL is configured.

## Feature-to-query map

| Feature/API | Backend operation | Database behavior |
|---|---|---|
| `GET /api/bootstrap` | `pg.listStudents()`, geofence/session/check-in/weekly reads | Joins attendance summaries to the roster; retrieves bounded recent check-ins |
| `POST /api/students` | `pg.createStudent()` | Parameterized insert, unique roll constraint, audit event |
| `PATCH /api/students/:id` | `pg.setStudentAttendance()` | Transaction updates dated attendance, student summary, and audit |
| `POST /api/checkins` | `pg.checkIn()` | Transaction validates token/session/roster/geofence and writes attendance plus check-in |
| `POST /api/students/import` | `pg.importStudents()` | Transaction with `ON CONFLICT (roll)` upsert behavior |
| `GET /api/reports/attendance` | `pg.attendanceReport()` | Group and count by date, status, and source |
| `GET /api/audit` | `pg.auditEntries()` | Recent audit rows, bounded to 200 |

The backend uses `$1`, `$2`, etc. parameters for PostgreSQL values. The `pg.Pool` is constructed once per server process (`PG_POOL_MAX`, default 5); transaction clients are released in `finally`. For check-in, the database transaction makes the attendance row and check-in row succeed or roll back together. Database unique constraints also reject duplicate attendance/check-ins for a student and date.

## Constraints and indexes

`students.roll` is unique; attendance status is constrained to `present`, `absent`, or `late`; attendance references a real student and has a composite `(student_id, attendance_date)` primary key; check-ins reference students and have a unique student/date pair; tokens reference sessions. Indexes support attendance-by-date, recent check-ins by date/time, and newest audit entries. Additional indexes should be based on observed query plans and real filters; the current API does not offer general roster filters or pagination.

## Demonstration evidence to record

1. Run the app in a safe demo environment with PostgreSQL configured, then show a successful faculty login and `GET /api/bootstrap` response.
2. Create or update a clearly synthetic student through the UI/API. Query `students` in `psql` and show the same roll/name persisted.
3. Show an invalid duplicate roll returning `409` and an invalid request returning `400` with the API's `{ "error": "..." }` shape.
4. Run `DE/queries.sql` and show `SELECT`, `JOIN`, aggregate, `GROUP BY/HAVING`, `INSERT`, `UPDATE`, subquery, and `DELETE` outputs.
5. Show `server/postgres-store.js` for the shared pool, parameterized operations and transaction, then `server/index.js` for the route that calls them.

No database credentials, real student rows, live coordinates, access tokens, or service-account JSON belong in screenshots or Git. The supplied query fixtures are synthetic. This folder documents database integration and offers reproducible SQL demonstrations; it is not a claim that every query in `queries.sql` is called by an HTTP endpoint.

## Current limitations and scaling

- Table creation is currently `CREATE TABLE IF NOT EXISTS` at app startup, not a versioned migration system. The repo has a Firestore-to-PostgreSQL data migration utility, but not general schema migration history.
- Student check-in uses a roll number and QR pass; that is not strong verification of student identity.
- PostgreSQL list endpoints currently return the roster without query-parameter pagination. A growing roster should gain capped, validated pagination and stable sorting.
- SQLite calls use a synchronous driver and are intended for one app instance. Hosted PostgreSQL and the pool are the scalable relational path.
- The connection pool default is small (five); tune it against the database plan and measured concurrency rather than raising it blindly.
