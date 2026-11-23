# Data Engineering — Smart College Attendance

This folder documents the database design and runnable PostgreSQL examples for the attendance application. The production backend supports PostgreSQL through the `pg` driver; local development defaults to SQLite. The examples below use an isolated PostgreSQL database and clearly marked demo records.

## Contents

1. [Database selection, architecture, and final schema](#database-selection-and-architecture)
2. [ER diagram](ER_DIAGRAM.md)
3. [Normalization and functional dependencies](NORMALIZATION.md)
4. [Executable schema](schema.sql)
5. [Sample records](sample_data.sql)
6. [Business queries](queries.sql) and [expected outputs](query_results.md)
7. [Backend integration evidence and design notes](integration.md)

## Database selection and architecture

The selected production database is PostgreSQL. Attendance data is relational: students have attendance records over dates; QR check-ins refer to students; and QR tokens belong to attendance sessions. Foreign keys, unique constraints, transactions, and SQL joins fit these requirements and help prevent duplicate or orphan records. JSONB is used only for flexible settings and audit details.

The API is implemented in Express. `server/index.js` handles HTTP routes and selects the configured store. `server/postgres-store.js` owns PostgreSQL queries and creates one shared `pg.Pool`. The application initializes its PostgreSQL tables with `CREATE TABLE IF NOT EXISTS` at startup. The repository does not yet use a versioned migration tool; `schema.sql` is a readable, runnable snapshot of that PostgreSQL schema for this assignment.

The local SQLite store is useful for simple single-instance development; Firebase Authentication can provide faculty identity, and Firestore is an optional storage mode. Those alternatives do not change the production PostgreSQL design described in this folder. The backend uses parameterized SQL; PostgreSQL write paths such as check-in use a transaction.

## Final schema overview

| Table | Purpose | Key rules |
|---|---|---|
| `students` | Student roster | Primary key `id`; unique `roll` |
| `attendance_records` | One student’s status per date | Composite primary key `(student_id, attendance_date)`; student foreign key |
| `checkins` | QR check-in details and location | Student foreign key; unique `(student_id, attendance_date)` |
| `attendance_sessions` | Faculty-created attendance sessions | Primary key `id` |
| `session_tokens` | Expiring QR tokens | Token primary key; session foreign key |
| `staff` | Approved faculty/admin profiles | Email primary key |
| `settings` | Geofence and app settings | Setting key primary key; JSONB value |
| `audit_log` | Administrative and attendance events | Bigserial primary key; JSONB details |
| `data_migrations` | One-time data migration markers | Migration key primary key |

There is no natural one-to-one relationship in the current requirements. One-to-many is represented by students to attendance/check-ins and sessions to tokens. The many-to-many concept of students attending on many dates is resolved by `attendance_records`; a date can have many students and each student can appear on many dates. A separate `dates` table would add no useful attributes in this application.

## Run the examples safely

Use a throwaway database, never a production database. With PostgreSQL running locally:

```sh
createdb attendance_de_demo
psql -d attendance_de_demo -v ON_ERROR_STOP=1 -f DE/schema.sql
psql -d attendance_de_demo -v ON_ERROR_STOP=1 -f DE/sample_data.sql
psql -d attendance_de_demo -v ON_ERROR_STOP=1 -f DE/queries.sql
```

`sample_data.sql` inserts records with the `DE-` prefix. The DELETE query only removes the expired demo QR token. For an API walkthrough, configure the app with a separate test `DATABASE_URL`, Firebase sign-in configuration, and demo accounts; never paste secrets into the repository or recording.

## Validation notes

The schema matches `initializePostgres()` in `server/postgres-store.js`. The application’s existing list APIs return the roster and bounded recent reports; they do not currently accept general filter, sort, or pagination query parameters. The SQL examples demonstrate those business questions directly without implying that such API parameters already exist. See `integration.md` for other implementation limits and evidence steps.
