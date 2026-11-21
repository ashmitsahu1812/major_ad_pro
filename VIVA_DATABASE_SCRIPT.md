# Database viva video script

**Suggested length:** about 6–8 minutes at a steady pace. Text in square brackets is an on-screen cue; it is not spoken.

## Opening

Hello, in this video I’ll explain the database design used in my Smart College Attendance project. I’ll cover why I chose the database, how the data is organized, normalization, data correctness, and performance.

This project has three storage modes. During local development it uses SQLite. For a hosted deployment, it can use PostgreSQL by setting `DATABASE_URL`. There is also an optional Firestore mode when Firebase is enabled and PostgreSQL is not configured. I’ll focus mainly on PostgreSQL for the relational design, and point out where the other modes differ.

[Show `DATABASE_DESIGN.md` briefly, then open `server/database.js` and `server/postgres-store.js`.]

## Q1. Why did I choose this database?

The main information in my app is structured. It includes students, attendance records by date, QR check-ins, attendance sessions, staff, settings, and audit events. These records have clear relationships. For example, an attendance record belongs to one student, and a student can have attendance records for many dates. A relational database is a good fit because it can express those relationships and enforce rules such as one attendance record per student per date.

The app’s most common reads are loading the student roster with today’s attendance and overall attendance totals, showing recent check-ins, and checking the current session and geofence. Common writes are recording attendance, importing students, starting a session, and accepting a QR check-in.

The development database seeds 24 example students. The project doesn’t set a production capacity target, so the expected history depends on the actual roster size and number of class days. Attendance history grows with students multiplied by class days.

I use SQLite locally because it is easy to run and suits development and a single app instance. For a hosted deployment, PostgreSQL is a better fit because it supports concurrent connections, transactions, constraints, and managed hosting. Firestore is another supported option for Firebase-based deployments. I would choose it when Firebase integration is the priority, but relational joins and database-enforced rules make PostgreSQL a clearer fit for the attendance history and reporting model.

[Show the seeded student sample in `server/database.js` or the JSON sample in `DATABASE_DESIGN.md`.]

For example, a student row has an ID, name, roll number, department, attendance percentage, today’s status, and a follow-up notification flag. A sample seeded student is Aarav Sharma, roll number 22CS101, in CSE.

## Q2. How is the schema organized?

The main tables are `students`, `attendance_records`, `checkins`, `attendance_sessions`, `session_tokens`, `settings`, `staff`, and `audit_log`. SQLite also has `users` and `auth_sessions` for local password sign-in. PostgreSQL uses the `staff` table with Firebase faculty sign-in.

The primary key in `students` is `id`, and the roll number is unique. In `attendance_records`, the primary key is the pair `student_id` and `attendance_date`. That means one student can have only one attendance status for a particular date. The student ID is also a foreign key pointing to `students`.

This resolves the many-to-many relationship between students and class dates. A student attends many dates, and each date has many students. Instead of storing a list of students inside a date, I use `attendance_records` as the linking table. It stores the student, date, status, source, recorder, and timestamp.

`checkins` stores QR submission information such as the student, time, distance, and location. `attendance_sessions` represents an active attendance window, and `session_tokens` stores the temporary QR passes issued for it.

[Show `DATABASE_DESIGN.md`’s ER diagram, then scroll to the `attendance_records` table definition in `server/postgres-store.js`.]

The main read that joins across the relationship is the roster query in `listStudents()`. It reads students, joins today’s attendance record, and calculates totals from attendance history. That lets the faculty dashboard show current status and attendance percentages together.

## Q3. What normal form is the design in?

The core relational tables are in Third Normal Form. For `attendance_records`, the combination of student ID and attendance date determines the status, source, recorder, and recorded time. Those values depend on the full key. There are no partial dependencies on only one part of the composite key, and the non-key fields do not depend on other non-key fields.

In `students`, the student ID determines the name, roll number, and department. The unique roll number is also a candidate key. Student details are kept with the student rather than copied into every attendance record.

There are deliberate duplicated summary fields. The student row includes `today` and `percentage` to make dashboard display convenient, while dated attendance rows preserve the history. PostgreSQL calculates the percentage from the attendance records when listing students. The current status is also updated when attendance is changed.

The check-in table stores a copy of the student’s name and roll number as a snapshot. If the roster is edited later, that snapshot still shows the details recorded at check-in time. For the current student identity, the app can follow the student ID relationship back to the student table.

In Firestore, summary counters are also stored in the student document. The attendance update transaction updates the attendance document and those summary values together. Attendance history itself is kept as separate documents, so it does not grow as one large embedded array.

[Show `recordAttendance()` and `listStudents()` in `server/postgres-store.js`; optionally show `changeAttendance()` in `server/firestore-store.js`.]

## Q4. How does the database protect correctness?

The database enforces primary keys, unique roll numbers, foreign keys, required fields, and valid attendance statuses. The attendance status check accepts `present`, `absent`, or `late`. The unique composite key on student and date prevents duplicate attendance rows. PostgreSQL also makes the check-in student and date unique. SQLite has additional checks, such as keeping percentage between zero and one hundred and limiting the student status to known values.

The application checks rules that depend on the situation: whether a QR token has expired, whether the attendance session is active, whether the student is inside the classroom radius, and whether attendance has already been recorded.

In PostgreSQL, `withTransaction()` starts a transaction, commits if all the writes succeed, and rolls back if one fails. For example, changing a student’s attendance updates the dated attendance record, the student’s current status, and the audit log as one transaction. If one step fails, the transaction is rolled back so the records are not left half-updated.

PostgreSQL uses its default `READ COMMITTED` isolation level. There are no explicit row locks. If two people try to record the same student and date at the same time, the primary key and unique constraints prevent duplicate rows. For a simultaneous QR check-in, one insert succeeds and the other transaction fails and rolls back.

SQLite serializes writes and is intended here for one app instance. Firestore uses a transaction for attendance facts and the embedded summary values. One limitation is that the Firestore QR check-in flow does not put every check-in write into one multi-document transaction, so PostgreSQL provides the stronger all-or-nothing check-in operation in this project.

[Show the `CHECK` and key definitions, then `withTransaction()` and `checkIn()` in `server/postgres-store.js`.]

## Q5. How did I make database usage efficient?

PostgreSQL creates an index on attendance date to support reports and weekly totals. It has a compound index on check-in date and creation time to find the most recent check-ins for a date. There is also an index on audit-log creation time for recent audit entries. Primary keys and unique constraints create indexes for the main ID, roll number, and attendance lookups.

I did not add indexes for every student field. For example, there is no name or department index because the current dashboard loads the roster and filters it in the interface. Extra indexes would add storage and make writes more expensive without helping the current query pattern.

The project does not currently use sharding or partitioning. If usage grew one hundred times, I’d first watch full-roster reads, repeated attendance totals, reporting queries, and the size of the PostgreSQL connection pool. I would then add pagination, measure query plans, add indexes for observed query patterns, and consider stored rollups or date-based partitioning if the history volume justified it. I would move off SQLite before running multiple app instances.

[Show the index definitions in `server/postgres-store.js` and the scaling section in `DATABASE_DESIGN.md`.]

## Closing

To summarize, the project uses relational storage for structured attendance data and relationships. SQLite supports local development, PostgreSQL is the hosted relational option, and Firestore is available as an alternative Firebase-backed mode. The schema uses keys, constraints, and transactions to protect attendance records, with a few deliberate summary fields and check-in snapshots to support the application’s reads.

Thank you.

## Quick recording notes

- Keep the source files or `DATABASE_DESIGN.md` open in another window so you can switch to the on-screen cues.
- Speak the headings naturally; you do not need to say “Q1” through “Q5” unless that suits your presentation style.
- The sample student is seeded development data, not a claim about a live production roster.
