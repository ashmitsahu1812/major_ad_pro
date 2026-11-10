import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { apiRequest } from './api.js'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpenCheck,
  CalendarDays, Check, CheckCheck, CircleAlert, Clock3, Download,
  GraduationCap, LayoutDashboard, LocateFixed, MapPin, MoreHorizontal, Plus, QrCode, Search, Upload,
  ShieldCheck, Users, UserRoundCheck, X,
} from 'lucide-react'

const departments = ['CSE', 'ECE', 'Mechanical', 'Civil', 'IT']
const names = [
  'Aarav Sharma', 'Ananya Reddy', 'Rohan Verma', 'Priya Nair', 'Karthik Iyer',
  'Sneha Patel', 'Vikram Singh', 'Meera Joshi', 'Arjun Rao', 'Divya Menon',
  'Rahul Gupta', 'Isha Kapoor', 'Sai Teja', 'Neha Desai', 'Aditya Kumar',
  'Pooja Hegde', 'Manoj Pillai', 'Kavya Shetty', 'Harsh Vardhan',
  'Lakshmi Prasad', 'Nikhil Bose', 'Swathi Reddy', 'Tarun Mehta', 'Zoya Khan',
]
const percentages = [96, 91, 68, 88, 72, 94, 59, 83, 90, 77, 62, 97, 81, 70, 86, 93, 55, 89, 74, 85, 66, 92, 79, 64]
const todaysAttendance = ['present', 'present', 'absent', 'present', 'late', 'present', 'absent', 'present', 'present', 'late', 'absent', 'present', 'present', 'absent', 'present', 'present', 'absent', 'present', 'unmarked', 'present', 'absent', 'present', 'unmarked', 'absent']
const sampleStudents = names.map((name, id) => ({
  id,
  name,
  roll: `22${['CS', 'EC', 'ME', 'CE', 'IT'][id % 5]}${101 + id}`,
  department: departments[id % departments.length],
  percentage: percentages[id],
  today: todaysAttendance[id],
  notified: false,
}))

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'attendance', label: 'Take attendance', icon: UserRoundCheck },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'reports', label: 'Reports', icon: BookOpenCheck },
]

const weeklyAttendance = [
  { day: 'Mon', value: 89 }, { day: 'Tue', value: 92 },
  { day: 'Wed', value: 87 }, { day: 'Thu', value: 84 },
  { day: 'Fri', value: 78 }, { day: 'Sat', value: 71 },
]

function readStudents() {
  try {
    const saved = JSON.parse(localStorage.getItem('campus-attendance-students'))
    if (Array.isArray(saved) && saved.length) return saved
  } catch { /* Start with the sample roster if browser storage is unavailable. */ }
  return sampleStudents
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"' && cell.length === 0) quoted = true
    else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function readStudentCsv(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one student row.')
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const findHeader = (...namesToTry) => headers.findIndex((header) => namesToTry.includes(header))
  const columns = {
    name: findHeader('name', 'studentname'),
    roll: findHeader('roll', 'rollnumber', 'rollno'),
    department: findHeader('department', 'dept'),
    percentage: findHeader('attendancepercent', 'overallattendance', 'percentage', 'attendance'),
    today: findHeader('today', 'todaystatus', 'attendancestatus'),
    notified: findHeader('notified', 'followupnotified'),
  }
  if (columns.name < 0 || columns.roll < 0 || columns.department < 0) {
    throw new Error('CSV headers must include name, roll, and department.')
  }

  let invalidRows = 0
  const students = []
  for (const values of rows.slice(1)) {
    const valueAt = (column) => column < 0 ? '' : (values[column] || '').trim()
    const name = valueAt(columns.name)
    const roll = valueAt(columns.roll).toUpperCase()
    const department = valueAt(columns.department)
    if (!name || !roll || !department) {
      invalidRows += 1
      continue
    }
    const student = { name, roll, department }
    if (columns.percentage >= 0) {
      const rawPercentage = valueAt(columns.percentage)
      const percentage = rawPercentage ? Number(rawPercentage.replace(/%$/, '')) : 100
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        invalidRows += 1
        continue
      }
      student.percentage = percentage
    }
    if (columns.today >= 0) {
      const today = valueAt(columns.today).toLowerCase() || 'unmarked'
      if (!['present', 'absent', 'late', 'unmarked'].includes(today)) {
        invalidRows += 1
        continue
      }
      student.today = today
    }
    if (columns.notified >= 0) {
      const rawNotified = valueAt(columns.notified).toLowerCase()
      student.notified = ['true', 'yes', '1'].includes(rawNotified)
    }
    students.push(student)
  }
  return { students, invalidRows }
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function attendanceStatus(percentage) {
  if (percentage < 75) return 'At Risk'
  if (percentage < 85) return 'Warning'
  return 'Good'
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function Avatar({ name, size = 'normal' }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-indigo-50 font-semibold text-indigo-700 ${size === 'small' ? 'size-8 text-[10px]' : 'size-10 text-xs'}`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

function StatusBadge({ value }) {
  const style = value === 'Good'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
    : value === 'Warning'
      ? 'bg-amber-50 text-amber-700 ring-amber-600/15'
      : 'bg-rose-50 text-rose-700 ring-rose-600/15'
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style}`}><span className="size-1.5 rounded-full bg-current" />{value}</span>
}

function MetricCard({ label, value, note, icon: Icon, tone, trend }) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon size={19} strokeWidth={1.9} /></span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">{value}</span>
        {trend && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ArrowUpRight size={14} />{trend}</span>}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{note}</p>
    </article>
  )
}

function SectionHeading({ title, detail, action }) {
  return <div className="mb-5 flex items-end justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">{title}</h2>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>{action}</div>
}

function WeeklyChart() {
  return (
    <div className="flex h-52 items-end gap-3 sm:gap-5">
      {weeklyAttendance.map(({ day, value }, index) => (
        <div key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="text-[11px] font-medium tabular-nums text-slate-500">{value}%</span>
          <div className="flex h-[72%] w-full max-w-12 items-end overflow-hidden rounded-t-lg bg-slate-100">
            <div className={`w-full rounded-t-lg transition-all duration-700 ${index === weeklyAttendance.length - 1 ? 'bg-indigo-600' : 'bg-indigo-200'}`} style={{ height: `${value}%` }} />
          </div>
          <span className="text-[11px] text-slate-400">{day}</span>
        </div>
      ))}
    </div>
  )
}

function DepartmentBreakdown({ students }) {
  const stats = [...new Set(students.map((student) => student.department))].sort().map((department) => {
    const members = students.filter((student) => student.department === department)
    const average = members.length ? Math.round(members.reduce((sum, student) => sum + student.percentage, 0) / members.length) : 0
    return { department, average, count: members.length }
  })
  return (
    <div className="space-y-4">
      {stats.map(({ department, average, count }) => (
        <div key={department}>
          <div className="mb-2 flex justify-between text-xs"><span className="font-medium text-slate-700">{department}<span className="ml-2 font-normal text-slate-400">{count} students</span></span><span className="font-semibold tabular-nums text-slate-600">{average}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${average}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function StudentRow({ student, onMark, compact = false }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:px-5">
      <Avatar name={student.name} size="small" />
      <div className="min-w-36 flex-1">
        <p className="text-sm font-medium text-slate-800">{student.name}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{student.roll} <span className="px-1">·</span> {student.department}</p>
      </div>
      {onMark ? (
        <div className="ml-auto flex gap-1.5">
          {['present', 'absent', 'late'].map((value) => {
            const selected = student.today === value
            const palette = value === 'present' ? 'bg-emerald-600 text-white' : value === 'absent' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
            return <button key={value} type="button" onClick={() => onMark(student.id, value)} aria-pressed={selected} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold capitalize transition ${selected ? palette : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{value}</button>
          })}
        </div>
      ) : (
        <div className="ml-auto flex items-center gap-3">
          {!compact && <span className="text-sm font-semibold tabular-nums text-slate-700">{student.percentage}%</span>}
          <StatusBadge value={attendanceStatus(student.percentage)} />
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon: Icon = Search, title, detail }) {
  return <div className="grid justify-items-center px-6 py-14 text-center"><span className="mb-3 grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-400"><Icon size={20} /></span><p className="text-sm font-medium text-slate-700">{title}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>
}

function App() {
  const [students, setStudents] = useState(readStudents)
  const [backendReady, setBackendReady] = useState(false)
  const [session, setSession] = useState(null)
  const [studentFormOpen, setStudentFormOpen] = useState(false)
  const [studentDraft, setStudentDraft] = useState({ name: '', roll: '', department: departments[0] })
  const [studentFormError, setStudentFormError] = useState('')
  const [geofence, setGeofence] = useState({ center: null, radius: 50 })
  const [activeTab, setActiveTab] = useState('overview')
  const [attendanceMode, setAttendanceMode] = useState('qr')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [departmentFilter, setDepartmentFilter] = useState('All departments')
  const [seconds, setSeconds] = useState(30)
  const [recentCheckins, setRecentCheckins] = useState([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    let active = true
    let attempts = 0
    let retryTimer
    async function loadBootstrap() {
      try {
        const data = await apiRequest('/api/bootstrap')
        if (!active) return
        setStudents(data.students)
        setGeofence(data.geofence)
        setSession(data.session)
        setRecentCheckins(data.checkins || [])
        setSeconds(data.session?.refreshInSeconds || 30)
        setBackendReady(true)
      } catch {
        attempts += 1
        if (active && attempts < 10) retryTimer = window.setTimeout(loadBootstrap, 1000)
        else if (active) setToast('Could not connect to attendance server. Start the app with npm run dev.')
      }
    }
    loadBootstrap()
    return () => { active = false; window.clearTimeout(retryTimer) }
  }, [])

  useEffect(() => {
    if (!backendReady) return undefined
    const sync = async () => {
      try {
        const data = await apiRequest('/api/bootstrap')
        setStudents(data.students)
        setGeofence(data.geofence)
        setSession(data.session)
        setRecentCheckins(data.checkins || [])
      } catch { /* Keep the current screen visible during a brief network interruption. */ }
    }
    const timer = window.setInterval(sync, 4000)
    return () => window.clearInterval(timer)
  }, [backendReady])

  useEffect(() => {
    if (activeTab !== 'attendance' || attendanceMode !== 'qr' || !session?.active) return undefined
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          apiRequest('/api/session/current').then((data) => {
            setSession(data.session)
            setSeconds(data.session?.refreshInSeconds || 30)
          }).catch(() => {})
          return 30
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeTab, attendanceMode, session?.active])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const presentCount = students.filter((student) => student.today === 'present' || student.today === 'late').length
  const absentCount = students.filter((student) => student.today === 'absent').length
  const atRiskStudents = students.filter((student) => student.percentage < 75)
  const average = Math.round(students.reduce((sum, student) => sum + student.percentage, 0) / (students.length || 1))
  const chronicStudents = students.filter((student) => student.percentage < 65).sort((a, b) => a.percentage - b.percentage)
  const watchStudents = students.filter((student) => student.percentage >= 65 && student.percentage < 75)
  const pageInfo = navItems.find((item) => item.id === activeTab)
  const departmentOptions = [...new Set([...departments, ...students.map((student) => student.department)])].sort()
  const appOrigin = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/+$/, '')
  const qrValue = session?.active
    ? `${appOrigin}/student-check-in?session=${encodeURIComponent(session.token)}`
    : ''

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    return students.filter((student) => {
      const matchesSearch = `${student.name} ${student.roll}`.toLowerCase().includes(query)
      const matchesStatus = statusFilter === 'All statuses' || attendanceStatus(student.percentage) === statusFilter
      const matchesDepartment = departmentFilter === 'All departments' || student.department === departmentFilter
      return matchesSearch && matchesStatus && matchesDepartment
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [students, search, statusFilter, departmentFilter])

  function markStudent(id, value) {
    setStudents((current) => current.map((student) => student.id === id ? { ...student, today: value } : student))
    apiRequest(`/api/students/${id}`, { method: 'PATCH', body: JSON.stringify({ today: value }) })
      .catch((error) => setToast(error.message))
  }

  async function addStudent(event) {
    event.preventDefault()
    const name = studentDraft.name.trim()
    const roll = studentDraft.roll.trim().toUpperCase()
    if (!name || !roll) {
      setStudentFormError('Enter the student’s name and roll number.')
      return
    }
    if (students.some((student) => student.roll.toLowerCase() === roll.toLowerCase())) {
      setStudentFormError('That roll number is already in the roster.')
      return
    }
    try {
      const data = await apiRequest('/api/students', {
        method: 'POST',
        body: JSON.stringify({ name, roll, department: studentDraft.department }),
      })
      setStudents(data.students)
    } catch (error) {
      setStudentFormError(error.message)
      return
    }
    setSearch('')
    setStatusFilter('All statuses')
    setDepartmentFilter('All departments')
    setStudentFormOpen(false)
    setStudentDraft({ name: '', roll: '', department: departments[0] })
    setStudentFormError('')
    setToast(`${name} added to the roster.`)
  }

  function exportStudentsCsv() {
    const headers = ['name', 'roll', 'department', 'attendance_percent', 'today', 'notified']
    const rows = students.map((student) => [
      student.name, student.roll, student.department, student.percentage,
      student.today, student.notified,
    ])
    const contents = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `students-attendance-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast('Student roster exported as CSV.')
  }

  async function importStudentsCsv(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = readStudentCsv(await file.text())
      if (!imported.students.length) {
        setToast('No valid student rows found in that CSV.')
        return
      }
      const uniqueStudents = [...new Map(imported.students.map((student) => [student.roll.toLowerCase(), student])).values()]
      const data = await apiRequest('/api/students/import', {
        method: 'POST',
        body: JSON.stringify({ students: uniqueStudents }),
      })
      setStudents(data.students)
      setSearch('')
      setStatusFilter('All statuses')
      setDepartmentFilter('All departments')
      const skipped = imported.invalidRows ? `, ${imported.invalidRows} invalid row${imported.invalidRows === 1 ? '' : 's'} skipped` : ''
      setToast(`CSV imported: ${data.added} added, ${data.updated} updated${skipped}.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not read that CSV file.')
    }
  }

  function markAll(value) {
    setStudents((current) => current.map((student) => ({ ...student, today: value })))
    apiRequest('/api/attendance/mark-all', { method: 'POST', body: JSON.stringify({ today: value }) })
      .then((data) => setStudents(data.students))
      .catch((error) => setToast(error.message))
    setToast(value === 'present' ? 'Everyone marked present.' : 'Today’s marks reset.')
  }

  function showLocationError(error) {
    if (error?.code === 1) setToast('Location permission was denied. Allow location access in your browser to check in.')
    else if (error?.code === 3) setToast('Location check timed out. Try again where GPS or Wi-Fi location is available.')
    else setToast('Could not get your location. Check device location services and try again.')
  }

  function setClassLocation() {
    if (!navigator.geolocation) {
      setToast('This browser does not support location access.')
      return
    }
    setToast('Getting the class location…')
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const center = { latitude: coords.latitude, longitude: coords.longitude }
      apiRequest('/api/geofence', {
        method: 'PUT',
        body: JSON.stringify({ center, radius: geofence.radius }),
      }).then((data) => {
        setGeofence(data.geofence)
        setToast('Class location saved for all devices.')
      }).catch((error) => setToast(error.message))
    }, showLocationError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  function saveRadius(radius) {
    apiRequest('/api/geofence', {
      method: 'PUT',
      body: JSON.stringify({ center: geofence.center, radius }),
    }).then((data) => setGeofence(data.geofence))
      .catch((error) => setToast(error.message))
  }

  async function startSession() {
    if (!geofence.center) {
      setToast('Set the class location before starting attendance.')
      return
    }
    try {
      const data = await apiRequest('/api/session/start', { method: 'POST' })
      setSession(data.session)
      setSeconds(data.session.refreshInSeconds)
      setToast('Attendance session started. Students can scan the QR code.')
    } catch (error) { setToast(error.message) }
  }

  async function endSession() {
    try {
      await apiRequest('/api/session/end', { method: 'POST' })
      setSession(null)
      setToast('Attendance session ended.')
    } catch (error) { setToast(error.message) }
  }

  function markNotified(id) {
    setStudents((current) => current.map((student) => student.id === id ? { ...student, notified: true } : student))
    apiRequest(`/api/students/${id}`, { method: 'PATCH', body: JSON.stringify({ notified: true }) })
      .catch((error) => setToast(error.message))
    setToast('Follow-up marked for this browser.')
  }

  function markAllNotified() {
    const targets = chronicStudents.filter((student) => !student.notified)
    setStudents((current) => current.map((student) => student.percentage < 65 ? { ...student, notified: true } : student))
    Promise.all(targets.map((student) => apiRequest(`/api/students/${student.id}`, {
      method: 'PATCH', body: JSON.stringify({ notified: true }),
    }))).then(() => setToast('Follow-ups marked for the chronic absence list.'))
      .catch((error) => setToast(error.message))
  }

  function changeTab(tab) {
    setActiveTab(tab)
    setSearch('')
    setStatusFilter('All statuses')
    setDepartmentFilter('All departments')
  }

  const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-800 bg-slate-950 text-slate-300 lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/40"><GraduationCap size={22} /></span>
          <div><p className="text-sm font-semibold tracking-wide text-white">Campus</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[.16em] text-slate-500">Smart attendance</p></div>
        </div>
        <div className="px-4 pt-7"><p className="px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Workspace</p>
          <nav className="mt-3 space-y-1" aria-label="Main navigation">
            {navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => changeTab(id)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${activeTab === id ? 'bg-indigo-500/15 font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-400/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'reports' && atRiskStudents.length > 0 && <span className="ml-auto rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">{atRiskStudents.length}</span>}</button>)}
          </nav>
        </div>
        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-200"><ShieldCheck size={16} className="text-indigo-300" /> Attendance overview</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Your class average is <span className="font-semibold text-slate-300">{average}%</span>. Keep an eye on students below 75%.</p><button type="button" onClick={() => changeTab('reports')} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200">View reports <ArrowRight size={13} /></button></div>
          <div className="mt-5 flex items-center gap-3 px-1"><div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-bold text-white">FA</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-white">Faculty Admin</p><p className="mt-0.5 text-[10px] text-slate-500">CSE · Academic year 2025–26</p></div><MoreHorizontal size={18} className="text-slate-500" /></div>
        </div>
      </aside>

      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white"><GraduationCap size={18} /></span><span className="text-sm font-semibold text-slate-900">Campus</span></div><span className="text-xs text-slate-500">Faculty Admin</span></div>
        <nav className="scrollbar-subtle flex gap-1 overflow-x-auto pb-2" aria-label="Main navigation">{navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => changeTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${activeTab === id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500'}`}><Icon size={15} />{label}</button>)}</nav>
      </div>

      <main className="lg:pl-64">
        <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 sm:px-7 lg:px-10 lg:pt-9">
          <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <div><div className="mb-1 flex items-center gap-2 text-xs text-slate-400"><span>Workspace</span><span>/</span><span className="text-slate-600">{pageInfo.label}</span></div><h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[27px]">{activeTab === 'overview' ? 'Good morning, Faculty' : pageInfo.label}</h1><p className="mt-1 text-sm text-slate-500">{activeTab === 'overview' ? 'Here’s your attendance snapshot for today.' : activeTab === 'attendance' ? 'Record and review today’s class attendance.' : activeTab === 'students' ? 'Search attendance records and student insights.' : 'Identify students who may need additional support.'}</p></div>
            <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 sm:flex"><CalendarDays size={15} className="text-slate-400" />{todayLabel}</div><button type="button" className="relative grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50" aria-label="Notifications"><Bell size={17} /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-indigo-500 ring-2 ring-white" /></button><div className="hidden size-10 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 sm:flex">FA</div></div>
          </header>

          {activeTab === 'overview' && <section className="animate-rise space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Total students" value={students.length} note="Enrolled in this class" icon={Users} tone="bg-indigo-50 text-indigo-600" trend="2.4%" />
              <MetricCard label="Present today" value={presentCount} note={`${Math.round(presentCount / (students.length || 1) * 100)}% of the class checked in`} icon={UserRoundCheck} tone="bg-emerald-50 text-emerald-600" trend="4.8%" />
              <MetricCard label="Absent today" value={absentCount} note={`${students.filter((student) => student.today === 'unmarked').length} students not marked yet`} icon={CircleAlert} tone="bg-amber-50 text-amber-600" />
              <MetricCard label="At-risk students" value={atRiskStudents.length} note="Below 75% attendance" icon={ArrowDownRight} tone="bg-rose-50 text-rose-600" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 sm:p-6"><SectionHeading title="Weekly attendance trend" detail="Class attendance rate across the last six days" action={<button type="button" onClick={() => changeTab('students')} className="hidden items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 sm:inline-flex">View analytics <ArrowRight size={14} /></button>} /><div className="mb-4 flex items-baseline gap-2"><span className="text-3xl font-semibold tracking-tight text-slate-900">{average}%</span><span className="text-xs font-medium text-emerald-700">class average</span></div><WeeklyChart /><div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-400"><span className="size-2 rounded-full bg-indigo-500" />Today’s attendance <span className="ml-auto">Updated just now</span></div></article>
              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 sm:p-6"><SectionHeading title="Department average" detail="Attendance rate by department" /><DepartmentBreakdown students={students} /></article>
            </div>

            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30"><div className="px-5 pt-5 sm:px-6"><SectionHeading title="Needs attention" detail="Students currently below 75% attendance" action={<button type="button" onClick={() => changeTab('reports')} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800">See all <ArrowRight size={14} /></button>} /></div>{atRiskStudents.slice(0, 4).map((student) => <StudentRow key={student.id} student={student} compact />)}</article>
          </section>}

          {activeTab === 'attendance' && <section className="animate-rise space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"><button type="button" onClick={() => setAttendanceMode('qr')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-4 ${attendanceMode === 'qr' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><QrCode size={15} />QR / Digital pass</button><button type="button" onClick={() => setAttendanceMode('manual')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-4 ${attendanceMode === 'manual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><CheckCheck size={15} />Manual roll call</button></div><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="size-2 rounded-full bg-emerald-500" />{presentCount} present of {students.length}</span></div>

            {attendanceMode === 'qr' ? <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 sm:p-7">
                <div className="flex items-start justify-between"><div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${session?.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><span className={`size-1.5 rounded-full ${session?.active ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} />{session?.active ? 'Session active' : 'Session not started'}</span><h2 className="mt-3 text-lg font-semibold text-slate-900">Student check-in QR</h2><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Students scan this with their phone camera, enter their roll number, and verify their location.</p></div><span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500"><QrCode size={19} /></span></div>
                {session?.active ? <div className="mt-6 flex flex-col items-center rounded-2xl bg-slate-50 px-4 py-6"><div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200"><QRCodeSVG value={qrValue} size={192} level="M" includeMargin /></div><p className="mt-4 text-xs font-semibold text-slate-800">Scan with your phone camera</p><p className="mt-1 max-w-sm break-all text-center text-[10px] text-slate-400">{qrValue}</p><div className="mt-4 w-full max-w-60"><div className="mb-2 flex justify-between text-[10px] text-slate-400"><span>Pass refreshes in</span><span className="font-medium tabular-nums text-slate-600">00:{String(seconds).padStart(2, '0')}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-500 transition-all duration-1000" style={{ width: `${seconds / 30 * 100}%` }} /></div></div><div className="mt-5 flex flex-wrap justify-center gap-2"><a href={qrValue} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100">Preview student page</a><button type="button" onClick={endSession} className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">End session</button></div></div> : <div className="mt-6 grid justify-items-center rounded-2xl bg-slate-50 px-5 py-9 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-white text-indigo-600 shadow-sm"><QrCode size={22} /></span><p className="mt-3 text-sm font-semibold text-slate-800">Ready for class</p><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Set the classroom location, then start the session to create a scannable student pass.</p><button type="button" onClick={startSession} disabled={!geofence.center || !backendReady} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><QrCode size={15} />Start attendance session</button></div>}
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><MapPin size={17} /></span><div><p className="text-xs font-semibold text-slate-800">Class location and radius</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{geofence.center ? `Saved for all devices · ${geofence.center.latitude.toFixed(5)}, ${geofence.center.longitude.toFixed(5)}` : 'Set the class location from the classroom.'}</p></div></div><button type="button" onClick={setClassLocation} disabled={!backendReady} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"><LocateFixed size={13} />{geofence.center ? 'Update location' : 'Set class location'}</button></div><div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-[10px] text-slate-500">Allowed radius</span><select value={geofence.radius} onChange={(event) => saveRadius(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 outline-none focus:border-indigo-400"><option value={25}>25 meters</option><option value={50}>50 meters</option><option value={75}>75 meters</option><option value={100}>100 meters</option></select></div><p className="mt-2 text-[10px] text-slate-400">Students’ phones must be within this distance when they submit check-in.</p></div>
              </article>
              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 sm:p-6"><SectionHeading title="Recent check-ins" detail="Live student submissions for this class" action={<span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{recentCheckins.length} recent</span>} />{recentCheckins.length ? <div>{recentCheckins.map((student, index) => <div key={`${student.roll}-${student.time}-${index}`} className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0"><Avatar name={student.name} size="small" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{student.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{student.roll}</p></div><span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400"><Check size={13} className="text-emerald-600" />{new Date(student.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>)}</div> : <EmptyState icon={QrCode} title="No check-ins yet" detail="Student submissions will appear here." />}<div className="mt-5 rounded-xl bg-indigo-50 p-3.5 text-[11px] leading-5 text-indigo-800"><span className="font-semibold">Student flow:</span> scan the live QR with a phone camera, enter the roster roll number, and allow location access. The server rejects expired passes, duplicate check-ins, unknown students, and devices outside the radius.</div></article>
            </div> : <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:px-5"><div><h2 className="text-sm font-semibold text-slate-900">Class roll call</h2><p className="mt-1 text-[11px] text-slate-500">Tap a status to record today’s attendance.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => markAll('present')} className="rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-indigo-700">Mark all present</button><button type="button" onClick={() => markAll('unmarked')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50">Reset marks</button></div></div><div className="divide-y divide-slate-100">{students.map((student) => <StudentRow key={student.id} student={student} onMark={markStudent} />)}</div></article>}
          </section>}

          {activeTab === 'students' && <section className="animate-rise space-y-5">
            <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Class average</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{average}%</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Good standing</p><p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700">{students.filter((student) => student.percentage >= 85).length}</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Need attention</p><p className="mt-1 text-2xl font-semibold tracking-tight text-rose-700">{atRiskStudents.length}</p></div></div>
            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30"><div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Student analytics</h2><p className="mt-1 text-[11px] text-slate-500">Showing {filteredStudents.length} of {students.length} students</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setSearch(''); setStatusFilter('All statuses'); setDepartmentFilter('All departments') }} className="px-1 text-[11px] font-semibold text-slate-500 hover:text-indigo-700">Clear filters</button><input id="student-csv-input" type="file" accept=".csv,text/csv" className="hidden" onChange={importStudentsCsv} /><button type="button" onClick={() => document.getElementById('student-csv-input')?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"><Upload size={14} />Import CSV</button><button type="button" onClick={exportStudentsCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"><Download size={14} />Export CSV</button><button type="button" onClick={() => { setStudentFormError(''); setStudentFormOpen(true) }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-indigo-700"><Plus size={14} />Add student</button></div></div><div className="grid gap-2 sm:grid-cols-[1fr_180px_165px]"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or roll number" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"><option>All departments</option>{departmentOptions.map((department) => <option key={department}>{department}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"><option>All statuses</option><option>Good</option><option>Warning</option><option>At Risk</option></select></div></div><div className="overflow-x-auto"><table className="w-full min-w-[690px] border-collapse text-left"><thead><tr className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><th className="px-5 py-3">Student</th><th className="px-4 py-3">Roll number</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Attendance</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredStudents.map((student) => <tr key={student.id} className="transition hover:bg-slate-50/70"><td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={student.name} size="small" /><span className="text-xs font-medium text-slate-800">{student.name}</span></div></td><td className="px-4 py-3 text-xs text-slate-500">{student.roll}</td><td className="px-4 py-3 text-xs text-slate-500">{student.department}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${student.percentage < 75 ? 'bg-rose-500' : student.percentage < 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${student.percentage}%` }} /></div><span className="text-xs font-semibold tabular-nums text-slate-700">{student.percentage}%</span></div></td><td className="px-4 py-3"><StatusBadge value={attendanceStatus(student.percentage)} /></td></tr>)}</tbody></table>{filteredStudents.length === 0 && <EmptyState title="No students found" detail="Try another name, roll number, or filter." />}</div></article>
          </section>}

          {activeTab === 'reports' && <section className="animate-rise space-y-5">
            <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Chronically absent</p><p className="mt-1 text-2xl font-semibold text-rose-700">{chronicStudents.length}</p><p className="mt-1 text-[10px] text-slate-400">Below 65% attendance</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Watch list</p><p className="mt-1 text-2xl font-semibold text-amber-700">{watchStudents.length}</p><p className="mt-1 text-[10px] text-slate-400">Between 65% and 74%</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">At-risk total</p><p className="mt-1 text-2xl font-semibold text-slate-900">{atRiskStudents.length}</p><p className="mt-1 text-[10px] text-slate-400">Below 75% attendance</p></div></div>
            <article className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700"><CircleAlert size={19} /></span><div><h2 className="text-base font-semibold text-slate-900">Early intervention recommended</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">These students have attendance below 65%. Consider a faculty check-in to understand what support they need.</p></div></div><button type="button" onClick={markAllNotified} disabled={!chronicStudents.some((student) => !student.notified)} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">Mark all for follow-up</button></div></article>
            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30"><div className="flex items-center justify-between px-5 py-5"><div><h2 className="text-sm font-semibold text-slate-900">Chronic absence list</h2><p className="mt-1 text-[11px] text-slate-500">Sorted by lowest attendance first</p></div><span className="rounded-lg bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700">{chronicStudents.length} students</span></div><div>{chronicStudents.map((student) => <div key={student.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3.5"><Avatar name={student.name} size="small" /><div className="min-w-36 flex-1"><p className="text-xs font-semibold text-slate-800">{student.name}</p><p className="mt-1 text-[10px] text-slate-400">{student.roll} <span className="px-1">·</span>{student.department}</p></div><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rose-500" style={{ width: `${student.percentage}%` }} /></div><span className="w-8 text-right text-xs font-bold text-rose-700">{student.percentage}%</span></div><button type="button" onClick={() => markNotified(student.id)} disabled={student.notified} className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold transition ${student.notified ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'}`}>{student.notified ? <><Check size={13} />Follow-up noted</> : 'Mark for follow-up'}</button></div>)}{chronicStudents.length === 0 && <EmptyState icon={ShieldCheck} title="No students below 65%" detail="There are no chronic absence cases right now." />}</div></article>
            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30"><div className="px-5 pt-5"><SectionHeading title="Watch list" detail="Students approaching the attendance threshold" /></div>{watchStudents.length ? watchStudents.map((student) => <StudentRow key={student.id} student={student} compact />) : <p className="px-5 pb-5 text-xs text-slate-400">No students currently on the watch list.</p>}</article>
            <p className="flex items-center gap-2 text-[10px] text-slate-400"><Clock3 size={13} />Follow-up markers are saved in this browser. This demo does not send messages.</p>
          </section>}
        </div>
      </main>

      {studentFormOpen && <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setStudentFormOpen(false) }}><section role="dialog" aria-modal="true" aria-labelledby="add-student-title" className="animate-rise w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6"><div className="mb-5 flex items-start justify-between"><div><h2 id="add-student-title" className="text-lg font-semibold text-slate-900">Add a student</h2><p className="mt-1 text-xs text-slate-500">Add a student to this class roster.</p></div><button type="button" onClick={() => setStudentFormOpen(false)} aria-label="Close form" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={17} /></button></div><form onSubmit={addStudent} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">Student name</span><input autoFocus required value={studentDraft.name} onChange={(event) => setStudentDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Samira Patel" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">Roll number</span><input required value={studentDraft.roll} onChange={(event) => setStudentDraft((current) => ({ ...current, roll: event.target.value }))} placeholder="e.g. 22CS125" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm uppercase outline-none placeholder:normal-case placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">Department</span><select value={studentDraft.department} onChange={(event) => setStudentDraft((current) => ({ ...current, department: event.target.value }))} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">{departmentOptions.map((department) => <option key={department}>{department}</option>)}</select></label><p className="text-[11px] text-slate-400">New students start at 100% overall attendance and are unmarked for today.</p>{studentFormError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{studentFormError}</p>}<div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setStudentFormOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700">Add student</button></div></form></section></div>}

      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-xl"><Check size={15} className="text-emerald-400" />{toast}<button type="button" onClick={() => setToast('')} className="ml-2 text-slate-400 hover:text-white" aria-label="Dismiss"><X size={14} /></button></div>}
    </div>
  )
}

export default App
