import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, session } from 'electron'

let server
let mainWindow

function configureLocalMode() {
  process.env.NODE_ENV = 'production'
  process.env.VERCEL = '1'
  process.env.FIREBASE_ENABLED = 'false'
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.APP_TIME_ZONE ||= 'Asia/Kolkata'
  process.env.ADMIN_SETUP_TOKEN = crypto.randomBytes(24).toString('base64url')
  for (const key of ['DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) delete process.env[key]
}

function isAppUrl(value, origin) {
  try { return new URL(value).origin === origin } catch { return false }
}

async function showSetupToken() {
  const { database } = await import(pathToFileURL(path.join(app.getAppPath(), 'server/database.js')).href)
  const users = database.prepare('SELECT COUNT(*) AS count FROM users').get().count
  if (users) return
  const token = process.env.ADMIN_SETUP_TOKEN
  clipboard.writeText(token)
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Finish administrator setup',
    message: 'Create the first administrator account',
    detail: `Enter this one-time setup token on the sign-in screen:\n\n${token}\n\nThe token has been copied to your clipboard.`,
    buttons: ['Continue'],
    defaultId: 0,
  })
  if (choice.response === 0) mainWindow.focus()
}

async function createWindow() {
  configureLocalMode()
  const root = app.getAppPath()
  const { default: expressApp } = await import(pathToFileURL(path.join(root, 'server/index.js')).href)
  server = http.createServer(expressApp)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const appUrl = `http://127.0.0.1:${address.port}`

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation' && isAppUrl(webContents.getURL(), appUrl))
  })

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    title: 'Smart College Attendance',
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { mainWindow = null })
  await mainWindow.loadURL(appUrl)
  await showSetupToken()
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Could not start Smart College Attendance:', error)
  dialog.showErrorBox('Could not start the desktop app', error.message)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => server?.close())
