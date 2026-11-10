import { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, GraduationCap, LoaderCircle, MapPin, QrCode, ShieldCheck, XCircle } from 'lucide-react'
import { apiRequest } from './api.js'

export default function StudentCheckIn() {
  const token = new URLSearchParams(window.location.search).get('session') || ''
  const [roll, setRoll] = useState('')
  const [radius, setRadius] = useState(null)
  const [locationReady, setLocationReady] = useState(false)
  const [validating, setValidating] = useState(true)
  const [validPass, setValidPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    if (!token) {
      setValidating(false)
      return undefined
    }
    apiRequest(`/api/session/verify/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!active) return
        setValidPass(true)
        setRadius(data.radius)
        setLocationReady(Boolean(data.locationSet))
        if (!data.locationSet) setResult({ type: 'error', message: 'The class location is not set yet. Faculty must configure it before check-in can open.' })
      })
      .catch((error) => { if (active) setResult({ type: 'error', message: error.message }) })
      .finally(() => { if (active) setValidating(false) })
    return () => { active = false }
  }, [token])

  function submitCheckIn(event) {
    event.preventDefault()
    if (!token || !validPass || !roll.trim()) return
    if (!navigator.geolocation) {
      setResult({ type: 'error', message: 'Location services are not available in this browser.' })
      return
    }
    setBusy(true)
    setResult({ type: 'loading', message: 'Checking your location and attendance pass…' })
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const data = await apiRequest('/api/checkins', {
          method: 'POST',
          body: JSON.stringify({
            token,
            roll: roll.trim(),
            latitude: coords.latitude,
            longitude: coords.longitude,
          }),
        })
        setResult({ type: 'success', message: `You’re checked in, ${data.student.name}.`, detail: `Location verified within ${radius} meters.` })
      } catch (error) {
        setResult({ type: 'error', message: error.message })
      } finally {
        setBusy(false)
      }
    }, (error) => {
      const message = error.code === 1
        ? 'Location permission was denied. Allow location access in your browser, then try again.'
        : error.code === 3
          ? 'Location timed out. Move to an area with a clearer GPS or Wi-Fi signal and try again.'
          : 'Could not get your location. Turn on device location services and try again.'
      setResult({ type: 'error', message })
      setBusy(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  const isSuccess = result?.type === 'success'
  const hasError = result?.type === 'error'

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-300/40">
        <div className="bg-slate-950 px-6 py-6 text-white">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-500"><GraduationCap size={23} /></span><div><p className="text-sm font-semibold">Campus</p><p className="mt-0.5 text-[10px] uppercase tracking-[.17em] text-slate-400">Student check-in</p></div></div>
          <h1 className="mt-7 text-2xl font-semibold tracking-tight">Class attendance</h1>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">Confirm your identity and location to check in for this session.</p>
        </div>

        <div className="p-6">
          {validating ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" />Validating attendance pass…</div> : !token ? <Notice type="error" message="No attendance pass was found. Scan the QR code displayed by your faculty member." /> : isSuccess ? <div className="py-3 text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={30} /></span><h2 className="mt-4 text-lg font-semibold text-slate-900">Check-in complete</h2><p className="mt-2 text-sm text-slate-600">{result.message}</p><p className="mt-1 text-xs text-slate-400">{result.detail}</p><div className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-800">You can close this page. Your attendance is recorded.</div></div> : <>
            <div className="mb-5 flex items-start gap-3 rounded-xl bg-indigo-50 p-3.5"><span className="mt-0.5 text-indigo-600"><ShieldCheck size={17} /></span><div><p className="text-xs font-semibold text-indigo-900">Active attendance pass</p><p className="mt-1 text-[11px] leading-4 text-indigo-700">Your device must be within {radius ?? 'the configured'} meters of the classroom.</p></div></div>
            <form onSubmit={submitCheckIn} className="space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-700">Your roll number</span><input autoFocus inputMode="text" autoCapitalize="characters" required value={roll} onChange={(event) => setRoll(event.target.value)} placeholder="Enter your college roll number" className="h-12 w-full rounded-xl border border-slate-200 px-3.5 text-sm uppercase outline-none transition placeholder:normal-case placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
              {hasError && <Notice type="error" message={result.message} />}
              {result?.type === 'loading' && <p className="flex items-center gap-2 text-xs text-indigo-700"><LoaderCircle size={14} className="animate-spin" />{result.message}</p>}
              <button type="submit" disabled={busy || !validPass || !locationReady || !roll.trim()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><MapPin size={17} />Verify location & check in</button>
            </form>
            <div className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-[10px] leading-4 text-slate-400"><Clock3 size={13} className="mt-0.5 shrink-0" />This pass expires shortly. If it expires before you check in, scan your faculty member’s current QR code.</div>
          </>}
        </div>
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-3 text-[10px] text-slate-400"><QrCode size={12} />Smart College Attendance</div>
      </section>
    </main>
  )
}

function Notice({ type, message }) {
  const Icon = type === 'error' ? XCircle : CheckCircle2
  return <div role="status" className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-800"><Icon size={16} className="mt-0.5 shrink-0" />{message}</div>
}
