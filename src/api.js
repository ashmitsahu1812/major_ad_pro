import { firebaseAuth } from './firebase.js'

export async function apiRequest(path, options = {}) {
  const token = await firebaseAuth?.currentUser?.getIdToken()
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`)
  return body
}
