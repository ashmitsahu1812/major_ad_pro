import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export const firebaseEnabled = process.env.FIREBASE_ENABLED === 'true' && Boolean(process.env.FIREBASE_PROJECT_ID)
let adminAuth = null
let firestore = null

if (firebaseEnabled) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    : applicationDefault()
  const app = getApps()[0] || initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID, credential: serviceAccount })
  adminAuth = getAuth(app)
  firestore = getFirestore(app)
}

export async function verifyFirebaseUser(idToken) {
  if (!firebaseEnabled || !adminAuth) return null
  const decoded = await adminAuth.verifyIdToken(idToken, true)
  const email = String(decoded.email || '').trim().toLowerCase()
  if (!email || decoded.email_verified !== true) return null

  const admins = (process.env.FIREBASE_ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (admins.includes(email)) return { uid: decoded.uid, email, name: decoded.name || email, role: 'admin' }

  const approved = await firestore.collection('staff').doc(email).get()
  if (approved.exists && approved.get('active') === true && ['faculty', 'admin'].includes(approved.get('role'))) {
    return { uid: decoded.uid, email, name: decoded.name || approved.get('name') || email, role: approved.get('role') }
  }
  return null
}

export function getFirebaseFirestore() { return firestore }
