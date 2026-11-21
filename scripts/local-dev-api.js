import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Local-only authentication shim for this checkout. Production and normal
// deployed API traffic continue to use the PHP/MongoDB backend.
const HOST = '127.0.0.1'
const PORT = Number(process.env.LOCAL_API_PORT || 8096)
const SESSION_COOKIE = 'hrms_local_session'
const sessions = new Map()
const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', '.local-demo-data.json')

const accounts = [
  { id: 'local-hr-1', name: 'Local HR Admin', email: 'admin@worexa.com', password: 'admin123', role: 'hr' },
  { id: 'local-employee-1', name: 'Local Employee', email: 'employee@worexa.com', password: 'emp123', role: 'employee' },
]

function loadEmployees() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Array.isArray(data.employees) ? data.employees : []
  } catch { return [] }
}

const employees = loadEmployees()
function loadAttendance() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return data.attendance && typeof data.attendance === 'object' ? data.attendance : {}
  } catch { return {} }
}
const attendance = loadAttendance()
const allAccounts = () => [...accounts, ...employees.map(employee => ({ ...employee, role: 'employee' }))]

function saveEmployees() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ employees, attendance }, null, 2) + '\n', { mode: 0o600 })
}

function localClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = type => parts.find(part => part.type === type)?.value || '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` }
}

function secondsSince(value) {
  if (!value) return 0
  const date = new Date(`${String(value).replace(' ', 'T')}+05:30`)
  return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
}

function currentWorkSeconds(record) {
  const work = Number(record?.accumulated_work_seconds || 0)
  const meeting = Number(record?.accumulated_meeting_seconds || 0)
  if (!record || record.is_paused || record.check_out) return work + meeting
  if (record.active_activity_type === 'meeting') return work + meeting + secondsSince(record.last_resumed_at)
  if (record.active_activity_type === 'working') return work + secondsSince(record.last_resumed_at)
  return work + meeting
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    ...extraHeaders,
  })
  res.end(JSON.stringify(body))
}

function publicUser(account) {
  const { id, name, email, role } = account
  return { id, name, email, role, company_name: 'Worexa Local', company_slug: 'worexa', sound_enabled: true }
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => { size += chunk.length; if (size > 5 * 1024 * 1024) reject(new Error('Request too large')); else chunks.push(chunk) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const contentType = String(req.headers['content-type'] || '')
      const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
      if (boundary) {
        const marker = `--${(boundary[1] || boundary[2]).trim()}`
        const body = {}
        for (const part of raw.toString('utf8').split(marker).slice(1)) {
          if (part.startsWith('--')) continue
          const splitAt = part.indexOf('\r\n\r\n')
          if (splitAt < 0) continue
          const header = part.slice(0, splitAt)
          const name = header.match(/name="([^"]+)"/i)?.[1]
          if (!name || /filename="[^"]*"/i.test(header)) continue
          body[name] = part.slice(splitAt + 4).replace(/\r\n$/, '')
        }
        return resolve(body)
      }
      try { resolve(raw.length ? JSON.parse(raw.toString('utf8')) : {}) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function cookieValue(header, name) {
  const item = String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.slice(name.length + 1)) : ''
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const path = new URL(req.url || '/', `http://${HOST}:${PORT}`).pathname

  if (path === '/login.php' && req.method === 'POST') {
    try {
      const body = await requestBody(req)
      const account = allAccounts().find(item => item.email === String(body.email || '').trim().toLowerCase() && item.password === body.password)
      if (!account) return send(res, 401, { success: false, message: 'Invalid local demo credentials.', data: null })
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, account.id)
      return send(res, 200, { success: true, message: 'Local demo login successful.', data: { user: publicUser(account) } }, {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      })
    } catch {
      return send(res, 400, { success: false, message: 'Invalid login request.', data: null })
    }
  }

  if (path === '/me.php' && req.method === 'GET') {
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE)
    const accountId = sessions.get(token)
    const account = allAccounts().find(item => item.id === accountId)
    return account
      ? send(res, 200, { success: true, data: publicUser(account) })
      : send(res, 401, { success: false, message: 'Authentication required.', data: null })
  }

  if (path === '/logout.php' && req.method === 'POST') {
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE)
    sessions.delete(token)
    return send(res, 200, { success: true, message: 'Logged out.', data: null }, {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    })
  }

  if (path === '/employees.php' && req.method === 'GET') {
    const sessionId = sessions.get(cookieValue(req.headers.cookie, SESSION_COOKIE))
    const account = allAccounts().find(item => item.id === sessionId)
    if (!account) return send(res, 401, { success: false, message: 'Authentication required.', data: null })
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
    const search = (url.searchParams.get('search') || '').toLowerCase()
    const status = url.searchParams.get('status') || ''
    const department = url.searchParams.get('department') || ''
    const filtered = employees.filter(employee =>
      (!search || [employee.name, employee.email, employee.employee_code, employee.designation].some(value => String(value || '').toLowerCase().includes(search))) &&
      (!status || employee.status === status) && (!department || employee.department === department))
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || url.searchParams.get('limit') || 25)))
    const pageItems = filtered.slice((page - 1) * limit, page * limit).map(({ password, ...employee }) => employee)
    return send(res, 200, { success: true, data: { employees: pageItems, pagination: { page, limit, per_page: limit, total: filtered.length, pages: Math.ceil(filtered.length / limit), hasMore: page * limit < filtered.length } } })
  }

  if (path === '/employees.php' && req.method === 'POST') {
    const sessionId = sessions.get(cookieValue(req.headers.cookie, SESSION_COOKIE))
    const account = allAccounts().find(item => item.id === sessionId)
    if (!account) return send(res, 401, { success: false, message: 'Authentication required.', data: null })
    if (account.role !== 'hr') return send(res, 403, { success: false, message: 'Only HR can create employees.', data: null })
    try {
      const body = await requestBody(req)
      for (const field of ['employee_code', 'name', 'email', 'joining_date', 'password']) {
        if (!String(body[field] || '').trim()) return send(res, 422, { success: false, message: `Required field missing: ${field}.`, data: null })
      }
      if (employees.some(employee => employee.employee_code.toLowerCase() === String(body.employee_code).trim().toLowerCase())) return send(res, 409, { success: false, message: 'Employee code already exists.', data: null })
      if (allAccounts().some(existing => existing.email.toLowerCase() === String(body.email).trim().toLowerCase())) return send(res, 409, { success: false, message: 'Email already exists.', data: null })
      const parseGroup = key => { try { const value = JSON.parse(body[key] || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } }
      const employee = {
        id: `local-emp-${crypto.randomUUID()}`, role: 'employee', employee_code: String(body.employee_code).trim(),
        name: String(body.name).trim(), email: String(body.email).trim().toLowerCase(), phone: String(body.phone || '').trim(),
        department: String(body.department || '').trim(), designation: String(body.designation || '').trim(), branch: String(body.branch || '').trim(),
        employment_type: body.employment_type || 'full_time', status: body.status || 'active', joining_date: body.joining_date,
        date_of_birth: body.date_of_birth || '', basic_salary: Number(body.basic_salary || 0), password: String(body.password),
        personal_profile: parseGroup('personal_profile'), emergency_contact: parseGroup('emergency_contact'),
        employment_details: parseGroup('employment_details'), compensation_details: parseGroup('compensation_details'),
        it_profile: parseGroup('it_profile'), company_name: 'Worexa Local', company_slug: 'worexa',
      }
      employees.push(employee)
      saveEmployees()
      const { password, ...safeEmployee } = employee
      return send(res, 201, { success: true, message: 'Employee created successfully.', data: safeEmployee })
    } catch {
      return send(res, 400, { success: false, message: 'Could not read employee details.', data: null })
    }
  }

  if (path === '/dashboard.php' && req.method === 'GET') {
    const accountId = sessions.get(cookieValue(req.headers.cookie, SESSION_COOKIE))
    const account = allAccounts().find(item => item.id === accountId)
    if (!account) return send(res, 401, { success: false, message: 'Authentication required.', data: null })
    const today = localClock().date
    const records = Object.values(attendance).filter(record => record.date === today)
    const present = records.filter(record => record.check_in && !record.check_out).map(record => {
      const employee = allAccounts().find(item => item.id === record.employee_id) || {}
      return { id: record.employee_id, employee_id: record.employee_id, name: employee.name || 'Employee', employee_code: employee.employee_code || '', department: employee.department || 'Engineering', designation: employee.designation || '', check_in: record.check_in, status: record.status || 'present', work_mode: record.work_mode || 'office', is_paused: !!record.is_paused, active_activity_type: record.active_activity_type, pause_reason: record.pause_reason || '' }
    })
    const employeesForCompany = allAccounts().filter(item => item.role === 'employee')
    const own = attendance[account.id]?.date === today ? attendance[account.id] : null
    return send(res, 200, { success: true, data: {
      today_attendance: own ? { ...own, live_productive_working_seconds: currentWorkSeconds(own) } : null,
      today: own || {}, recent_attendance: [], attendance_settings: { standard_shift_hours: 7.5, lunch_start: '13:00', lunch_duration_min: 45, evening_start: '17:00', evening_duration_min: 15 },
      total_employees: employeesForCompany.length, active_employees: employeesForCompany.length,
      total_employees_list: employeesForCompany.map(({ password, ...employee }) => employee),
      present_today: present.length, present_employees: present, wfh_employees: [], absent_today: [],
      on_leave_today: 0, on_leave_employees: [], pending_leaves: 0, pending_leave_requests: [],
      pending_wfh_requests: [], pending_break_requests: [], pending_late_approvals: [],
      department_summary: [{ name: 'Engineering', count: employeesForCompany.length, percentage: 100, color: '#2563eb' }],
      recent_hires: [], upcoming_birthdays: [], active_break_sessions: [],
    } })
  }

  if (path === '/attendance.php' && req.method === 'GET') {
    const accountId = sessions.get(cookieValue(req.headers.cookie, SESSION_COOKIE))
    const account = allAccounts().find(item => item.id === accountId)
    if (!account) return send(res, 401, { success: false, message: 'Authentication required.', data: null })
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
    if (url.searchParams.has('settings')) return send(res, 200, { success: true, data: { standard_shift_hours: 7.5, lunch_start: '13:00', lunch_duration_min: 45, evening_start: '17:00', evening_duration_min: 15, exempt_windows: [] } })
    const record = attendance[account.id]?.date === localClock().date ? attendance[account.id] : null
    return send(res, 200, { success: true, data: record })
  }

  if (path === '/attendance.php' && req.method === 'POST') {
    const accountId = sessions.get(cookieValue(req.headers.cookie, SESSION_COOKIE))
    const account = allAccounts().find(item => item.id === accountId)
    if (!account) return send(res, 401, { success: false, message: 'Authentication required.', data: null })
    if (account.role !== 'employee') return send(res, 403, { success: false, message: 'Employee access required.', data: null })
    const action = new URL(req.url || '/', `http://${HOST}:${PORT}`).searchParams.get('action') || ''
    const now = localClock()
    let record = attendance[account.id]
    if (action === 'checkin') {
      if (record?.date === now.date && record.check_in && !record.check_out) return send(res, 409, { success: false, message: 'You are already checked in.', data: null })
      record = { id: `local-att-${account.id}-${now.date}`, employee_id: account.id, date: now.date, check_in: now.time, check_out: null, status: 'present', work_mode: 'office', active_activity_type: 'working', last_resumed_at: `${now.date} ${now.time}`, is_paused: false, hr_timer_paused: false, accumulated_work_seconds: 0, accumulated_meeting_seconds: 0, accumulated_lunch_seconds: 0, accumulated_break_seconds: 0, total_break_seconds: 0, presence_pause_seconds: 0 }
      attendance[account.id] = record
      saveEmployees()
      return send(res, 201, { success: true, message: 'Attendance marked. Timer started.', data: record })
    }
    if (action === 'checkout') {
      if (!record || record.date !== now.date || !record.check_in) return send(res, 409, { success: false, message: 'Check in before checking out.', data: null })
      if (!record.is_paused) record.accumulated_work_seconds = Number(record.accumulated_work_seconds || 0) + secondsSince(record.last_resumed_at)
      record.check_out = now.time
      record.active_activity_type = 'CHECKED_OUT'
      record.is_checked_out = true
      record.working_hours = `${String(Math.floor(currentWorkSeconds(record) / 3600)).padStart(2, '0')}:${String(Math.floor((currentWorkSeconds(record) % 3600) / 60)).padStart(2, '0')}:00`
      saveEmployees()
      return send(res, 200, { success: true, message: 'Checked out successfully.', data: record })
    }
    if (action === 'employee_presence_pause') {
      if (!record || record.date !== now.date || !record.check_in || record.check_out) return send(res, 409, { success: false, message: 'No active work session.', data: null })
      if (record.is_paused) return send(res, 200, { success: true, message: 'Timer is already paused.', data: record })
      if (['break', 'lunch'].includes(record.active_activity_type)) return send(res, 200, { success: true, message: 'An existing break is already pausing the timer.', data: record })
      const elapsed = secondsSince(record.last_resumed_at)
      if (record.active_activity_type === 'meeting') record.accumulated_meeting_seconds = Number(record.accumulated_meeting_seconds || 0) + elapsed
      else record.accumulated_work_seconds = Number(record.accumulated_work_seconds || 0) + elapsed
      record.active_activity_type = 'pause'
      record.last_resumed_at = `${now.date} ${now.time}`
      record.is_paused = true
      record.hr_timer_paused = true
      record.paused_at = `${now.date} ${now.time}`
      record.paused_by = 'system'
      record.hr_pause_by = 'system'
      record.pause_reason = 'Presence Paused: HRMS tab closed or screen locked'
      record.hr_pause_reason = record.pause_reason
      attendance[account.id] = record
      saveEmployees()
      return send(res, 200, { success: true, message: 'Work timer paused.', data: record })
    }
    if (action === 'employee_presence_resume') {
      if (!record || record.date !== now.date || !record.is_paused || record.pause_reason !== 'Presence Paused: HRMS tab closed or screen locked') return send(res, 409, { success: false, message: 'Timer is not paused by the presence monitor.', data: null })
      const elapsed = secondsSince(record.paused_at)
      record.accumulated_break_seconds = Number(record.accumulated_break_seconds || 0) + elapsed
      record.total_break_seconds = Number(record.total_break_seconds || 0) + elapsed
      record.presence_pause_seconds = Number(record.presence_pause_seconds || 0) + elapsed
      record.active_activity_type = 'working'
      record.is_paused = false
      record.hr_timer_paused = false
      record.paused_at = null
      record.paused_by = null
      record.hr_pause_by = null
      record.pause_reason = null
      record.hr_pause_reason = null
      record.last_resumed_at = `${now.date} ${now.time}`
      attendance[account.id] = record
      saveEmployees()
      return send(res, 200, { success: true, message: 'Work timer resumed.', data: record })
    }
  }

  return send(res, 503, {
    success: false,
    message: 'This local demo supports sign-in, employee records, and attendance timers. Configure the PHP API and MongoDB for the remaining HRMS modules.',
    data: null,
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Local demo auth API listening on http://${HOST}:${PORT}`)
  console.log('HR: admin@worexa.com / admin123')
  console.log('Employee: employee@worexa.com / emp123')
})

server.on('error', error => {
  console.error(`Could not start local demo API: ${error.message}`)
  process.exitCode = 1
})
