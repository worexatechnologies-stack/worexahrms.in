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
    <div className="attendance-sheet-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* Top Toolbar */}
      <div className="search-bar attendance-sheet-toolbar" style={{ borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--bg-card)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div className="attendance-sheet-title" style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 'auto' }}>
          <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)', flexShrink: 0 }}>
            <Calendar size={18} />
          </div>
          <div>
            <strong style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {isHr ? 'Employee Daily Work Update' : 'My Daily Work Update'}
            </strong>
          </div>
        </div>

        {isHr && (
          <select
            className="form-select"
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            disabled={loadingEmployees}
            aria-label="Select employee"
            style={{ borderRadius: '10px', minWidth: 220 }}
          >
            <option value="">Select employee</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
            ))}
          </select>
        )}

        <label className="attendance-sheet-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '13px', fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={rangeMode} onChange={e => setRangeMode(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
          Date range
        </label>

        {rangeMode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="form-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="From date" style={{ borderRadius: '10px' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>to</span>
            <input className="form-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="To date" style={{ borderRadius: '10px' }} />
          </div>
        ) : (
          <input className="form-input" type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Select month" style={{ borderRadius: '10px', minWidth: 160 }} />
        )}

        <button className="btn btn-primary" type="button" onClick={exportSheet} disabled={!data || rows.length === 0} style={{ borderRadius: '10px', padding: '9px 18px', fontWeight: 700 }}>
          <Download size={14} /> Download XLSX
        </button>
      </div>

      {/* Daily Work Update Entry Form (Employee View) */}
      {!isHr && (
        <div className="card" style={{ padding: '22px 24px', borderRadius: '18px', border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>Type today’s work update</h3>
              <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>Describe what you worked on today. HR can view your submission.</p>
            </div>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '4px 12px', borderRadius: '99px', border: '1px solid var(--border)' }}>
              Max 2,000 characters
            </span>
          </div>

          <textarea
            className="form-input"
            value={dailyUpdate}
            onChange={e => setDailyUpdate(e.target.value)}
            placeholder="Example: Completed the payroll report, fixed the attendance issue, and attended the project review."
            maxLength={2000}
            disabled={!todayRow?.check_in || savingDailyUpdate}
            style={{ width: '100%', minHeight: 110, padding: '14px', borderRadius: '12px', fontSize: '13.5px', lineHeight: 1.5, background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: todayRow?.check_in ? 'var(--success)' : 'var(--warning)', display: 'inline-block' }} />
              <span>{todayRow?.check_in ? 'Editable until 9:30 PM IST.' : 'Check in before submitting a work update.'}</span>
            </div>
            <button className="btn btn-primary" type="button" onClick={submitDailyUpdate} disabled={!todayRow?.check_in || !dailyUpdate.trim() || savingDailyUpdate} style={{ borderRadius: '10px', padding: '9px 20px', fontWeight: 700 }}>
              {savingDailyUpdate ? 'Saving...' : 'Save work update'}
            </button>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      {employee && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          {/* Employee Badge */}
          <div style={{ padding: '14px 18px', borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <strong style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {employee.name}
            </strong>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {employee.employee_code || '-'} {employee.department ? `· ${employee.department}` : ''}
            </span>
          </div>

          {[
            ['Present', summary.present || 0, 'var(--success)'],
            ['Absent', summary.absent || 0, 'var(--danger)'],
            ['Late', summary.late || 0, 'var(--warning)'],
            ['Week Off', summary.week_off || 0, 'var(--primary)'],
            ['Holiday', summary.holiday || 0, '#8b5cf6'],
            ['Worked Off', summary.worked_off_day || 0, '#06b6d4'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ padding: '14px 16px', borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '22px', fontWeight: 800, color: color || 'var(--text)', lineHeight: 1.1 }}>
                {value}
              </strong>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>
                {label}
              </span>
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
