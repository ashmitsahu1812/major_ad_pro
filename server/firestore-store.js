import crypto from 'node:crypto'
import { database, getGeofence, listStudents } from './database.js'
import { getFirebaseFirestore } from './firebase-admin.js'

const db = getFirebaseFirestore()
const attended = (status) => status === 'present' || status === 'late'
const dateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
const studentRef = (id) => db.collection('students').doc(String(id))
const attendanceRef = (date, id) => db.collection('attendance').doc(`${date}_${id}`)

export async function migrateLocalData() {
  const marker = db.collection('metadata').doc('sqlite-import-v1')
  if ((await marker.get()).exists) return
  const snapshot = await db.collection('students').limit(1).get()
  if (!snapshot.empty) { await marker.set({ imported: false, completedAt: new Date().toISOString() }); return }
  const students = listStudents()
  const batchMax = 400
  for (let offset = 0; offset < students.length; offset += batchMax) {
    const batch = db.batch()
    students.slice(offset, offset + batchMax).forEach((student) => batch.set(studentRef(student.id), {
      ...student, rollKey: student.roll.toUpperCase(), attendedCount: 0, sessionCount: 0,
    }))
    await batch.commit()
  }
  const records = database.prepare('SELECT * FROM attendance_records ORDER BY attendance_date').all()
  for (let offset = 0; offset < records.length; offset += batchMax) {
    const batch = db.batch()
    records.slice(offset, offset + batchMax).forEach((record) => batch.set(attendanceRef(record.attendance_date, record.student_id), {
      studentId: String(record.student_id), date: record.attendance_date, status: record.status, source: record.source,
      recordedAt: record.recorded_at,
    }))
    await batch.commit()
  }
  await db.collection('settings').doc('geofence').set(getGeofence())
  await marker.set({ imported: true, studentCount: students.length, recordCount: records.length, completedAt: new Date().toISOString() })
}

export async function getGeofenceCloud() {
  const snapshot = await db.collection('settings').doc('geofence').get()
  return snapshot.exists ? snapshot.data() : { center: null, radius: 50 }
}

export async function listStudentsCloud() {
  const today = dateKey()
  const [students, attendance] = await Promise.all([
    db.collection('students').get(), db.collection('attendance').where('date', '==', today).get(),
  ])
  const todayMap = new Map(attendance.docs.map((doc) => [doc.get('studentId'), doc.get('status')]))
  return students.docs.map((doc) => {
    const item = doc.data()
    return { ...item, id: item.id ?? doc.id, today: todayMap.get(String(item.id ?? doc.id)) || item.today || 'unmarked', notified: Boolean(item.notified) }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export async function activeSessionCloud(rotate = false) {
  const currentRef = db.collection('settings').doc('currentSession')
  const current = await currentRef.get()
  if (!current.exists || !current.get('sessionId')) return null
  const sessionId = current.get('sessionId')
  const sessionRef = db.collection('attendanceSessions').doc(sessionId)
  const session = await sessionRef.get()
  if (!session.exists || !session.get('active')) return null
  const geo = await getGeofenceCloud()
  if (!geo.center) return null
  const now = Date.now()
  let token = session.data()
  if (!token.token || token.expiresAt <= now) token = null
  if (rotate || !token || now - token.createdAt >= 30_000) {
    const value = crypto.randomBytes(24).toString('base64url')
    token = { token: value, sessionId, createdAt: now, expiresAt: now + 90_000 }
    await db.collection('qrTokens').doc(value).set(token)
    await sessionRef.set(token, { merge: true })
  }
  return { active: true, sessionId, token: token.token, createdAt: token.createdAt, expiresAt: token.expiresAt, refreshInSeconds: Math.max(1, Math.ceil((30_000 - (now - token.createdAt)) / 1000)) }
}

export async function startSessionCloud(actorId) {
  const geo = await getGeofenceCloud()
  if (!geo.center) throw new Error('Set the classroom location before starting attendance.')
  const currentRef = db.collection('settings').doc('currentSession')
  const previous = await currentRef.get()
  if (previous.exists && previous.get('sessionId')) await db.collection('attendanceSessions').doc(previous.get('sessionId')).set({ active: false, endedAt: Date.now() }, { merge: true })
  const id = crypto.randomUUID()
  await db.collection('attendanceSessions').doc(id).set({ active: true, startedAt: Date.now(), createdBy: String(actorId) })
  await currentRef.set({ sessionId: id })
  return activeSessionCloud(true)
}

export async function endSessionCloud() {
  const current = await db.collection('settings').doc('currentSession').get()
  if (current.exists && current.get('sessionId')) await db.collection('attendanceSessions').doc(current.get('sessionId')).set({ active: false, endedAt: Date.now() }, { merge: true })
  await db.collection('settings').doc('currentSession').delete()
}

export async function saveGeofenceCloud(geofence) {
  await db.collection('settings').doc('geofence').set(geofence)
  return geofence
}

export async function createStudentCloud(input) {
  const roll = input.roll.trim().toUpperCase()
  const existing = await db.collection('students').where('rollKey', '==', roll).limit(1).get()
  if (!existing.empty) throw new Error('That roll number is already in the roster.')
  const id = crypto.randomUUID()
  const student = { id, name: input.name.trim(), roll, rollKey: roll, department: input.department.trim(), percentage: 100, today: 'unmarked', notified: false, attendedCount: 0, sessionCount: 0 }
  await studentRef(id).set(student)
  return student
}

async function changeAttendance(studentId, status, source, date = dateKey()) {
  const ref = studentRef(studentId)
  const recordRef = attendanceRef(date, studentId)
  await db.runTransaction(async (transaction) => {
    const [studentSnapshot, recordSnapshot] = await Promise.all([transaction.get(ref), transaction.get(recordRef)])
    if (!studentSnapshot.exists) throw new Error('Student not found.')
    const student = studentSnapshot.data()
    const oldStatus = recordSnapshot.exists ? recordSnapshot.get('status') : null
    if (source === 'qr' && oldStatus) throw new Error('Attendance has already been recorded for you today.')
    let total = Number(student.sessionCount || 0)
    let present = Number(student.attendedCount || 0)
    if (!oldStatus) total += 1
    else if (attended(oldStatus) !== attended(status)) present += attended(status) ? 1 : -1
    if (!oldStatus && attended(status)) present += 1
    const now = new Date().toISOString()
    transaction.set(recordRef, { studentId: String(studentId), date, status, source, recordedAt: now })
    transaction.set(ref, { today: status, sessionCount: total, attendedCount: present, percentage: total ? Math.round(100 * present / total) : 100 }, { merge: true })
  })
}

export async function patchStudentCloud(id, changes) {
  const ref = studentRef(id)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new Error('Student not found.')
  if (changes.today !== undefined) {
    if (changes.today === 'unmarked') {
      const refRecord = attendanceRef(dateKey(), id)
      const record = await refRecord.get()
      if (record.exists) {
        const old = record.data()
        const student = snapshot.data()
        const total = Math.max(0, Number(student.sessionCount || 0) - 1)
        const present = Math.max(0, Number(student.attendedCount || 0) - (attended(old.status) ? 1 : 0))
        await refRecord.delete()
        await ref.set({ today: 'unmarked', sessionCount: total, attendedCount: present, percentage: total ? Math.round(present * 100 / total) : 100 }, { merge: true })
      }
    } else await changeAttendance(id, changes.today, 'manual')
  }
  if (changes.notified !== undefined) await ref.set({ notified: Boolean(changes.notified) }, { merge: true })
  const result = await ref.get()
  return { ...result.data(), id: result.id }
}

export async function importStudentsCloud(items) {
  let added = 0
  let updated = 0
  for (const item of items) {
    if (!item?.name?.trim() || !item?.roll?.trim() || !item?.department?.trim()) continue
    const roll = item.roll.trim().toUpperCase()
    const snapshot = await db.collection('students').where('rollKey', '==', roll).limit(1).get()
    if (snapshot.empty) {
      const id = crypto.randomUUID()
      await studentRef(id).set({ id, name: item.name.trim(), roll, rollKey: roll, department: item.department.trim(), percentage: 100, today: 'unmarked', notified: false, attendedCount: 0, sessionCount: 0 })
      added += 1
    } else {
      await snapshot.docs[0].ref.set({ name: item.name.trim(), department: item.department.trim() }, { merge: true })
      updated += 1
    }
  }
  return { added, updated }
}

export async function markAllCloud(status) {
  const students = await db.collection('students').get()
  for (const student of students.docs) {
    if (status === 'unmarked') await patchStudentCloud(student.id, { today: 'unmarked' })
    else await changeAttendance(student.id, 'present', 'manual')
  }
}

export async function checkInCloud({ token, roll, latitude, longitude }) {
  const pass = await db.collection('qrTokens').doc(String(token)).get()
  if (!pass.exists || pass.get('expiresAt') <= Date.now()) throw new Error('This pass has expired. Scan the latest classroom QR code.')
  const session = await db.collection('attendanceSessions').doc(pass.get('sessionId')).get()
  if (!session.exists || !session.get('active')) throw new Error('This pass has expired. Scan the latest classroom QR code.')
  const geo = await getGeofenceCloud()
  if (!geo.center) throw new Error('The faculty member has not set the classroom location yet.')
  const match = await db.collection('students').where('rollKey', '==', String(roll || '').trim().toUpperCase()).limit(1).get()
  const studentSnapshot = match.docs[0]
  if (!studentSnapshot?.exists) throw new Error('Student profile was not found. Ask your faculty member to check the roster.')
  const student = { ...studentSnapshot.data(), id: studentSnapshot.id }
  const radians = (degrees) => degrees * Math.PI / 180
  const dLat = radians(latitude - geo.center.latitude)
  const dLon = radians(longitude - geo.center.longitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(geo.center.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLon / 2) ** 2
  const distance = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  if (distance > geo.radius) throw new Error(`You are about ${Math.round(distance)} m from class. The check-in limit is ${geo.radius} m.`)
  const date = dateKey()
  const record = await attendanceRef(date, student.id).get()
  if (record.exists) throw new Error('Attendance has already been recorded for you today.')
  const checkin = { id: crypto.randomUUID(), studentId: student.id, name: student.name, roll: student.roll, date, time: new Date().toISOString(), distance: Math.round(distance) }
  await changeAttendance(student.id, 'present', 'qr', date)
  await db.collection('checkins').doc(`${date}_${student.id}`).set(checkin)
  return { checkin, student: { ...student, today: 'present' }, distance: Math.round(distance) }
}

export async function recentCheckinsCloud(date = dateKey()) {
  const rows = await db.collection('checkins').where('date', '==', date).get()
  return rows.docs.map((doc) => doc.data()).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 8)
}

export async function weeklyAttendanceCloud() {
  const students = await db.collection('students').get()
  const rosterSize = students.size
  const result = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    const key = dateKey(date)
    const records = await db.collection('attendance').where('date', '==', key).get()
    const present = records.docs.filter((doc) => attended(doc.get('status'))).length
    result.push({ day: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata' }).format(date), value: rosterSize ? Math.round(100 * present / rosterSize) : 0 })
  }
  return result
}

export async function auditCloud(actor, action, entityType, entityId = null, details = {}) {
  await db.collection('auditLog').add({ actor: actor?.email || null, action, entityType, entityId: entityId == null ? null : String(entityId), details, createdAt: new Date().toISOString() })
}

export async function auditEntriesCloud() {
  const rows = await db.collection('auditLog').orderBy('createdAt', 'desc').limit(200).get()
  return rows.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export async function attendanceReportCloud() {
  const rows = await db.collection('attendance').orderBy('date', 'desc').limit(5000).get()
  const grouped = new Map()
  for (const doc of rows.docs) {
    const record = doc.data()
    const key = `${record.date}|${record.status}|${record.source}`
    grouped.set(key, { date: record.date, status: record.status, source: record.source, count: (grouped.get(key)?.count || 0) + 1 })
  }
  return [...grouped.values()].slice(0, 180)
}
