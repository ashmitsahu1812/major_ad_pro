import express from 'express'
import attendanceApp from './server/index.js'

const app = express()
app.use(attendanceApp)

export default app
