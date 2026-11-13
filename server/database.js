import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const dataDirectory = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/attendance' : path.join(projectRoot, 'data'))
fs.mkdirSync(dataDirectory, { recursive: true })

export const database = new Database(path.join(dataDirectory, 'attendance.sqlite'))
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    roll TEXT NOT NULL COLLATE NOCASE UNIQUE,
    department TEXT NOT NULL,
    percentage REAL NOT NULL DEFAULT 100 CHECK (percentage >= 0 AND percentage <= 100),
    today TEXT NOT NULL DEFAULT 'unmarked' CHECK (today IN ('present', 'absent', 'late', 'unmarked')),
    notified INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 1,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS session_tokens (
    token TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    roll TEXT NOT NULL COLLATE NOCASE,
    session_id TEXT NOT NULL REFERENCES attendance_sessions(id),
    attendance_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    distance_m INTEGER NOT NULL,
    UNIQUE(student_id, session_id)
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'qr')),
    recorded_by INTEGER REFERENCES users(id),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (student_id, attendance_date)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'faculty')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`)

const sampleNames = [
  'Aarav Sharma', 'Ananya Reddy', 'Rohan Verma', 'Priya Nair', 'Karthik Iyer',
  'Sneha Patel', 'Vikram Singh', 'Meera Joshi', 'Arjun Rao', 'Divya Menon',
  'Rahul Gupta', 'Isha Kapoor', 'Sai Teja', 'Neha Desai', 'Aditya Kumar',
  'Pooja Hegde', 'Manoj Pillai', 'Kavya Shetty', 'Harsh Vardhan',
  'Lakshmi Prasad', 'Nikhil Bose', 'Swathi Reddy', 'Tarun Mehta', 'Zoya Khan',
]
const samplePercentages = [96, 91, 68, 88, 72, 94, 59, 83, 90, 77, 62, 97, 81, 70, 86, 93, 55, 89, 74, 85, 66, 92, 79, 64]
const sampleToday = ['present', 'present', 'absent', 'present', 'late', 'present', 'absent', 'present', 'present', 'late', 'absent', 'present', 'present', 'absent', 'present', 'present', 'absent', 'present', 'unmarked', 'present', 'absent', 'present', 'unmarked', 'absent']
const sampleDepartments = ['CSE', 'ECE', 'Mechanical', 'Civil', 'IT']

function insertSeedStudents() {
  const add = database.prepare(`INSERT INTO students (name, roll, department, percentage, today, notified)
    VALUES (?, ?, ?, ?, ?, 0)`)
  const transaction = database.transaction(() => {
    sampleNames.forEach((name, id) => add.run(
      name,
      `22${['CS', 'EC', 'ME', 'CE', 'IT'][id % 5]}${101 + id}`,
      sampleDepartments[id % sampleDepartments.length],
      samplePercentages[id],
      sampleToday[id],
    ))
  })
  transaction()
}

function migrateLegacyJson() {
  const legacyFile = path.join(dataDirectory, 'attendance.json')
  if (!fs.existsSync(legacyFile) || database.prepare('SELECT COUNT(*) AS count FROM students').get().count > 0) return
  let legacy
  try { legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) } catch { return }
  if (!Array.isArray(legacy.students)) return
  const transaction = database.transaction(() => {
    const add = database.prepare(`INSERT OR IGNORE INTO students (id, name, roll, department, percentage, today, notified)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    for (const [index, student] of legacy.students.entries()) {
      if (!student?.name || !student?.roll || !student?.department) continue
      add.run(Number.isInteger(student.id) ? student.id + 1 : index + 1, student.name, student.roll,
        student.department, Number(student.percentage) || 100,
        ['present', 'absent', 'late', 'unmarked'].includes(student.today) ? student.today : 'unmarked', student.notified ? 1 : 0)
    }
    if (legacy.geofence) writeSetting('geofence', legacy.geofence)
    for (const entry of legacy.checkins || []) {
      const student = database.prepare('SELECT id FROM students WHERE roll = ? COLLATE NOCASE').get(entry.roll)
      if (!student || !entry.date) continue
      const sessionId = `legacy-${entry.date}`
      database.prepare('INSERT OR IGNORE INTO attendance_sessions (id, active, started_at, ended_at) VALUES (?, 0, ?, ?)')
        .run(sessionId, Date.now(), Date.now())
      database.prepare(`INSERT OR IGNORE INTO checkins (id, student_id, roll, session_id, attendance_date, created_at, latitude, longitude, distance_m)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`).run(entry.id || crypto.randomUUID(), student.id, entry.roll, sessionId, entry.date, entry.time || new Date().toISOString())
      database.prepare(`INSERT OR IGNORE INTO attendance_records (student_id, attendance_date, status, source, recorded_at)
        VALUES (?, ?, 'present', 'qr', ?)`).run(student.id, entry.date, entry.time || new Date().toISOString())
    }
  })
  transaction()
  console.log('Imported the existing attendance.json data into attendance.sqlite.')
}

migrateLegacyJson()

const studentCount = database.prepare('SELECT COUNT(*) AS count FROM students').get().count
if (studentCount === 0 && process.env.NODE_ENV !== 'production') insertSeedStudents()

const defaultSettings = [
  ['geofence', JSON.stringify({ center: null, radius: 50 })],
]
const insertSetting = database.prepare('INSERT OR IGNORE INTO settings (setting_key, value) VALUES (?, ?)')
defaultSettings.forEach(([key, value]) => insertSetting.run(key, value))

export function readSetting(key, fallback = null) {
  const row = database.prepare('SELECT value FROM settings WHERE setting_key = ?').get(key)
  return row ? JSON.parse(row.value) : fallback
}

export function writeSetting(key, value) {
  database.prepare(`INSERT INTO settings (setting_key, value) VALUES (?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value))
}

const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count
const firebaseMode = process.env.FIREBASE_ENABLED === 'true' && Boolean(process.env.FIREBASE_PROJECT_ID)
if (!firebaseMode && userCount === 0 && (process.env.ADMIN_SETUP_TOKEN || process.env.NODE_ENV !== 'production' || !database.prepare("SELECT value FROM settings WHERE setting_key = 'admin_setup_hash'").get())) {
  const setupToken = process.env.ADMIN_SETUP_TOKEN || crypto.randomBytes(24).toString('base64url')
  writeSetting('admin_setup_hash', crypto.createHash('sha256').update(setupToken).digest('hex'))
  if (!process.env.ADMIN_SETUP_TOKEN) {
    console.log(`One-time admin setup token: ${setupToken}`)
    console.log('Set ADMIN_SETUP_TOKEN in the deployment environment if you need to replace this token.')
  }
}

export function writeAudit(actorId, action, entityType, entityId = null, details = {}) {
  database.prepare(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(actorId, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details), new Date().toISOString())
}

export function listStudents() {
  return database.prepare(`SELECT s.id, s.name, s.roll, s.department, s.percentage, s.today, s.notified,
      (SELECT status FROM attendance_records a WHERE a.student_id = s.id AND a.attendance_date = ? LIMIT 1) AS recorded_today
    FROM students s ORDER BY s.name`).all(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata' }).format(new Date()))
    .map((student) => ({ ...student, notified: Boolean(student.notified) }))
}

export function getGeofence() {
  return readSetting('geofence', { center: null, radius: 50 })
}

export function createStudent(student) {
  const result = database.prepare(`INSERT INTO students (name, roll, department, percentage, today, notified)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    student.name.trim(), student.roll.trim().toUpperCase(), student.department.trim(),
    student.percentage ?? 100, student.today ?? 'unmarked', student.notified ? 1 : 0,
  )
  return database.prepare('SELECT id, name, roll, department, percentage, today, notified FROM students WHERE id = ?').get(Number(result.lastInsertRowid)
  )
}
