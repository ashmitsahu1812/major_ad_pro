# Query execution output

These results were captured by executing `queries.sql` with `psql` against a temporary PostgreSQL 18 database loaded from `schema.sql` and `sample_data.sql`. The four students and all related values are synthetic, not production records. Query 6 and query 10 change the demo database; query 6 is idempotent by unique roll number and query 10 removes only the explicitly named expired demo token.

## Expected result summary

1. Roster: four students ordered Aarav, Anaya, Mira, Rohan.
2. CSE filter: `DE-CS-001 Aarav Demo`, `DE-CS-002 Anaya Demo`.
3. `HAVING COUNT(*) >= 2`: CSE 2.
4. Joined attendance: DE-CS-001 present/qr; DE-CS-002 absent/manual; DE-EC-001 present/manual; DE-ME-001 late/manual.
5. Aggregate: `marked=4`, `attended=3`, `attendance_percent=75.0`.
6. Insert: returns `de-stu-005 | DE-IT-001 | IT` on first run; returns no rows on a repeat because the roll already exists.
7. Update: returns `DE-CS-002 | t`.
8. At-risk departments: CSE at 50.0 percent.
9. Recent check-ins: two rows, DE-EC-001 at 09:02 UTC then DE-CS-001 at 09:00 UTC.
10. Delete: returns `de-expired-token` and `DELETE 1` on first run; a repeat returns no rows.

For the video, display the actual `psql` output after running these commands locally. If output differs, confirm that the demo database is fresh and that `schema.sql` and `sample_data.sql` were both run first.
