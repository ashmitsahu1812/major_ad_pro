# ER diagram

```mermaid
erDiagram
  STUDENTS ||--o{ ATTENDANCE_RECORDS : receives
  STUDENTS ||--o{ CHECKINS : submits
  ATTENDANCE_SESSIONS ||--o{ SESSION_TOKENS : issues

  STUDENTS {
    text id PK
    text roll UK
    text name
    text department
    real percentage
    text today
    boolean notified
  }
  ATTENDANCE_RECORDS {
    text student_id PK, FK
    text attendance_date PK
    text status
    text source
    text recorded_by
    text recorded_at
  }
  CHECKINS {
    text id PK
    text student_id FK
    text name
    text roll
    text attendance_date
    text created_at
    integer distance_m
    real latitude
    real longitude
  }
  ATTENDANCE_SESSIONS {
    text id PK
    boolean active
    bigint started_at
    bigint ended_at
  }
  SESSION_TOKENS {
    text token PK
    text session_id FK
    bigint created_at
    bigint expires_at
  }
  STAFF {
    text email PK
    text name
    text role
    boolean active
    text created_at
  }
  SETTINGS {
    text setting_key PK
    jsonb value
  }
  AUDIT_LOG {
    bigint id PK
    text actor
    text action
    text entity_type
    text entity_id
    jsonb details
    text created_at
  }
```

`attendance_records` is the associative entity for the many-to-many student/date relationship. The date is stored as an ISO date value in a text column to match the current backend schema. The PostgreSQL schema does not have a `dates` table or a direct check-in-to-session foreign key. `audit_log.actor` is intentionally text because actors can be Firebase identities; it is not a foreign key to `staff`.
