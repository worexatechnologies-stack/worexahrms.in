import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import {
  AlertCircle, Calendar, CheckCircle2, Clock, Download, Edit3, Save, X,
  Building2, Home, Check, ChevronRight, ChevronLeft, FileSpreadsheet,
  Briefcase, ArrowUpRight, Flame, ListPlus, Filter, Smile, RotateCcw
} from 'lucide-react'
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

const QUICK_TAGS = ['Feature', 'Bug Fix', 'Meeting', 'DevOps', 'Review']

function renderTag(tagStr) {
  const lower = String(tagStr).toLowerCase()
  let cls = 'dw-tag-feature'
  if (lower.includes('bug') || lower.includes('fix')) cls = 'dw-tag-bug'
  else if (lower.includes('design') || lower.includes('ui') || lower.includes('ux')) cls = 'dw-tag-design'
  else if (lower.includes('meet') || lower.includes('sync') || lower.includes('client')) cls = 'dw-tag-meeting'
  else if (lower.includes('devops') || lower.includes('ops') || lower.includes('config') || lower.includes('server')) cls = 'dw-tag-devops'
  else if (lower.includes('review') || lower.includes('doc')) cls = 'dw-tag-review'
  return <span key={tagStr} className={`dw-tag-badge ${cls}`}>{tagStr}</span>
}

function parseFormattedText(text) {
  if (!text) return null
  const match = text.match(/^\[(.*?)\]\s*(.*)$/)
  if (match) {
    return (
      <div style={{ display: 'inline' }}>
        {renderTag(match[1])}
        <span>{match[2]}</span>
      </div>
    )
  }
  return <span>{text}</span>
}

function renderWorkUpdate(task) {
  if (!task || task.trim() === '-' || task.trim().toLowerCase() === 'absent') {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }

  const cleaned = task.replace(/^Today's Update\s*[-*:]\s*/i, '').trim()

  if (cleaned.includes('*') || cleaned.includes('•') || cleaned.includes('\n')) {
    const items = cleaned
      .split(/[*•\n]+/)
      .map(s => s.trim())
      .filter(Boolean)

    if (items.length > 1) {
      return (
        <div className="att-task-bullet-list">
          {items.map((item, idx) => (
            <div key={idx} className="att-task-bullet-item">
              <span className="att-task-bullet-dot" />
              <div>{parseFormattedText(item)}</div>
            </div>
          ))}
        </div>
      )
    }
  }

  return (
    <div className="att-task-single-text" title={task}>
      {parseFormattedText(cleaned)}
    </div>
  )
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

function formatWorkingHours(str) {
  if (!str || str === '-' || str === '00:00:00') return null
  const parts = str.split(':')
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (isNaN(h) || isNaN(m)) return str
    if (h === 0 && m === 0) return null
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  return str
}

function formatTime12h(val) {
  if (!val || val === '-') return null
  const [hStr, mStr] = val.split(':')
  if (hStr === undefined || mStr === undefined) return val
  let h = parseInt(hStr, 10)
  const m = mStr.substring(0, 2)
  if (isNaN(h)) return val
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${ampm}`
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateDisplay(dateStr) {
  if (!dateStr) return '-'
  const parts = String(dateStr).split('-')
  if (parts.length === 3) {
    const y = parts[0]
    const m = parseInt(parts[1], 10) - 1
    const d = parts[2]
    if (m >= 0 && m < 12) {
      return `${d} ${MONTH_NAMES_SHORT[m]} ${y}`
    }
  }
  return dateStr
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

  if (!row.task) return <span className="att-dash">—</span>

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
          <option value="pending">In Progress</option>
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

  const isCompleted = row.task_status === 'completed'
  return (
    <div className="attendance-sheet-status-wrap">
      <span className={`att-task-status ${isCompleted ? 'completed' : 'pending'}`}>
        <span className={`att-status-dot ${isCompleted ? 'dot-completed' : 'dot-pending'}`} />
        {isCompleted ? 'Completed' : 'In Progress'}
      </span>
      {canEdit && (
        <button type="button" className="attendance-sheet-icon-btn" onClick={() => setEditing(true)} title="Edit today's task status" aria-label="Edit today's task status">
          <Edit3 size={11} />
        </button>
      )}
    </div>
  )
}

export default function AttendanceSheetView({ mode = 'employee' }) {
  const user = useSelector(state => state.auth?.user)
  const isViyana = user?.company_slug === 'viyana'
  const isHr = mode === 'hr'
  const { toast } = useToast()

  const [month, setMonth] = useState(istMonth())
  const [rangeMode, setRangeMode] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [dailyUpdate, setDailyUpdate] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'with_updates' | 'rest_days'

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

  const data = sheetRes?.data?.data || sheetRes?.data || sheetRes
  const employee = data?.employee
  const summary = data?.summary || {}
  const rows = data?.rows || []
  const todayRow = rows.find(row => row.date === istDate())

  useEffect(() => {
    if (!isHr && todayRow?.task) setDailyUpdate(todayRow.task)
  }, [isHr, todayRow?.date, todayRow?.task])

  const [saveDailyUpdate, { isLoading: savingDailyUpdate }] = useUpdateDailyTaskMutation()
  const [updateTaskStatus, { isLoading: updatingTodayStatus }] = useUpdateTaskStatusMutation()

  const submitDailyUpdate = async () => {
    if (!dailyUpdate.trim()) return
    try {
      await saveDailyUpdate({ daily_task_update: dailyUpdate.trim() }).unwrap()
      await refetch()
      setJustSaved(true)
      toast('Work update saved successfully.', 'success')
      setTimeout(() => setJustSaved(false), 3000)
    } catch (err) {
      toast(err?.data?.message || 'Failed to save daily update.', 'error')
    }
  }

  const handleToggleTodayStatus = async () => {
    if (!todayRow || !todayRow.check_in) return
    const nextStatus = todayRow.task_status === 'completed' ? 'pending' : 'completed'
    try {
      await updateTaskStatus({ date: istDate(), status: nextStatus }).unwrap()
      await refetch()
      toast(`Status marked as ${nextStatus === 'completed' ? 'Completed' : 'In Progress'}.`, 'success')
    } catch (err) {
      toast(err?.data?.message || 'Failed to update status.', 'error')
    }
  }

  // Quick action helpers
  const handleInsertTag = (tag) => {
    const prefix = `• [${tag}] `
    setDailyUpdate(prev => {
      if (!prev.trim()) return prefix
      const endsWithNewline = prev.endsWith('\n')
      return `${prev}${endsWithNewline ? '' : '\n'}${prefix}`
    })
  }

  const handleAddBullet = () => {
    setDailyUpdate(prev => {
      if (!prev.trim()) return '• '
      const endsWithNewline = prev.endsWith('\n')
      return `${prev}${endsWithNewline ? '' : '\n'}• `
    })
  }

  const chars = dailyUpdate.length

  // Month navigation helpers
  const monthLabel = useMemo(() => {
    try {
      const [y, m] = month.split('-').map(Number)
      const d = new Date(y, m - 1, 1)
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    } catch {
      return month
    }
  }, [month])

  const isCurrentMonth = month === istMonth()

  const handlePrevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setMonth(prev)
  }

  const handleNextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (next <= istMonth()) {
      setMonth(next)
    }
  }

  // Monthly Pulse & Streak Calculation
  const monthlyPulse = useMemo(() => {
    if (!rows || rows.length === 0) return null
    const workRows = rows.filter(r => r.row_type === 'work' || r.worked_off_day)
    const loggedRows = workRows.filter(r => r.task && r.task.trim() !== '-' && r.task.trim().toLowerCase() !== 'absent')
    const totalWorkdays = workRows.length
    const loggedCount = loggedRows.length
    const rate = totalWorkdays > 0 ? Math.round((loggedCount / totalWorkdays) * 100) : 0

    let streak = 0
    const sorted = [...rows].filter(r => r.date <= istDate()).reverse()
    for (const r of sorted) {
      if (r.row_type === 'week_off' || r.row_type === 'holiday') continue
      if (r.task && r.task.trim() && r.task.trim() !== '-' && r.task.trim().toLowerCase() !== 'absent') {
        streak++
      } else {
        break
      }
    }

    return {
      totalWorkdays,
      loggedCount,
      rate,
      streak: Math.max(streak, loggedCount > 0 ? 1 : 0)
    }
  }, [rows])

  // Filtered rows for table view
  const filteredRows = useMemo(() => {
    if (activeFilter === 'with_updates') {
      return rows.filter(r => r.task && r.task.trim() !== '-' && r.task.trim().toLowerCase() !== 'absent')
    }
    if (activeFilter === 'rest_days') {
      return rows.filter(r => r.row_type === 'week_off' || r.row_type === 'holiday')
    }
    return rows
  }, [rows, activeFilter])

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
      
      {/* Top Toolbar: Minimal, Clean & Sleek */}
      <div className="dw-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 'auto' }}>
          <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)', flexShrink: 0 }}>
            <FileSpreadsheet size={18} />
          </div>
          <div>
            <strong style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {isHr ? 'Employee Work Update Log' : 'My Work Updates'}
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

        {/* Custom Range toggle */}
        <button
          type="button"
          onClick={() => setRangeMode(!rangeMode)}
          style={{
            padding: '7px 13px',
            borderRadius: '10px',
            fontSize: '12px',
            fontWeight: 700,
            border: '1px solid var(--border)',
            background: rangeMode ? 'var(--primary-soft)' : 'var(--surface-2)',
            color: rangeMode ? 'var(--primary)' : 'var(--text)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <Calendar size={13} />
          <span>{rangeMode ? 'Switch to Month' : 'Custom Dates'}</span>
        </button>

        {/* Date Selector / Stepper */}
        {rangeMode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="form-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="From date" style={{ borderRadius: '10px', padding: '6px 10px', fontSize: '12.5px' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>to</span>
            <input className="form-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="To date" style={{ borderRadius: '10px', padding: '6px 10px', fontSize: '12.5px' }} />
          </div>
        ) : (
          <div className="dw-month-stepper">
            <button 
              type="button" 
              className="dw-month-btn" 
              onClick={handlePrevMonth} 
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="dw-month-display">
              {monthLabel}
            </div>
            <button 
              type="button" 
              className="dw-month-btn" 
              onClick={handleNextMonth} 
              disabled={isCurrentMonth}
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight size={16} />
            </button>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonth(istMonth())}
                style={{
                  marginLeft: 4,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Today
              </button>
            )}
          </div>
        )}

        <button 
          className="btn btn-secondary" 
          type="button" 
          onClick={exportSheet} 
          disabled={!data || rows.length === 0} 
          style={{ borderRadius: '10px', padding: '8px 16px', fontWeight: 700, fontSize: '12.5px' }}
        >
          <Download size={13} /> Export XLSX
        </button>
      </div>

      {/* Daily Work Update Entry Form (Employee View) - Minimal, Simple & Professional */}
      {!isHr && (
        <div className="dw-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                Daily Work Update
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                {todayRow?.check_in 
                  ? 'Summarize your daily tasks, meetings, and key highlights.' 
                  : 'Check in before submitting today’s work update.'}
              </p>
            </div>

            {/* Context Badge & Optional Status Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {todayRow?.check_in ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 700, padding: '4px 11px', borderRadius: 99, background: 'rgba(16, 185, 129, 0.08)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                  Clocked in: {todayRow.check_in}
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 700, padding: '4px 11px', borderRadius: 99, background: 'rgba(245, 158, 11, 0.08)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <Clock size={12} />
                  Clock-in Required
                </span>
              )}

              {todayRow?.check_in && todayRow?.task && (
                <button
                  type="button"
                  onClick={handleToggleTodayStatus}
                  disabled={updatingTodayStatus}
                  title="Toggle task completion status"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 11px',
                    borderRadius: 99,
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: '1px solid',
                    transition: 'all 0.15s ease',
                    background: todayRow.task_status === 'completed' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.08)',
                    color: todayRow.task_status === 'completed' ? '#047857' : 'var(--primary)',
                    borderColor: todayRow.task_status === 'completed' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(37, 99, 235, 0.25)'
                  }}
                >
                  {todayRow.task_status === 'completed' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                  {todayRow.task_status === 'completed' ? 'Status: Completed' : 'Status: In Progress'}
                </button>
              )}
            </div>
          </div>

          {/* Minimal Textarea */}
          <textarea
            className="dw-editor-textarea"
            value={dailyUpdate}
            onChange={e => setDailyUpdate(e.target.value)}
            placeholder="e.g. Completed client onboarding feature, fixed attendance calculation edge case, attended team sprint review..."
            maxLength={2000}
            disabled={!todayRow?.check_in || savingDailyUpdate}
          />

          {/* Integrated Minimal Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {/* Quick Insert helpers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Insert:
              </span>
              <button
                type="button"
                className="dw-tag-pill"
                onClick={handleAddBullet}
                disabled={!todayRow?.check_in}
                title="Add bullet point"
              >
                • Bullet
              </button>
              {QUICK_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className="dw-tag-pill"
                  onClick={() => handleInsertTag(tag)}
                  disabled={!todayRow?.check_in}
                >
                  + {tag}
                </button>
              ))}
            </div>

            {/* Character counter & Primary Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {chars} / 2,000 chars
              </span>
              {justSaved && (
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Check size={13} /> Saved
                </span>
              )}
              <button
                className="btn btn-primary"
                type="button"
                onClick={submitDailyUpdate}
                disabled={!todayRow?.check_in || !dailyUpdate.trim() || savingDailyUpdate}
                style={{
                  borderRadius: '10px',
                  padding: '8px 20px',
                  fontWeight: 700,
                  fontSize: '13px',
                  background: 'var(--primary, #2563eb)',
                  color: '#ffffff'
                }}
              >
                {savingDailyUpdate ? 'Saving...' : 'Save Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Pulse & Streak Card (Employee View) */}
      {!isHr && monthlyPulse && monthlyPulse.totalWorkdays > 0 && (
        <div className="dw-pulse-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div className="dw-streak-badge">
              <Flame size={15} style={{ color: '#ea580c' }} />
              <span>{monthlyPulse.streak} Day Log Streak</span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
              <strong>{monthlyPulse.loggedCount}</strong> of <strong>{monthlyPulse.totalWorkdays}</strong> workdays documented ({monthlyPulse.rate}%)
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160, flex: '1 1 200px', maxWidth: 280 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
              <div 
                style={{ 
                  height: '100%', 
                  width: `${monthlyPulse.rate}%`, 
                  borderRadius: 99, 
                  background: 'linear-gradient(90deg, #2563eb, #10b981)',
                  transition: 'width 0.4s ease'
                }} 
              />
            </div>
            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--primary)' }}>
              {monthlyPulse.rate}%
            </span>
          </div>
        </div>
      )}

      {/* Summary KPI Strip */}
      {employee && (
        <div className="dw-kpi-grid">
          <div className="dw-kpi-card dw-kpi-emp">
            <div className="dw-kpi-emp-avatar">
              {((employee?.name || user?.name || 'SA').slice(0, 2)).toUpperCase()}
            </div>
            <div className="dw-kpi-emp-info">
              <span className="dw-kpi-emp-name">
                {employee?.name || user?.name || 'Employee'}
              </span>
              <span className="dw-kpi-emp-code">
                {employee?.employee_code || user?.employee_code ? `#${employee?.employee_code || user?.employee_code}` : ''}
                {!isViyana && (employee?.department || user?.department) ? ` · ${employee?.department || user?.department}` : ''}
              </span>
            </div>
          </div>

          <div className="dw-kpi-card">
            <span className="dw-kpi-label">Present</span>
            <span className="dw-kpi-value text-emerald">{summary.present ?? 0}</span>
          </div>

          <div className="dw-kpi-card">
            <span className="dw-kpi-label">Absent</span>
            <span className="dw-kpi-value text-rose">{summary.absent ?? 0}</span>
          </div>

          {!isViyana && (
            <>
              <div className="dw-kpi-card">
                <span className="dw-kpi-label">Late</span>
                <span className="dw-kpi-value text-amber">{summary.late ?? 0}</span>
              </div>

              <div className="dw-kpi-card">
                <span className="dw-kpi-label">Week Off</span>
                <span className="dw-kpi-value text-indigo">{summary.week_off ?? 0}</span>
              </div>

              <div className="dw-kpi-card">
                <span className="dw-kpi-label">Holiday</span>
                <span className="dw-kpi-value text-purple">{summary.holiday ?? 0}</span>
              </div>

              <div className="dw-kpi-card">
                <span className="dw-kpi-label">Worked Off</span>
                <span className="dw-kpi-value text-cyan">{summary.worked_off_day ?? 0}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading State */}
      {(isLoading || isFetching) && !data && (
        <div className="loading-container"><div className="spinner" /></div>
      )}

      {/* Error State */}
      {error && (
        <div className="dw-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--danger)' }}>
          <AlertCircle size={28} style={{ margin: '0 auto 8px' }} />
          <p style={{ margin: 0, fontWeight: 700 }}>{error.data?.message || 'Failed to load daily work update.'}</p>
        </div>
      )}

      {/* Filter Tabs & History Table Header */}
      {data && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-2)', padding: 3, borderRadius: 99, border: '1px solid var(--border)' }}>
            <button 
              type="button" 
              className={`dw-filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All Days ({rows.length})
            </button>
            <button 
              type="button" 
              className={`dw-filter-tab ${activeFilter === 'with_updates' ? 'active' : ''}`}
              onClick={() => setActiveFilter('with_updates')}
            >
              With Updates ({rows.filter(r => r.task && r.task.trim() !== '-' && r.task.trim().toLowerCase() !== 'absent').length})
            </button>
            <button 
              type="button" 
              className={`dw-filter-tab ${activeFilter === 'rest_days' ? 'active' : ''}`}
              onClick={() => setActiveFilter('rest_days')}
            >
              Rest Days & Holidays ({rows.filter(r => r.row_type === 'week_off' || r.row_type === 'holiday').length})
            </button>
          </div>

          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Showing {filteredRows.length} {filteredRows.length === 1 ? 'record' : 'records'}
          </span>
        </div>
      )}

      {/* Table Card */}
      {data && filteredRows.length > 0 && (
        <div className="card attendance-sheet-card animate-fade-in">
          <div className="table-container attendance-sheet-table-wrap">
            <table className="attendance-sheet-table">
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Date</th>
                  <th style={{ width: '105px' }}>Log-in</th>
                  <th style={{ width: '105px' }}>Log-out</th>
                  <th style={{ width: '115px' }}>Working Hours</th>
                  <th style={{ width: '95px', textAlign: 'center' }}>Mode</th>
                  <th style={{ minWidth: '320px' }}>Work Update</th>
                  <th style={{ width: '125px', textAlign: 'center' }}>Work Status</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Late</th>
                  <th style={{ width: '160px' }}>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const isWeekend = row.day_name === 'Sat' || row.day_name === 'Sun'
                  const isFullShift = row.working_hours && row.working_hours >= '07:30:00'
                  const displayHours = formatWorkingHours(row.working_hours)

                  return (
                    <tr key={row.date} className={rowClass(row)}>
                      <td className="att-date-col">
                        <div className="att-date-cell-inner">
                          <span className="att-date-main">{formatDateDisplay(row.date)}</span>
                          <span className={`att-date-sub ${isWeekend ? 'weekend' : 'weekday'}`}>
                            {row.day_name}
                          </span>
                        </div>
                      </td>

                      <td>
                        {row.check_in ? (
                          <span className="att-time-text">
                            {formatTime12h(row.check_in)}
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td>
                        {row.check_out ? (
                          <span className="att-time-text">
                            {formatTime12h(row.check_out)}
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td>
                        {displayHours ? (
                          <span className={`att-hours-text ${isFullShift ? 'full-shift' : ''}`}>
                            {displayHours}
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        {row.mode === 'wfh' ? (
                          <span className="att-mode-chip wfh">
                            <Home size={11} />
                            Remote
                          </span>
                        ) : row.mode === 'office' ? (
                          <span className="att-mode-chip office">
                            <Building2 size={11} />
                            Office
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td>
                        {row.task ? (
                          renderWorkUpdate(row.task)
                        ) : row.row_type === 'week_off' ? (
                          <span className="att-rest-note">
                            {row.special_label || 'Scheduled Rest Day (Sunday)'}
                          </span>
                        ) : row.row_type === 'holiday' ? (
                          <span className="att-holiday-note">
                            {row.special_label || 'Official Holiday'}
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        {row.check_in || row.worked_off_day ? (
                          <TaskStatusCell row={row} editable={!isHr} onUpdate={refetch} />
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        {row.late_minutes > 0 ? (
                          <span className="att-late-tag">
                            +{row.late_minutes}m
                          </span>
                        ) : (
                          <span className="att-dash">—</span>
                        )}
                      </td>

                      <td>
                        {row.worked_off_day ? (
                          <div className="att-cell-stacked">
                            <span className="att-badge worked-off">
                              <span className="att-status-dot dot-worked-off" />
                              Worked Off Day
                            </span>
                            {row.special_label && (
                              <span className="att-sub-label">{row.special_label}</span>
                            )}
                          </div>
                        ) : row.row_type === 'holiday' ? (
                          <div className="att-cell-stacked">
                            <span className="att-badge holiday">
                              <span className="att-status-dot dot-holiday" />
                              Holiday
                            </span>
                            {row.special_label && (
                              <span className="att-sub-label">{row.special_label}</span>
                            )}
                          </div>
                        ) : row.row_type === 'week_off' ? (
                          <span className="att-badge week-off">
                            Week Off
                          </span>
                        ) : row.row_type === 'absent' ? (
                          <span className="att-badge absent">
                            <span className="att-status-dot dot-absent" />
                            Absent
                          </span>
                        ) : (
                          <span className="att-badge present">
                            <span className="att-status-dot dot-present" />
                            Present
                          </span>
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

      {/* Empty State */}
      {(!data || rows.length === 0 || filteredRows.length === 0) && !isLoading && !isFetching && !error && (
        <div className="dw-card" style={{ padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <Calendar size={26} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text)' }}>
              No records found for this period
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)', maxWidth: 380 }}>
              {activeFilter !== 'all' 
                ? 'No rows match the selected filter. Try switching back to "All Days".' 
                : 'No attendance or daily work updates recorded for the selected dates.'}
            </p>
          </div>
          {activeFilter !== 'all' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveFilter('all')}
              style={{ borderRadius: '10px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', marginTop: 4 }}
            >
              Reset Filter
            </button>
          ) : !isCurrentMonth ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { setMonth(istMonth()); setRangeMode(false); }}
              style={{ borderRadius: '10px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', marginTop: 4 }}
            >
              View Current Month
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
