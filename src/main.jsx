import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import StudentCheckIn from './StudentCheckIn.jsx'
import './style.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.error('Could not register the app service worker:', error)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.pathname === '/student-check-in' ? <StudentCheckIn /> : <App />}
  </React.StrictMode>,
)
