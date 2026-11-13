import { getApp, getApps, initializeApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}

export const firebaseConfigured = Object.values(config).every(Boolean)
export const firebaseAuth = firebaseConfigured ? getAuth(getApps().length ? getApp() : initializeApp(config)) : null
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error('Firebase web config is missing. Fill in the VITE_FIREBASE values in .env.')
  return signInWithPopup(firebaseAuth, googleProvider)
}

export async function signOutFromGoogle() {
  if (firebaseAuth) await signOut(firebaseAuth)
}
