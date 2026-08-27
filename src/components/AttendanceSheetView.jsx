import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Calendar, CheckCircle2, Clock, Download, Edit3, Save, X } from 'lucide-react'
import {
  useGetAttendanceSheetQuery,
  useGetEmployeesQuery,
  useUpdateTaskStatusMutation,
  useUpdateDailyTaskMutation,
} from '../store/apiSlice'
import { useToast } from '../App'
import api from '../services/api'

function istDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function istMonth() {
  return istDate().slice(0, 7)
}

function dash(value) {
  return value || '-'
}

function statusLabel(row) {
  if (row.worked_off_day) return 'Present (Worked Off Day)'
  if (row.row_type === 'week_off') return 'Week Off'
  if (row.row_type === 'holiday') return 'Holiday'
  if (row.row_type === 'absent') return 'Absent'
  if (row.row_type === 'pending') return 'Not checked in yet'
  const status = String(row.status || 'present').toLowerCase()
  if (status === 'late') return 'Present'
  return String(row.status || 'present').replace(/_/g, ' ')
}

function rowClass(row) {
  if (row.worked_off_day) return 'attendance-sheet-worked-off'
  if (row.row_type === 'absent') return 'attendance-sheet-absent'
  if (row.row_type === 'week_off') return 'attendance-sheet-week-off'
  if (row.row_type === 'holiday') return 'attendance-sheet-holiday'
  return ''
}

function apiDownloadUrl(params) {
  const base = String(api.defaults.baseURL || '/api').replace(/\/+$/, '')
  const root = /^https?:\/\//i.test(base) ? base : `${window.location.origin}${base.startsWith('/') ? '' : '/'}${base}`
  const url = new URL(`${root}/attendance-sheet.php`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  url.searchParams.set('download', '1')
  return url.toString()
}

function downloadUrl(url) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  link.target = '_blank'
  link.setAttribute('download', '')
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function TaskStatusCell({ row, editable, onUpdate }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState(row.task_status || 'pending')
  const [updating, setUpdating] = useState(false)
  const [updateTaskStatus] = useUpdateTaskStatusMutation()

  useEffect(() => {
    setStatus(row.task_status || 'pending')
    setEditing(false)
  }, [row.date, row.task_status])

  const canEdit = editable && row.date === istDate() && row.task && row.row_type === 'work'

  if (!row.task) return <span className="attendance-sheet-muted">-</span>

  const saveStatus = async () => {
    if (!canEdit) return
    setUpdating(true)
    try {
      await updateTaskStatus({ date: row.date, status }).unwrap()
      await onUpdate()
      setEditing(false)
      toast('Task status updated.', 'success')
    } catch (err) {
      toast(err.data?.message || 'Task status update failed.', 'error')
    } finally {
      setUpdating(false)
    }
  }

  if (editing) {
    return (
      <div className="attendance-sheet-status-editor">
        <select value={status} onChange={e => setStatus(e.target.value)} disabled={updating} aria-label="Task status">
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </select>
        <button type="button" onClick={saveStatus} disabled={updating} title="Save status" aria-label="Save status">
          <Save size={13} />
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={updating} title="Cancel" aria-label="Cancel editing">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="attendance-sheet-status-wrap">
      <span className={`attendance-sheet-task-status ${row.task_status === 'completed' ? 'completed' : 'pending'}`}>
        {row.task_status === 'completed' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
        {row.task_status || 'pending'}
      </span>
      {canEdit && (
        <button type="button" className="attendance-sheet-icon-btn" onClick={() => setEditing(true)} title="Edit today's task status" aria-label="Edit today's task status">
          <Edit3 size={12} />
        </button>
      )}
    </div>
  )
}

export default function AttendanceSheetView({ mode = 'employee' }) {
  const isHr = mode === 'hr'
  const [month, setMonth] = useState(istMonth())
  const [rangeMode, setRangeMode] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [dailyUpdate, setDailyUpdate] = useState('')

  const { data: employeesRes, isFetching: loadingEmployees } = useGetEmployeesQuery(
    { per_page: 500, status: 'active' },
    { skip: !isHr }
  )
  const employees = employeesRes?.data?.employees || employeesRes?.data || []

  useEffect(() => {
    if (isHr && !employeeId && employees.length > 0) {
      setEmployeeId(String(employees[0].id))
    }
  }, [employeeId, employees, isHr])

  const queryParams = useMemo(() => {
    const dateParams = rangeMode
      ? { from: fromDate, to: toDate }
      : { month }
    return isHr
      ? { employee_id: employeeId, ...dateParams }
      : { my: '1', ...dateParams }
  }, [employeeId, fromDate, isHr, month, rangeMode, toDate])

  const shouldSkip = isHr
    ? !employeeId || (rangeMode && (!fromDate || !toDate))
    : rangeMode && (!fromDate || !toDate)

  const { data: sheetRes, isFetching, isLoading, error, refetch } = useGetAttendanceSheetQuery(queryParams, {
    skip: shouldSkip,
  })

  // RTK may return either the API envelope or its unwrapped payload depending
  // on the configured base query. Normalize both shapes so the sheet never
  // incorrectly renders “no data” while a valid attendance payload exists.
  const data = sheetRes?.data?.data || sheetRes?.data || sheetRes
  const employee = data?.employee
  const summary = data?.summary || {}
  const rows = data?.rows || []
  const todayRow = rows.find(row => row.date === istDate())

  useEffect(() => {
    if (!isHr && todayRow?.task) setDailyUpdate(todayRow.task)
  }, [isHr, todayRow?.date, todayRow?.task])

  const [saveDailyUpdate, { isLoading: savingDailyUpdate }] = useUpdateDailyTaskMutation()
  const submitDailyUpdate = async () => {
    if (!dailyUpdate.trim()) return
    try {
      await saveDailyUpdate({ daily_task_update: dailyUpdate.trim() }).unwrap()
      await refetch()
    } catch {}
  }

  const exportSheet = () => {
    if (!data || rows.length === 0) return

    const dateParams = rangeMode ? { from: fromDate, to: toDate } : { month }
    const downloadParams = isHr
      ? { employee_id: employeeId, ...dateParams }
      : { my: '1', ...dateParams }
    downloadUrl(apiDownloadUrl(downloadParams))
  }

  return (
    <div className="attendance-sheet-view">
      <div className="search-bar attendance-sheet-toolbar">
        <div className="attendance-sheet-title">
          <Calendar size={18} />
          <strong>{isHr ? 'Employee Daily Work Update' : 'My Daily Work Update'}</strong>
        </div>

        {isHr && (
          <select
            className="form-select"
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            disabled={loadingEmployees}
            aria-label="Select employee"
          >
            <option value="">Select employee</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
            ))}
          </select>
        )}

        <label className="attendance-sheet-toggle">
          <input type="checkbox" checked={rangeMode} onChange={e => setRangeMode(e.target.checked)} />
          Date range
        </label>

        {rangeMode ? (
          <>
            <input className="form-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="From date" />
            <span className="attendance-sheet-muted">to</span>
            <input className="form-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="To date" />
          </>
        ) : (
          <input className="form-input" type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Select month" />
        )}

        <button className="btn btn-primary" type="button" onClick={exportSheet} disabled={!data || rows.length === 0}>
          <Download size={14} /> Download XLSX
        </button>
      </div>

      {!isHr && (
        <div className="card attendance-sheet-entry-card">
          <div className="attendance-sheet-entry-head">
            <div>
              <strong>Type today’s work update</strong>
              <span>Describe what you worked on today. HR can view your submission.</span>
            </div>
            <span className="attendance-sheet-entry-limit">Max 2,000 characters</span>
          </div>
          <textarea
            className="form-input attendance-sheet-entry-input"
            value={dailyUpdate}
            onChange={e => setDailyUpdate(e.target.value)}
            placeholder="Example: Completed the payroll report, fixed the attendance issue, and attended the project review."
            maxLength={2000}
            disabled={!todayRow?.check_in || savingDailyUpdate}
          />
          <div className="attendance-sheet-entry-footer">
            <span>{todayRow?.check_in ? 'Editable until 9:30 PM IST.' : 'Check in before submitting a work update.'}</span>
            <button className="btn btn-primary" type="button" onClick={submitDailyUpdate} disabled={!todayRow?.check_in || !dailyUpdate.trim() || savingDailyUpdate}>
              {savingDailyUpdate ? 'Saving...' : 'Save work update'}
            </button>
          </div>
        </div>
      )}

      {employee && (
        <div className="attendance-sheet-summary">
          <div className="attendance-sheet-employee">
            <strong>{employee.name}</strong>
            <span>{employee.employee_code || '-'} {employee.department ? `- ${employee.department}` : ''}</span>
          </div>
          {[
            ['Present', summary.present || 0],
            ['Absent', summary.absent || 0],
            ['Late', summary.late || 0],
            ['Week Off', summary.week_off || 0],
            ['Holiday', summary.holiday || 0],
            ['Worked Off', summary.worked_off_day || 0],
          ].map(([label, value]) => (
            <div className="attendance-sheet-stat" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {(isLoading || isFetching) && !data && (
        <div className="loading-container"><div className="spinner" /></div>
      )}

      {error && (
        <div className="card attendance-sheet-message">
          <AlertCircle size={28} />
          <p>{error.data?.message || 'Failed to load daily work update.'}</p>
        </div>
      )}

      {!error && !data && !shouldSkip && !isLoading && (
        <div className="card attendance-sheet-message">
          <Calendar size={28} />
          <p>No daily work update data found.</p>
        </div>
      )}

      {!error && shouldSkip && (
        <div className="card attendance-sheet-message">
          <Calendar size={28} />
          <p>Select an employee and date range to view the sheet.</p>
        </div>
      )}

      {data && rows.length > 0 && (
        <div className="card attendance-sheet-card">
          <div className="table-container attendance-sheet-table-wrap">
            <table className="attendance-sheet-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Log-in Time</th>
                  <th>Log-out Time</th>
                  <th>Working Hours</th>
                  <th>Mode</th>
                  <th>Work Update</th>
                  <th>Work Status</th>
                  <th>Late</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isOffOnly = row.row_type === 'week_off' || row.row_type === 'holiday'
                  return (
                    <tr key={row.date} className={rowClass(row)}>
                      <td>{row.date}</td>
                      <td>{row.day_name}</td>
                      {isOffOnly ? (
                        <>
                          <td colSpan={4} className="attendance-sheet-special">{row.special_label || statusLabel(row)}</td>
                        </>
                      ) : (
                        <>
                          <td>{dash(row.check_in)}</td>
                          <td>{dash(row.check_out)}</td>
                          <td>{dash(row.working_hours)}</td>
                          <td>
                            {row.mode === 'wfh' ? (
                              <span className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                                🏠 WFH
                              </span>
                            ) : row.mode === 'office' ? (
                              <span className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.12)', color: 'var(--primary)', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                                🏢 Office
                              </span>
                            ) : '-'}
                          </td>
                        </>
                      )}
                      <td title={row.task || ''}>{row.task || (row.row_type === 'absent' ? 'Absent' : '-')}</td>
                      <td>
                        <TaskStatusCell row={row} editable={!isHr} onUpdate={refetch} />
                      </td>
                      <td>{row.late_minutes > 0 ? `${row.late_minutes}m` : '-'}</td>
                      <td>
                        <span className={`attendance-sheet-status ${row.row_type}`}>
                          {statusLabel(row)}
                        </span>
                        {row.worked_off_day && row.special_label && (
                          <small>{row.special_label}</small>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="card attendance-sheet-message">
          <Calendar size={28} />
          <p>No rows for the selected period.</p>
        </div>
      )}
    </div>
  )
}
