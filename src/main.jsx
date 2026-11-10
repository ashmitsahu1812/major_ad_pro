import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import StudentCheckIn from './StudentCheckIn.jsx'
import './style.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.pathname === '/student-check-in' ? <StudentCheckIn /> : <App />}
  </React.StrictMode>,
)
