import crypto from 'node:crypto'
import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL mode.')

const databaseUrl = new URL(process.env.DATABASE_URL)
if (!databaseUrl.searchParams.has('sslmode')) databaseUrl.searchParams.set('sslmode', process.env.PG_SSL === 'false' ? 'disable' : 'require')

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  max: Number(process.env.PG_POOL_MAX || 5),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
})

const todayKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
const attended = (status) => status === 'present' || status === 'late'

export async function initializePostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, roll TEXT NOT NULL UNIQUE, department TEXT NOT NULL,
      percentage REAL NOT NULL DEFAULT 100, today TEXT NOT NULL DEFAULT 'unmarked', notified BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS attendance_records (
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, attendance_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present','absent','late')), source TEXT NOT NULL DEFAULT 'manual',
      recorded_by TEXT, recorded_at TEXT NOT NULL, PRIMARY KEY (student_id, attendance_date)
    );
    CREATE TABLE IF NOT EXISTS settings (setting_key TEXT PRIMARY KEY, value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT TRUE, started_at BIGINT NOT NULL, ended_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS session_tokens (
      token TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      name TEXT NOT NULL, roll TEXT NOT NULL, attendance_date TEXT NOT NULL, created_at TEXT NOT NULL,
      distance_m INTEGER NOT NULL, latitude REAL, longitude REAL, UNIQUE(student_id, attendance_date)
    );
    CREATE TABLE IF NOT EXISTS staff (
      email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'faculty',
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, details JSONB NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_migrations (migration_key TEXT PRIMARY KEY, completed_at TEXT NOT NULL, row_counts JSONB NOT NULL);
    CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance_records(attendance_date);
    CREATE INDEX IF NOT EXISTS checkins_date_idx ON checkins(attendance_date, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
  `)
  await pool.query(`INSERT INTO settings (setting_key, value) VALUES ('geofence', $1::jsonb) ON CONFLICT (setting_key) DO NOTHING`, [JSON.stringify({ center: null, radius: 50 })])
}

export async function pingPostgres() {
  await pool.query('SELECT 1')
  return true
}

async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function addAudit(actor, action, entityType, entityId = null, details = {}, client = pool) {
  await client.query('INSERT INTO audit_log (actor, action, entity_type, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [actor?.email || null, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details), new Date().toISOString()])
}

export async function getStaff(email) {
  const result = await pool.query('SELECT email, name, role, active, created_at AS "createdAt" FROM staff WHERE email = $1', [email.toLowerCase()])
  return result.rows[0] || null
}

export async function listStaff() {
  const result = await pool.query('SELECT email AS id, email, name, role, active, created_at AS "createdAt" FROM staff ORDER BY name')
  return result.rows
}

export async function addStaff({ name, email }) {
  const normalizedEmail = email.trim().toLowerCase()
  const result = await pool.query(`INSERT INTO staff (email, name, role, active, created_at) VALUES ($1,$2,'faculty',TRUE,$3)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, active = TRUE RETURNING email AS id, email, name, role, active, created_at AS "createdAt"`, [normalizedEmail, name.trim(), new Date().toISOString()])
  return result.rows[0]
}

export async function listStudents() {
  const today = todayKey()
  const result = await pool.query(`SELECT s.id, s.name, s.roll, s.department, s.percentage, s.today, s.notified,
    COALESCE(day.status, s.today) AS today, COALESCE(stats.total, 0) AS total_sessions,
    CASE WHEN COALESCE(stats.total, 0) = 0 THEN s.percentage ELSE ROUND(100.0 * stats.attended / stats.total) END AS percentage
    FROM students s
    LEFT JOIN attendance_records day ON day.student_id = s.id AND day.attendance_date = $1
    LEFT JOIN LATERAL (SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status IN ('present','late')) AS attended FROM attendance_records WHERE student_id = s.id) stats ON TRUE
    ORDER BY s.name`, [today])
  return result.rows.map((student) => ({ ...student, percentage: Number(student.percentage), notified: Boolean(student.notified) }))
}

export async function getGeofence() {
  const result = await pool.query('SELECT value FROM settings WHERE setting_key = $1', ['geofence'])
  return result.rows[0]?.value || { center: null, radius: 50 }
}

export async function saveGeofence(geofence) {
  await pool.query(`INSERT INTO settings (setting_key, value) VALUES ('geofence',$1::jsonb) ON CONFLICT (setting_key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(geofence)])
  return geofence
}

export async function currentSession(rotate = false) {
  const geofence = await getGeofence()
  if (!geofence.center) return null
  const result = await pool.query('SELECT * FROM attendance_sessions WHERE active = TRUE ORDER BY started_at DESC LIMIT 1')
  const session = result.rows[0]
  if (!session) return null
  const now = Date.now()
  const tokens = await pool.query('SELECT * FROM session_tokens WHERE session_id = $1 AND expires_at > $2 ORDER BY created_at DESC LIMIT 1', [session.id, now])
  let token = tokens.rows[0]
  if (rotate || !token || now - Number(token.created_at) >= 30_000) {
    token = { token: crypto.randomBytes(24).toString('base64url'), created_at: now, expires_at: now + 90_000 }
    await pool.query('DELETE FROM session_tokens WHERE expires_at <= $1', [now])
    await pool.query('INSERT INTO session_tokens (token, session_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [token.token, session.id, now, token.expires_at])
  }
  return { active: true, sessionId: session.id, token: token.token, createdAt: Number(token.created_at), expiresAt: Number(token.expires_at), refreshInSeconds: Math.max(1, Math.ceil((30_000 - (now - Number(token.created_at))) / 1000)) }
}

export async function verifySessionToken(token) {
  const result = await pool.query(`SELECT 1 FROM session_tokens t JOIN attendance_sessions s ON s.id=t.session_id
    WHERE t.token=$1 AND t.expires_at>$2 AND s.active=TRUE`, [String(token), Date.now()])
  const geofence = await getGeofence()
  return { valid: result.rowCount > 0, radius: geofence.radius, locationSet: Boolean(geofence.center) }
}

export async function startSession(actor) {
  await withTransaction(async (client) => {
    const now = Date.now()
    await client.query('UPDATE attendance_sessions SET active = FALSE, ended_at = $1 WHERE active = TRUE', [now])
    await client.query('INSERT INTO attendance_sessions (id, active, started_at) VALUES ($1,TRUE,$2)', [crypto.randomUUID(), now])
  })
  const session = await currentSession(true)
  await addAudit(actor, 'attendance.session.started', 'session', session?.sessionId)
  return session
}

export async function endSession(actor) {
  await pool.query('UPDATE attendance_sessions SET active = FALSE, ended_at = $1 WHERE active = TRUE', [Date.now()])
  await addAudit(actor, 'attendance.session.ended', 'session')
}

async function recordAttendance(client, studentId, status, actorId, source = 'manual', date = todayKey()) {
  await client.query(`INSERT INTO attendance_records (student_id,attendance_date,status,source,recorded_by,recorded_at)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (student_id,attendance_date) DO UPDATE SET status=EXCLUDED.status, source=EXCLUDED.source, recorded_by=EXCLUDED.recorded_by, recorded_at=EXCLUDED.recorded_at`, [String(studentId), date, status, source, actorId == null ? null : String(actorId), new Date().toISOString()])
  await client.query('UPDATE students SET today=$1 WHERE id=$2', [status, String(studentId)])
}

export async function setStudentAttendance(id, changes, actor) {
  await withTransaction(async (client) => {
    const student = await client.query('SELECT * FROM students WHERE id=$1', [String(id)])
    if (!student.rowCount) throw new Error('Student not found.')
    if (changes.today !== undefined) {
      if (!['present','absent','late','unmarked'].includes(changes.today)) throw new Error('Invalid attendance status.')
      if (changes.today === 'unmarked') {
        await client.query('DELETE FROM attendance_records WHERE student_id=$1 AND attendance_date=$2', [String(id), todayKey()])
        await client.query('UPDATE students SET today=$1 WHERE id=$2', ['unmarked', String(id)])
      } else await recordAttendance(client, id, changes.today, actor?.id)
    }
    if (changes.notified !== undefined) await client.query('UPDATE students SET notified=$1 WHERE id=$2', [Boolean(changes.notified), String(id)])
    await addAudit(actor, 'student.updated', 'student', id, changes, client)
  })
  const rows = await listStudents()
  return rows.find((row) => String(row.id) === String(id))
}

export async function createStudent(input, actor) {
  const id = crypto.randomUUID()
  const result = await pool.query(`INSERT INTO students (id,name,roll,department) VALUES ($1,$2,$3,$4)
    RETURNING id,name,roll,department,percentage,today,notified`, [id, input.name.trim(), input.roll.trim().toUpperCase(), input.department.trim()])
  await addAudit(actor, 'student.created', 'student', id)
  return result.rows[0]
}

export async function importStudents(items, actor) {
  let added = 0; let updated = 0
  await withTransaction(async (client) => {
    for (const item of items) {
      if (!item?.name?.trim() || !item?.roll?.trim() || !item?.department?.trim()) continue
      const result = await client.query(`INSERT INTO students (id,name,roll,department) VALUES ($1,$2,$3,$4)
        ON CONFLICT (roll) DO UPDATE SET name=EXCLUDED.name, department=EXCLUDED.department RETURNING (xmax = 0) AS inserted`, [crypto.randomUUID(), item.name.trim(), item.roll.trim().toUpperCase(), item.department.trim()])
      if (result.rows[0].inserted) added += 1; else updated += 1
    }
  })
  await addAudit(actor, 'students.imported', 'student', null, { added, updated })
  return { added, updated, students: await listStudents() }
}

export async function markAll(status, actor) {
  await withTransaction(async (client) => {
    const date = todayKey()
    if (status === 'unmarked') {
      await client.query('DELETE FROM attendance_records WHERE attendance_date=$1 AND source=$2', [date, 'manual'])
      await client.query(`UPDATE students s SET today=COALESCE((SELECT status FROM attendance_records a WHERE a.student_id=s.id AND a.attendance_date=$1),'unmarked')`, [date])
    } else {
      const students = await client.query('SELECT id FROM students')
      for (const student of students.rows) await recordAttendance(client, student.id, 'present', actor?.id)
    }
  })
  await addAudit(actor, 'attendance.marked_all', 'attendance', null, { status })
  return listStudents()
}

export async function checkIn({ token, roll, latitude, longitude }) {
  return withTransaction(async (client) => {
    const tokenResult = await client.query(`SELECT t.*, s.active FROM session_tokens t JOIN attendance_sessions s ON s.id=t.session_id
      WHERE t.token=$1 AND t.expires_at>$2`, [String(token), Date.now()])
    if (!tokenResult.rowCount || !tokenResult.rows[0].active) throw new Error('This pass has expired. Scan the latest classroom QR code.')
    const geofence = await client.query('SELECT value FROM settings WHERE setting_key=$1', ['geofence'])
    const geo = geofence.rows[0]?.value
    if (!geo?.center) throw new Error('The faculty member has not set the classroom location yet.')
    const match = await client.query('SELECT * FROM students WHERE UPPER(roll)=UPPER($1) LIMIT 1', [String(roll || '').trim()])
    const student = match.rows[0]
    if (!student) throw new Error('Student profile was not found. Ask your faculty member to check the roster.')
    const radians = (degrees) => degrees * Math.PI / 180
    const dLat = radians(latitude - geo.center.latitude); const dLon = radians(longitude - geo.center.longitude)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(geo.center.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLon / 2) ** 2
    const distance = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (distance > geo.radius) throw new Error(`You are about ${Math.round(distance)} m from class. The check-in limit is ${geo.radius} m.`)
    const date = todayKey()
    const existing = await client.query('SELECT 1 FROM attendance_records WHERE student_id=$1 AND attendance_date=$2', [student.id, date])
    if (existing.rowCount) throw new Error('Attendance has already been recorded for you today.')
    const checkin = { id: crypto.randomUUID(), studentId: student.id, name: student.name, roll: student.roll, date, time: new Date().toISOString(), distance: Math.round(distance) }
    await recordAttendance(client, student.id, 'present', null, 'qr', date)
    await client.query(`INSERT INTO checkins (id,student_id,name,roll,attendance_date,created_at,distance_m,latitude,longitude)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [checkin.id, student.id, student.name, student.roll, date, checkin.time, checkin.distance, latitude, longitude])
    return { checkin, student: { ...student, today: 'present' }, distance: Math.round(distance) }
  })
}

export async function recentCheckins() {
  const result = await pool.query(`SELECT id,student_id AS "studentId",name,roll,attendance_date AS date,created_at AS time,distance_m AS distance
    FROM checkins WHERE attendance_date=$1 ORDER BY created_at DESC LIMIT 8`, [todayKey()])
  return result.rows
}

export async function weeklyAttendance() {
  const roster = await pool.query('SELECT COUNT(*) AS count FROM students')
  const result = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(); date.setDate(date.getDate() - offset)
    const key = todayKey(date)
    const rows = await pool.query(`SELECT COUNT(*) FILTER (WHERE status IN ('present','late')) AS attended FROM attendance_records WHERE attendance_date=$1`, [key])
    result.push({ day: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata' }).format(date), value: Number(roster.rows[0].count) ? Math.round(100 * Number(rows.rows[0].attended) / Number(roster.rows[0].count)) : 0 })
  }
  return result
}

export async function attendanceReport() {
  const result = await pool.query(`SELECT attendance_date AS date,status,source,COUNT(*) AS count FROM attendance_records
    GROUP BY attendance_date,status,source ORDER BY attendance_date DESC LIMIT 180`)
  return result.rows.map((row) => ({ ...row, count: Number(row.count) }))
}

export async function auditEntries() {
  const result = await pool.query(`SELECT id,actor,action,entity_type AS "entityType",entity_id AS "entityId",details,created_at AS "createdAt"
    FROM audit_log ORDER BY id DESC LIMIT 200`)
  return result.rows
}

export async function importFirestoreSnapshot(snapshot) {
  const getDocs = (name) => snapshot[name] || []
  return withTransaction(async (client) => {
    const prior = await client.query('SELECT 1 FROM data_migrations WHERE migration_key=$1', ['firestore-to-postgres-v1'])
    if (prior.rowCount) return { skipped: true }
    const existing = await client.query('SELECT COUNT(*) AS count FROM students')
    if (Number(existing.rows[0].count) > 0) throw new Error('The PostgreSQL roster is not empty. Migration stopped to avoid mixing datasets.')
    for (const item of getDocs('students')) {
      const doc = item.data; const id = String(doc.id ?? item.id)
      await client.query(`INSERT INTO students (id,name,roll,department,percentage,today,notified) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,roll=EXCLUDED.roll,department=EXCLUDED.department,percentage=EXCLUDED.percentage,today=EXCLUDED.today,notified=EXCLUDED.notified`, [id, doc.name, doc.roll, doc.department, Number(doc.percentage ?? 100), doc.today || 'unmarked', Boolean(doc.notified)])
    }
    for (const item of getDocs('attendance')) {
      const doc = item.data
      await client.query(`INSERT INTO attendance_records (student_id,attendance_date,status,source,recorded_at) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (student_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,source=EXCLUDED.source,recorded_at=EXCLUDED.recorded_at`, [String(doc.studentId), String(doc.date), doc.status, doc.source || 'manual', doc.recordedAt || new Date().toISOString()])
    }
    for (const item of getDocs('settings')) {
      if (item.id === 'geofence') await client.query(`INSERT INTO settings (setting_key,value) VALUES ('geofence',$1::jsonb) ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(item.data)])
    }
    for (const item of getDocs('attendanceSessions')) {
      const doc = item.data
      await client.query(`INSERT INTO attendance_sessions (id,active,started_at,ended_at) VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET active=EXCLUDED.active,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at`, [item.id, Boolean(doc.active), Number(doc.startedAt || Date.now()), doc.endedAt == null ? null : Number(doc.endedAt)])
    }
    for (const item of getDocs('qrTokens')) {
      const doc = item.data
      await client.query(`INSERT INTO session_tokens (token,session_id,created_at,expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT (token) DO NOTHING`, [item.id, String(doc.sessionId), Number(doc.createdAt || Date.now()), Number(doc.expiresAt || 0)])
    }
    for (const item of getDocs('checkins')) {
      const doc = item.data
      if (!doc.studentId || !doc.date) continue
      await client.query(`INSERT INTO checkins (id,student_id,name,roll,attendance_date,created_at,distance_m) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO NOTHING`, [String(doc.id || item.id), String(doc.studentId), doc.name || '', doc.roll || '', String(doc.date), doc.time || new Date().toISOString(), Number(doc.distance || 0)])
    }
    for (const item of getDocs('staff')) {
      const doc = item.data
      if (!doc.email) continue
      await client.query(`INSERT INTO staff (email,name,role,active,created_at) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,active=EXCLUDED.active`, [doc.email.toLowerCase(), doc.name || doc.email, doc.role || 'faculty', doc.active !== false, doc.createdAt || new Date().toISOString()])
    }
    for (const item of getDocs('auditLog')) {
      const doc = item.data
      await client.query(`INSERT INTO audit_log (actor,action,entity_type,entity_id,details,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [doc.actor || null, doc.action || 'migration.imported', doc.entityType || 'system', doc.entityId == null ? null : String(doc.entityId), JSON.stringify(doc.details || {}), doc.createdAt || new Date().toISOString()])
    }
    const rowCounts = Object.fromEntries(Object.entries(snapshot).map(([name, documents]) => [name, documents.length]))
    await client.query('INSERT INTO data_migrations (migration_key,completed_at,row_counts) VALUES ($1,$2,$3::jsonb)', ['firestore-to-postgres-v1', new Date().toISOString(), JSON.stringify(rowCounts)])
    return { skipped: false, rowCounts }
  })
}
