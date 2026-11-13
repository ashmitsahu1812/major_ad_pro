import { FieldPath } from 'firebase-admin/firestore'
import { getFirebaseFirestore, firebaseEnabled } from '../server/firebase-admin.js'
import { importFirestoreSnapshot, initializePostgres, pool } from '../server/postgres-store.js'

if (!firebaseEnabled) throw new Error('Set FIREBASE_ENABLED=true and FIREBASE_PROJECT_ID before migrating.')
await initializePostgres()

const firestore = getFirebaseFirestore()
const collections = ['students', 'attendance', 'settings', 'attendanceSessions', 'qrTokens', 'checkins', 'staff', 'auditLog']
const snapshot = {}

for (const name of collections) {
  const docs = []
  let lastDocument = null
  while (true) {
    let query = firestore.collection(name).orderBy(FieldPath.documentId()).limit(500)
    if (lastDocument) query = query.startAfter(lastDocument)
    const page = await query.get()
    docs.push(...page.docs.map((document) => ({ id: document.id, data: document.data() })))
    if (page.size < 500) break
    lastDocument = page.docs.at(-1)
  }
  snapshot[name] = docs
  console.log(`Read ${docs.length} ${name} documents from Firestore.`)
}

const result = await importFirestoreSnapshot(snapshot)
if (result.skipped) console.log('Firestore migration was already completed; PostgreSQL data was left unchanged.')
else console.log(`Migration completed. Imported: ${JSON.stringify(result.rowCounts)}`)

await pool.end()
