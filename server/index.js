import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const dataDirectory = path.join(projectRoot, 'data')
const databaseFile = path.join(dataDirectory, 'attendance.json')
const port = Number(process.env.PORT || 4173)
const app = express()

app.use(express.json({ limit: '2mb' }))

const seedNames = [
  'Aarav Sharma', 'Ananya Reddy', 'Rohan Verma', 'Priya Nair', 'Karthik Iyer',
  'Sneha Patel', 'Vikram Singh', 'Meera Joshi', 'Arjun Rao', 'Divya Menon',
  'Rahul Gupta', 'Isha Kapoor', 'Sai Teja', 'Neha Desai', 'Aditya Kumar',
  'Pooja Hegde', 'Manoj Pillai', 'Kavya Shetty', 'Harsh Vardhan',
  'Lakshmi Prasad', 'Nikhil Bose', 'Swathi Reddy', 'Tarun Mehta', 'Zoya Khan',
]
const seedAttendance = [
  'present', 'present', 'absent', 'present', 'late', 'present', 'absent', 'present',
  'present', 'late', 'absent', 'present', 'present', 'absent', 'present', 'present',
  'absent', 'present', 'unmarked', 'present', 'absent', 'present', 'unmarked', 'absent',
]
const seedPercentages = [96, 91, 68, 88, 72, 94, 59, 83, 90, 77, 62, 97, 81, 70, 86, 93, 55, 89, 74, 85, 66, 92, 79, 64]
const seedDepartments = ['CSE', 'ECE', 'Mechanical', 'Civil', 'IT']

function initialDatabase() {
  return {
    students: seedNames.map((name, id) => ({
      id,
      name,
      roll: `22${['CS', 'EC', 'ME', 'CE', 'IT'][id % 5]}${101 + id}`,
      department: seedDepartments[id % seedDepartments.length],
      percentage: seedPercentages[id],
      today: seedAttendance[id],
      notified: false,
    })),
    geofence: { center: null, radius: 50 },
    session: null,
    checkins: [],
  }
}

function readDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true })
  if (!fs.existsSync(databaseFile)) writeDatabase(initialDatabase())
  return JSON.parse(fs.readFileSync(databaseFile, 'utf8'))
}

function writeDatabase(database) {
  fs.mkdirSync(dataDirectory, { recursive: true })
  const temporaryFile = `${databaseFile}.tmp`
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2))
  fs.renameSync(temporaryFile, databaseFile)
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function createSessionToken(session, now = Date.now()) {
  const token = { value: newToken(), createdAt: now, expiresAt: now + 90_000 }
  session.tokens = [...session.tokens.filter((item) => item.expiresAt > now), token]
  session.updatedAt = now
  return token
}

function currentSession(database, rotate = false) {
  const session = database.session
  if (!session?.active) return null
  if (!database.geofence.center) {
    session.active = false
    return null
  }
  const now = Date.now()
  const latest = session.tokens.at(-1)
  if (rotate || !latest || now - latest.createdAt >= 30_000) createSessionToken(session, now)
  const token = session.tokens.at(-1)
  return {
    active: true,
    sessionId: session.id,
    token: token.value,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    refreshInSeconds: Math.max(1, Math.ceil((30_000 - (now - token.createdAt)) / 1000)),
  }
}

function localDate(date = new Date()) {
  const pieces = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type) => pieces.find((piece) => piece.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function distanceInMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180
  const earthRadius = 6_371_000
  const latitudeDifference = radians(second.latitude - first.latitude)
  const longitudeDifference = radians(second.longitude - first.longitude)
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDifference / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function validStudent(student) {
  return typeof student?.name === 'string' && student.name.trim()
    && typeof student?.roll === 'string' && student.roll.trim()
    && typeof student?.department === 'string' && student.department.trim()
}

function sendError(response, status, error) {
  return response.status(status).json({ error })
}

app.get('/api/bootstrap', (_request, response) => {
  const database = readDatabase()
  const session = currentSession(database)
  writeDatabase(database)
  response.json({
    students: database.students,
    geofence: database.geofence,
    session,
    checkins: database.checkins.filter((entry) => entry.date === localDate()).slice(-8).reverse(),
  })
})

app.get('/api/session/current', (_request, response) => {
  const database = readDatabase()
  const session = currentSession(database)
  writeDatabase(database)
  response.json({ session })
})

app.post('/api/session/start', (_request, response) => {
  const database = readDatabase()
  if (!database.geofence.center) return sendError(response, 409, 'Set the classroom location before starting attendance.')
  database.session = { id: crypto.randomUUID(), active: true, tokens: [], startedAt: Date.now() }
  const session = currentSession(database, true)
  writeDatabase(database)
  response.json({ session })
})

app.post('/api/session/end', (_request, response) => {
  const database = readDatabase()
  if (database.session) database.session.active = false
  writeDatabase(database)
  response.json({ session: null })
})

app.get('/api/session/verify/:token', (request, response) => {
  const database = readDatabase()
  const session = database.session
  const valid = Boolean(session?.active && session.tokens.some((token) => token.value === request.params.token && token.expiresAt > Date.now()))
  if (!valid) return sendError(response, 404, 'This attendance pass has expired. Scan the current classroom QR code.')
  response.json({ valid: true, radius: database.geofence.radius, locationSet: Boolean(database.geofence.center) })
})

app.put('/api/geofence', (request, response) => {
  const { center, radius } = request.body || {}
  const validCenter = center === null || (center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude)
    && Math.abs(center.latitude) <= 90 && Math.abs(center.longitude) <= 180)
  if (!validCenter) return sendError(response, 400, 'Enter a valid class location.')
  if (![25, 50, 75, 100].includes(Number(radius))) return sendError(response, 400, 'Choose a radius from 25 to 100 meters.')
  const database = readDatabase()
  database.geofence = { center, radius: Number(radius) }
  writeDatabase(database)
  response.json({ geofence: database.geofence })
})

app.post('/api/students', (request, response) => {
  const input = request.body || {}
  if (!validStudent(input)) return sendError(response, 400, 'Name, roll number, and department are required.')
  const database = readDatabase()
  const roll = input.roll.trim().toUpperCase()
  if (database.students.some((student) => student.roll.toLowerCase() === roll.toLowerCase())) {
    return sendError(response, 409, 'That roll number is already in the roster.')
  }
  const id = Math.max(-1, ...database.students.map((student) => student.id)) + 1
  const student = {
    id,
    name: input.name.trim(),
    roll,
    department: input.department.trim(),
    percentage: 100,
    today: 'unmarked',
    notified: false,
  }
  database.students.push(student)
  writeDatabase(database)
  response.status(201).json({ student, students: database.students })
})

app.patch('/api/students/:id', (request, response) => {
  const database = readDatabase()
  const student = database.students.find((entry) => entry.id === Number(request.params.id))
  if (!student) return sendError(response, 404, 'Student not found.')
  const { today, notified } = request.body || {}
  if (today !== undefined) {
    if (!['present', 'absent', 'late', 'unmarked'].includes(today)) return sendError(response, 400, 'Invalid attendance status.')
    student.today = today
  }
  if (notified !== undefined) student.notified = Boolean(notified)
  writeDatabase(database)
  response.json({ student })
})

app.post('/api/students/import', (request, response) => {
  const imported = request.body?.students
  if (!Array.isArray(imported)) return sendError(response, 400, 'No student rows were provided.')
  const database = readDatabase()
  let nextId = Math.max(-1, ...database.students.map((student) => student.id)) + 1
  let added = 0
  let updated = 0
  for (const input of imported) {
    if (!validStudent(input)) continue
    const roll = input.roll.trim().toUpperCase()
    const existing = database.students.find((student) => student.roll.toLowerCase() === roll.toLowerCase())
    if (existing) {
      Object.assign(existing, input, { roll })
      updated += 1
    } else {
      database.students.push({ id: nextId++, percentage: 100, today: 'unmarked', notified: false, ...input, roll })
      added += 1
    }
  }
  writeDatabase(database)
  response.json({ students: database.students, added, updated })
})

app.post('/api/attendance/mark-all', (request, response) => {
  const { today } = request.body || {}
  if (!['present', 'unmarked'].includes(today)) return sendError(response, 400, 'Invalid attendance status.')
  const database = readDatabase()
  database.students.forEach((student) => { student.today = today })
  writeDatabase(database)
  response.json({ students: database.students })
})

app.post('/api/checkins', (request, response) => {
  const { token, roll: submittedRoll, latitude, longitude } = request.body || {}
  const database = readDatabase()
  const active = database.session?.active
  const tokenValid = active && database.session.tokens.some((entry) => entry.value === token && entry.expiresAt > Date.now())
  if (!tokenValid) return sendError(response, 410, 'This pass has expired. Scan the latest classroom QR code.')
  if (!database.geofence.center) return sendError(response, 409, 'The faculty member has not set the classroom location yet.')
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return sendError(response, 400, 'A valid device location is required.')
  }
  const student = database.students.find((entry) => entry.roll.toLowerCase() === String(submittedRoll || '').trim().toLowerCase())
  if (!student) return sendError(response, 404, 'Roll number was not found. Check it with your faculty member.')

  const distance = distanceInMeters(database.geofence.center, { latitude, longitude })
  if (distance > database.geofence.radius) {
    return response.status(403).json({ error: `You are about ${Math.round(distance)} m from class. The check-in limit is ${database.geofence.radius} m.` })
  }

  const date = localDate()
  const existing = database.checkins.find((entry) => entry.date === date && entry.roll.toLowerCase() === student.roll.toLowerCase())
  if (existing) return sendError(response, 409, 'You have already checked in for this class today.')

  const checkin = {
    id: crypto.randomUUID(),
    studentId: student.id,
    name: student.name,
    roll: student.roll,
    date,
    time: new Date().toISOString(),
  }
  student.today = 'present'
  database.checkins.push(checkin)
  writeDatabase(database)
  response.status(201).json({ checkin, student, distance: Math.round(distance) })
})

const builtIndex = path.join(projectRoot, 'dist', 'index.html')
if (fs.existsSync(builtIndex)) {
  app.use(express.static(path.join(projectRoot, 'dist')))
  app.get(/^\/(?:student-check-in)?$/, (_request, response) => response.sendFile(builtIndex))
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Attendance API ready on http://localhost:${port}`)
})
