import { firebaseAuth } from './firebase.js'

function waitFor(promise, milliseconds, fallback = null) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => { timer = window.setTimeout(() => resolve(fallback), milliseconds) }),
  ]).finally(() => window.clearTimeout(timer))
}

export async function apiRequest(path, options = {}) {
  const token = await waitFor(firebaseAuth?.currentUser?.getIdToken(), 5000).catch(() => null)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`)
    return body
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The attendance server took too long to respond. Please try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export { waitFor }
