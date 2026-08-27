// ─── Shared Attendance Utilities ────────────────────────────────────────────
// Used by: Employee/Dashboard.jsx, HR/Attendance.jsx, HR/Dashboard.jsx

export const DEFAULT_CFG = {
  checkin_open: '09:00',
  checkin_close: '10:45',
  late_after: '09:45',
  checkout_open: '18:30',
  checkout_close: '19:00',
  lunch_start: '13:30',
  lunch_end: '14:30',
  lunch_duration_min: 60,
  evening_start: '16:30',
  evening_end: '17:00',
  evening_duration_min: 30,
  absence_mark_after: '13:00',
}

/** Returns current time as a Date object in IST */
export function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

/** Converts "HH:MM" or "HH:MM:SS" to total seconds */
export function timeToSecs(hhmmss) {
  if (!hhmmss) return 0
  const parts = hhmmss.split(':').map(Number)
  const h = parts[0] || 0
  const m = parts[1] || 0
  const s = parts[2] || 0
  return h * 3600 + m * 60 + s
}

/** Converts seconds to "HH:MM:SS" */
export function secsToHHMM(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Converts seconds to "04h 25m 12s" */
export function secsToWorked(s) {
  const safe = Math.max(0, Number(s) || 0)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const sec = safe % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

export function displayWorkedHours(record) {
  const raw = record?.net_working_hours || record?.working_hours
  if (!raw) return '-'
  const [h = '00', m = '00', s = '00'] = String(raw).split(':')
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

/** Formats "HH:MM" or "HH:MM:SS" to "H:MM AM/PM" */
export function fmtTime(hhmm) {
  if (!hhmm) return '-'
  const [h, m] = hhmm.split(':').map(Number)
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
