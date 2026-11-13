import crypto from 'node:crypto'
import express from 'express'
import { database, getGeofence, listStudents, readSetting, writeAudit, writeSetting } from './database.js'
import { firebaseEnabled, getFirebaseFirestore, verifyFirebaseUser } from './firebase-admin.js'
import * as cloud from './firestore-store.js'

const port = Number(process.env.PORT || 4173)
const app = express()
const sevenDays = 7 * 24 * 60 * 60 * 1000
const loginAttempts = new Map()
if (firebaseEnabled) await cloud.migrateLocalData()
app.disable('x-powered-by')
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'geolocation=(self)')
  if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})
app.use(express.json({ limit: '1mb' }))

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (name) => parts.find((item) => item.type === name)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function distanceInMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180
  const lat = radians(second.latitude - first.latitude)
  const lon = radians(second.longitude - first.longitude)
  const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(lon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function sendError(response, status, error) { return response.status(status).json({ error }) }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }
}
function safeEqual(first, second) {
  const a = Buffer.from(first || '')
  const b = Buffer.from(second || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${sevenDays / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` }
function cookieToken(request) {
  const item = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('attendance_session='))
  return item?.slice('attendance_session='.length) || ''
}
async function currentUser(request) {
  if (firebaseEnabled) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')
    if (!match) return null
    try {
      const identity = await verifyFirebaseUser(match[1])
      if (!identity) return null
      return { ...identity, id: identity.uid, authProvider: 'firebase' }
    } catch { return null }
  }
  const token = cookieToken(request)
  if (!token) return null
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const row = database.prepare(`SELECT u.id, u.name, u.email, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(hash, Date.now())
  return row || null
}
async function requireAuthenticated(request, response, next) {
  const user = await currentUser(request)
  if (!user) return sendError(response, 401, 'Sign in with a faculty account to continue.')
  request.user = user
  next()
}
function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return sendError(response, 403, 'Administrator access is required for this action.')
  next()
}
function studentList() {
  const today = localDate()
  const students = listStudents()
  return students.map((student) => {
    const stats = database.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
      FROM attendance_records WHERE student_id = ?`).get(student.id)
    const count = Number(stats.total || 0)
    return { ...student, today: student.recorded_today || student.today, percentage: count ? Math.round(100 * Number(stats.attended || 0) / count) : student.percentage }
  })
}
function weeklyAttendance() {
  const result = []
  const totals = database.prepare(`SELECT attendance_date, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
    FROM attendance_records WHERE attendance_date BETWEEN ? AND ? GROUP BY attendance_date`)
  const rosterSize = database.prepare('SELECT COUNT(*) AS count FROM students').get().count
  const today = new Date()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const key = localDate(date)
    const row = totals.get(key, key)
    result.push({ day: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata' }).format(date), value: rosterSize ? Math.round(100 * Number(row?.attended || 0) / rosterSize) : 0 })
  }
  return result
}
function recordAttendance(studentId, status, actorId, source = 'manual', date = localDate()) {
  database.prepare(`INSERT INTO attendance_records (student_id, attendance_date, status, source, recorded_by, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(student_id, attendance_date) DO UPDATE SET
    status = excluded.status, source = excluded.source, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`)
    .run(studentId, date, status, source, actorId || null, new Date().toISOString())
  database.prepare('UPDATE students SET today = ? WHERE id = ?').run(status, studentId)
  writeAudit(actorId || null, 'attendance.recorded', 'student', studentId, { status, date, source })
}
function activeSession(rotate = false) {
  let session = database.prepare('SELECT * FROM attendance_sessions WHERE active = 1 ORDER BY started_at DESC LIMIT 1').get()
  if (!session || !getGeofence().center) return null
  const now = Date.now()
  let token = database.prepare('SELECT * FROM session_tokens WHERE session_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1').get(session.id, now)
  if (rotate || !token || now - token.created_at >= 30_000) {
    const value = crypto.randomBytes(24).toString('base64url')
    database.prepare('DELETE FROM session_tokens WHERE expires_at <= ?').run(now)
    database.prepare('INSERT INTO session_tokens (token, session_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(value, session.id, now, now + 90_000)
    token = { token: value, created_at: now, expires_at: now + 90_000 }
  }
  return { active: true, sessionId: session.id, token: token.token, createdAt: token.created_at, expiresAt: token.expires_at, refreshInSeconds: Math.max(1, Math.ceil((30_000 - (now - token.created_at)) / 1000)) }
}
function validStudent(student) {
  return typeof student?.name === 'string' && student.name.trim() && typeof student?.roll === 'string' && student.roll.trim() && typeof student?.department === 'string' && student.department.trim()
}

app.get('/api/auth/status', (_request, response) => response.json({ setupRequired: !firebaseEnabled && database.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0, firebaseEnabled }))
app.get('/api/auth/me', async (request, response) => response.json({ user: await currentUser(request) }))
app.post('/api/auth/setup', (request, response) => {
  if (firebaseEnabled) return sendError(response, 409, 'Sign in through your approved Google account to create the first admin profile.')
  const { token, name, email, password } = request.body || {}
  if (database.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return sendError(response, 409, 'Initial administrator setup is already complete.')
  const storedHash = readSetting('admin_setup_hash', '')
  const suppliedHash = crypto.createHash('sha256').update(String(token || '')).digest('hex')
  if (!safeEqual(storedHash, suppliedHash)) return sendError(response, 403, 'The one-time setup token is invalid.')
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12) return sendError(response, 400, 'Enter a name, valid email, and password with at least 12 characters.')
  const credential = hashPassword(password)
  const createdAt = new Date().toISOString()
  const result = database.prepare('INSERT INTO users (name, email, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, \'admin\', ?)').run(name.trim(), email.trim().toLowerCase(), credential.salt, credential.hash, createdAt)
  writeSetting('admin_setup_hash', '')
  writeAudit(Number(result.lastInsertRowid), 'admin.created', 'user', result.lastInsertRowid)
  return signIn(response, Number(result.lastInsertRowid))
})
function signIn(response, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const now = Date.now()
  database.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now + sevenDays, now)
  response.setHeader('Set-Cookie', `attendance_session=${token}; ${cookieOptions()}`)
  return response.json({ user: database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId) })
}
app.post('/api/auth/login', (request, response) => {
  if (firebaseEnabled) return sendError(response, 409, 'Use Google sign-in for this Firebase-connected workspace.')
  const address = request.ip || request.socket.remoteAddress || 'unknown'
  const attempts = loginAttempts.get(address) || { count: 0, until: Date.now() + 15 * 60_000 }
  if (attempts.count >= 10 && attempts.until > Date.now()) return sendError(response, 429, 'Too many sign-in attempts. Try again in 15 minutes.')
  const { email, password } = request.body || {}
  const user = database.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1').get(String(email || ''))
  if (!user || typeof password !== 'string' || !safeEqual(hashPassword(password, user.password_salt).hash, user.password_hash)) {
    attempts.count += 1
    loginAttempts.set(address, attempts)
    return sendError(response, 401, 'Email or password is incorrect.')
  }
  loginAttempts.delete(address)
  return signIn(response, user.id)
})
app.post('/api/auth/logout', (request, response) => {
  const token = cookieToken(request)
  if (token) database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex'))
  response.setHeader('Set-Cookie', `attendance_session=; ${cookieOptions().replace(`Max-Age=${sevenDays / 1000}`, 'Max-Age=0')}`)
  response.json({ ok: true })
})
app.get('/api/health', (_request, response) => {
  try { database.prepare('SELECT 1').get(); response.json({ ok: true }) }
  catch { response.status(503).json({ ok: false }) }
})

app.get('/api/session/verify/:token', async (request, response) => {
  if (firebaseEnabled) {
    const firestore = getFirebaseFirestore()
    const pass = await firestore.collection('qrTokens').doc(request.params.token).get()
    const activeSession = pass.exists && pass.get('expiresAt') > Date.now()
      ? await firestore.collection('attendanceSessions').doc(pass.get('sessionId')).get() : null
    if (!activeSession?.exists || !activeSession.get('active')) return sendError(response, 404, 'This attendance pass has expired. Scan the current classroom QR code.')
    const geofence = await cloud.getGeofenceCloud()
    return response.json({ valid: true, radius: geofence.radius, locationSet: Boolean(geofence.center) })
  }
  const session = database.prepare(`SELECT session_id FROM session_tokens WHERE token = ? AND expires_at > ?`).get(request.params.token, Date.now())
  const active = session && database.prepare('SELECT id FROM attendance_sessions WHERE id = ? AND active = 1').get(session.session_id)
  if (!active) return sendError(response, 404, 'This attendance pass has expired. Scan the current classroom QR code.')
  const geofence = getGeofence()
  response.json({ valid: true, radius: geofence.radius, locationSet: Boolean(geofence.center) })
})

app.use('/api', (request, response, next) => {
  if (request.method === 'POST' && request.originalUrl.split('?')[0] === '/api/checkins') return next()
  return requireAuthenticated(request, response, next)
})

app.get('/api/bootstrap', async (_request, response) => {
  if (firebaseEnabled) return response.json({ students: await cloud.listStudentsCloud(), geofence: await cloud.getGeofenceCloud(), session: await cloud.activeSessionCloud(), checkins: await cloud.recentCheckinsCloud(), weekly: await cloud.weeklyAttendanceCloud() })
  const today = localDate()
  const checkins = database.prepare(`SELECT c.id, s.name, s.roll, c.attendance_date AS date, c.created_at AS time
    FROM checkins c JOIN students s ON s.id = c.student_id WHERE c.attendance_date = ? ORDER BY c.created_at DESC LIMIT 8`).all(today)
  response.json({ students: studentList(), geofence: getGeofence(), session: activeSession(), checkins, weekly: weeklyAttendance() })
})
app.get('/api/session/current', async (_request, response) => response.json({ session: firebaseEnabled ? await cloud.activeSessionCloud() : activeSession() }))
app.post('/api/session/start', async (request, response) => {
  if (firebaseEnabled) {
    try {
      const session = await cloud.startSessionCloud(request.user.id)
      await cloud.auditCloud(request.user, 'attendance.session.started', 'session', session.sessionId)
      return response.json({ session })
    } catch (error) { return sendError(response, 409, error.message) }
  }
  if (!getGeofence().center) return sendError(response, 409, 'Set the classroom location before starting attendance.')
  const now = Date.now()
  database.prepare('UPDATE attendance_sessions SET active = 0, ended_at = ? WHERE active = 1').run(now)
  const id = crypto.randomUUID()
  database.prepare('INSERT INTO attendance_sessions (id, active, started_at) VALUES (?, 1, ?)').run(id, now)
  writeAudit(request.user.id, 'attendance.session.started', 'session', id)
  response.json({ session: activeSession(true) })
})
app.post('/api/session/end', async (request, response) => {
  if (firebaseEnabled) {
    await cloud.endSessionCloud()
    await cloud.auditCloud(request.user, 'attendance.session.ended', 'session')
    return response.json({ session: null })
  }
  database.prepare('UPDATE attendance_sessions SET active = 0, ended_at = ? WHERE active = 1').run(Date.now())
  writeAudit(request.user.id, 'attendance.session.ended', 'session')
  response.json({ session: null })
})
app.put('/api/geofence', async (request, response) => {
  const { center, radius } = request.body || {}
  const validCenter = center === null || (center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude) && Math.abs(center.latitude) <= 90 && Math.abs(center.longitude) <= 180)
  if (!validCenter) return sendError(response, 400, 'Enter a valid class location.')
  if (![25, 50, 75, 100].includes(Number(radius))) return sendError(response, 400, 'Choose a radius from 25 to 100 meters.')
  const geofence = { center, radius: Number(radius) }
  if (firebaseEnabled) {
    await cloud.saveGeofenceCloud(geofence)
    await cloud.auditCloud(request.user, 'geofence.updated', 'setting', null, { radius: geofence.radius })
    return response.json({ geofence })
  }
  writeSetting('geofence', geofence)
  writeAudit(request.user.id, 'geofence.updated', 'setting', null, { radius: geofence.radius })
  response.json({ geofence })
})
app.post('/api/students', async (request, response) => {
  const input = request.body || {}
  if (!validStudent(input)) return sendError(response, 400, 'Name, roll number, and department are required.')
  if (firebaseEnabled) {
    try {
      const student = await cloud.createStudentCloud(input)
      await cloud.auditCloud(request.user, 'student.created', 'student', student.id)
      return response.status(201).json({ student, students: await cloud.listStudentsCloud() })
    } catch (error) { return sendError(response, error.message.includes('already') ? 409 : 500, error.message) }
  }
  try {
    const result = database.prepare(`INSERT INTO students (name, roll, department, percentage, today, notified) VALUES (?, ?, ?, 100, 'unmarked', 0)`)
      .run(input.name.trim(), input.roll.trim().toUpperCase(), input.department.trim())
    const student = database.prepare('SELECT id, name, roll, department, percentage, today, notified FROM students WHERE id = ?').get(result.lastInsertRowid)
    writeAudit(request.user.id, 'student.created', 'student', student.id)
    response.status(201).json({ student, students: studentList() })
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(response, 409, 'That roll number is already in the roster.'); throw error }
})
app.patch('/api/students/:id', async (request, response) => {
  if (firebaseEnabled) {
    try {
      const student = await cloud.patchStudentCloud(request.params.id, request.body || {})
      await cloud.auditCloud(request.user, 'student.updated', 'student', request.params.id, request.body || {})
      return response.json({ student })
    } catch (error) { return sendError(response, error.message === 'Student not found.' ? 404 : 400, error.message) }
  }
  const id = Number(request.params.id)
  const student = database.prepare('SELECT * FROM students WHERE id = ?').get(id)
  if (!student) return sendError(response, 404, 'Student not found.')
  const { today, notified } = request.body || {}
  if (today !== undefined) {
    if (!['present', 'absent', 'late', 'unmarked'].includes(today)) return sendError(response, 400, 'Invalid attendance status.')
    if (today === 'unmarked') database.prepare('DELETE FROM attendance_records WHERE student_id = ? AND attendance_date = ?').run(id, localDate())
    else recordAttendance(id, today, request.user.id)
  }
  if (notified !== undefined) database.prepare('UPDATE students SET notified = ? WHERE id = ?').run(notified ? 1 : 0, id)
  const updated = studentList().find((entry) => entry.id === id)
  writeAudit(request.user.id, 'student.updated', 'student', id, request.body)
  response.json({ student: updated })
})
app.post('/api/students/import', async (request, response) => {
  const imported = request.body?.students
  if (!Array.isArray(imported)) return sendError(response, 400, 'No student rows were provided.')
  if (imported.length > 5000) return sendError(response, 413, 'Import up to 5,000 students at a time.')
  if (firebaseEnabled) {
    try {
      const result = await cloud.importStudentsCloud(imported)
      await cloud.auditCloud(request.user, 'students.imported', 'student', null, result)
      return response.json({ students: await cloud.listStudentsCloud(), ...result })
    } catch (error) { return sendError(response, 500, error.message) }
  }
  const insert = database.prepare(`INSERT INTO students (name, roll, department, percentage, today, notified) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(roll) DO UPDATE SET name = excluded.name, department = excluded.department`)
  const tx = database.transaction(() => {
    for (const item of imported) if (validStudent(item)) {
      insert.run(item.name.trim(), item.roll.trim().toUpperCase(), item.department.trim(), 100, 'unmarked', 0)
    }
  })
  tx()
  writeAudit(request.user.id, 'students.imported', 'student', null, { rows: imported.length })
  response.json({ students: studentList(), imported: imported.length })
})
app.post('/api/attendance/mark-all', async (request, response) => {
  const { today } = request.body || {}
  if (!['present', 'unmarked'].includes(today)) return sendError(response, 400, 'Invalid attendance status.')
  if (firebaseEnabled) {
    try {
      await cloud.markAllCloud(today)
      await cloud.auditCloud(request.user, 'attendance.marked_all', 'attendance', null, { status: today })
      return response.json({ students: await cloud.listStudentsCloud() })
    } catch (error) { return sendError(response, 500, error.message) }
  }
  const tx = database.transaction(() => {
    if (today === 'unmarked') database.prepare('DELETE FROM attendance_records WHERE attendance_date = ? AND source = ?').run(localDate(), 'manual')
    else for (const student of database.prepare('SELECT id FROM students').all()) recordAttendance(student.id, 'present', request.user.id)
  })
  tx()
  writeAudit(request.user.id, 'attendance.marked_all', 'attendance', null, { status: today })
  response.json({ students: studentList() })
})
app.post('/api/checkins', async (request, response) => {
  const { token, roll: submittedRoll, latitude, longitude } = request.body || {}
  if (firebaseEnabled) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return sendError(response, 400, 'A valid device location is required.')
    try { return response.status(201).json(await cloud.checkInCloud({ token, roll: submittedRoll, latitude, longitude })) }
    catch (error) {
      const status = error.message.includes('expired') ? 410 : error.message.includes('outside') || error.message.includes('from class') ? 403 : error.message.includes('not found') ? 404 : error.message.includes('already') ? 409 : 400
      return sendError(response, status, error.message)
    }
  }
  const pass = database.prepare('SELECT * FROM session_tokens WHERE token = ? AND expires_at > ?').get(token, Date.now())
  const session = pass && database.prepare('SELECT * FROM attendance_sessions WHERE id = ? AND active = 1').get(pass.session_id)
  if (!session) return sendError(response, 410, 'This pass has expired. Scan the latest classroom QR code.')
  const geofence = getGeofence()
  if (!geofence.center) return sendError(response, 409, 'The faculty member has not set the classroom location yet.')
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return sendError(response, 400, 'A valid device location is required.')
  const student = database.prepare('SELECT * FROM students WHERE roll = ? COLLATE NOCASE').get(String(submittedRoll || '').trim())
  if (!student) return sendError(response, 404, 'Roll number was not found. Check it with your faculty member.')
  const distance = distanceInMeters(geofence.center, { latitude, longitude })
  if (distance > geofence.radius) return response.status(403).json({ error: `You are about ${Math.round(distance)} m from class. The check-in limit is ${geofence.radius} m.` })
  const date = localDate()
  if (database.prepare('SELECT 1 FROM attendance_records WHERE student_id = ? AND attendance_date = ?').get(student.id, date)) return sendError(response, 409, 'Attendance has already been recorded for you today.')
  const tx = database.transaction(() => {
    database.prepare(`INSERT INTO checkins (id, student_id, roll, session_id, attendance_date, created_at, latitude, longitude, distance_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), student.id, student.roll, session.id, date, new Date().toISOString(), latitude, longitude, Math.round(distance))
    recordAttendance(student.id, 'present', null, 'qr', date)
  })
  tx()
  response.status(201).json({ checkin: { name: student.name, roll: student.roll, date }, student: { ...student, today: 'present' }, distance: Math.round(distance) })
})
app.get('/api/reports/attendance', async (_request, response) => {
  if (firebaseEnabled) return response.json(await cloud.attendanceReportCloud())
  response.json(database.prepare(`SELECT attendance_date AS date, status, source, COUNT(*) AS count FROM attendance_records
    GROUP BY attendance_date, status, source ORDER BY attendance_date DESC LIMIT 180`).all())
})
app.get('/api/audit', async (_request, response) => {
  if (firebaseEnabled) return response.json({ entries: await cloud.auditEntriesCloud() })
  response.json({ entries: database.prepare(`SELECT a.id, u.name AS actor, a.action, a.entity_type AS entityType,
  a.entity_id AS entityId, a.details, a.created_at AS createdAt FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 200`).all() })
})
app.get('/api/users', requireAdmin, async (_request, response) => {
  if (firebaseEnabled) {
    const snapshot = await getFirebaseFirestore().collection('staff').get()
    return response.json({ users: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) })
  }
  return response.json({ users: database.prepare('SELECT id, name, email, role, active, created_at AS createdAt FROM users ORDER BY name').all() })
})
app.post('/api/users', requireAdmin, (request, response) => {
  const { name, email, password } = request.body || {}
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || (!firebaseEnabled && (typeof password !== 'string' || password.length < 12))) return sendError(response, 400, firebaseEnabled ? 'Enter a name and valid email.' : 'Enter a name, valid email, and password with at least 12 characters.')
  if (firebaseEnabled) {
    const emailKey = email.trim().toLowerCase()
    return getFirebaseFirestore().collection('staff').doc(emailKey).set({ name: name.trim(), email: emailKey, role: 'faculty', active: true, createdAt: new Date().toISOString() }, { merge: true })
      .then(async () => {
        await cloud.auditCloud(request.user, 'faculty.created', 'user', emailKey)
        response.status(201).json({ user: { name: name.trim(), email: emailKey, role: 'faculty', active: true } })
      }).catch((error) => { console.error(error); sendError(response, 500, 'Could not create the Firebase staff profile.') })
  }
  const credential = hashPassword(password)
  try {
    const result = database.prepare(`INSERT INTO users (name, email, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'faculty', ?)`).run(name.trim(), email.trim().toLowerCase(), credential.salt, credential.hash, new Date().toISOString())
    writeAudit(request.user.id, 'faculty.created', 'user', result.lastInsertRowid)
    response.status(201).json({ user: database.prepare('SELECT id, name, email, role, active, created_at AS createdAt FROM users WHERE id = ?').get(result.lastInsertRowid) })
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(response, 409, 'An account with that email already exists.'); throw error }
})

const builtIndex = new URL('../dist/index.html', import.meta.url)
const fs = await import('node:fs')
if (fs.existsSync(builtIndex)) {
  app.use(express.static(new URL('../dist/', import.meta.url).pathname))
  app.get(/^\/(?:student-check-in)?\/?$/, (_request, response) => response.sendFile(builtIndex.pathname))
}
app.use((error, _request, response, _next) => {
  console.error('Request failed:', error)
  if (!response.headersSent) response.status(500).json({ error: 'The server could not complete this request.' })
})
export default app

if (!process.env.VERCEL) app.listen(port, '0.0.0.0', () => console.log(`Attendance server ready on port ${port}`))
