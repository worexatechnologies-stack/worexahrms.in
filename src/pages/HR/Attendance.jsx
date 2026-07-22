import { useState, useCallback, useRef, useMemo } from 'react'
import {
  useGetAttendanceQuery,
  useGetAttendanceSettingsQuery,
  useUpdateAttendanceSettingsMutation,
  useManualCreateAttendanceMutation,
  useManualUpdateAttendanceMutation,
  usePauseResumeTimerMutation,
  useGetEmployeesQuery,
  useGetEmployeeQuery
} from '../../store/apiSlice'
import { useToast } from '../../App'
import { RefreshCw, Settings, Save, Clock, Coffee, LogIn, LogOut, Sunset, Plus, ChevronLeft, ChevronRight, PauseCircle, PlayCircle, User, Mail, Phone, Briefcase, Calendar, MapPin, X } from 'lucide-react'
import { DEFAULT_CFG } from '../../utils/attendanceHelpers'
import PauseResumeModal from '../../components/PauseResumeModal'
import StatusBadge from '../../components/ui/StatusBadge'
import AttendanceSheetView from '../../components/AttendanceSheetView'

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'early_checkout', label: 'Early Checkout' },
  { value: 'half_day', label: 'Half Day' },
]

const blankForm = () => ({
  employee_id: '',
  date: new Date().toISOString().slice(0, 10),
  status: 'present',
  check_in: '',
  check_out: '',
  late_minutes: '0',
  working_hours: '',
  daily_task_update: '',
})

const PER_PAGE = 20

export default function HrAttendance() {
  const [pauseConfirmRecord, setPauseConfirmRecord] = useState(null) // record to confirm pause

  // ...rest of state
  const [showAdd,    setShowAdd]    = useState(false)
  const [showCfg,    setShowCfg]    = useState(false)
  const [cfg,        setCfg]        = useState(DEFAULT_CFG)
  const [form,       setForm]       = useState(blankForm)
  const [saving,     setSaving]     = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [activeView, setActiveView] = useState('records')

  // filters & pagination
  const [selectedDate,   setSelectedDate]   = useState(new Date().toISOString().slice(0, 10))
  const [statusFilter,   setStatusFilter]   = useState('')
  const [page,           setPage]           = useState(1)

  const [selectedEmpId, setSelectedEmpId] = useState(null)

  const { data: employeeDetailsRes, isFetching: loadingEmpDetails } = useGetEmployeeQuery(selectedEmpId, {
    skip: !selectedEmpId
  })

  const { data: employeeAttendanceRes, isFetching: loadingEmpAttendance } = useGetAttendanceQuery({
    employee_id: selectedEmpId,
    per_page: 200
  }, {
    skip: !selectedEmpId
  })

  const employeeData = Array.isArray(employeeDetailsRes) ? employeeDetailsRes[0] : employeeDetailsRes?.data || employeeDetailsRes
  const empRecords = employeeAttendanceRes?.data?.records || employeeAttendanceRes?.data || []

  const [statsRange, setStatsRange] = useState('30') // '7', '30', '90', 'custom', 'all'
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  const filteredRecords = useMemo(() => {
    if (!empRecords) return []
    return empRecords.filter(rec => {
      if (!rec.date) return false
      
      if (statsRange === '7') {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        return rec.date >= cutoffStr
      }
      if (statsRange === '30') {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 30)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        return rec.date >= cutoffStr
      }
      if (statsRange === '90') {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 90)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        return rec.date >= cutoffStr
      }
      if (statsRange === 'custom') {
        let match = true
        if (customStartDate) {
          match = match && (rec.date >= customStartDate)
        }
        if (customEndDate) {
          match = match && (rec.date <= customEndDate)
        }
        return match
      }
      return true // 'all'
    })
  }, [empRecords, statsRange, customStartDate, customEndDate])

  const stats = useMemo(() => {
    const s = {
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0,
      earlyCheckout: 0,
      wfhDays: 0,
      officeDays: 0,
      totalDays: filteredRecords.length
    }

    filteredRecords.forEach(rec => {
      if (rec.status === 'present') s.present++
      else if (rec.status === 'absent') s.absent++
      else if (rec.status === 'late') {
        s.present++
        s.late++
      }
      else if (rec.status === 'half_day') s.halfDay++
      else if (rec.status === 'early_checkout') {
        s.present++
        s.earlyCheckout++
      }

      if (rec.mode === 'wfh' || rec.work_mode === 'wfh') s.wfhDays++
      else if (rec.mode === 'office' || rec.work_mode === 'office') s.officeDays++
    })
    return s
  }, [filteredRecords])

  const { toast } = useToast()

  // ----- RTK Query Hooks -----
  const { data: attendanceRes, isFetching: loading, refetch: load } = useGetAttendanceQuery({
    page,
    per_page: PER_PAGE,
    ...(selectedDate ? { date: selectedDate } : {}),
    ...(statusFilter ? { status: statusFilter } : {})
  })

  const { data: settingsRes } = useGetAttendanceSettingsQuery(undefined, {
    skip: !showCfg,
  })

  // Callback to sync local settings state when query resolves
  const handleSettingsLoaded = useCallback((data) => {
    if (data?.data) {
      setCfg({ ...DEFAULT_CFG, ...data.data })
    }
  }, [])

  // We can use an effect to keep local settings state synced when setting query loads
  const remoteSettings = settingsRes?.data
  const prevRemoteSettings = useRef(null)
  if (remoteSettings && remoteSettings !== prevRemoteSettings.current) {
    prevRemoteSettings.current = remoteSettings
    setCfg({ ...DEFAULT_CFG, ...remoteSettings })
  }

  const { data: employeesRes } = useGetEmployeesQuery(
    { per_page: 500, status: 'active' },
    { skip: !showAdd }
  )

  const [updateSettings] = useUpdateAttendanceSettingsMutation()
  const [addRecord] = useManualCreateAttendanceMutation()
  const [updateRecord] = useManualUpdateAttendanceMutation()
  const [togglePause] = usePauseResumeTimerMutation()

  const d = attendanceRes?.data
  const records = d?.records || d || []
  const pagination = d?.pagination || null

  const employees = employeesRes?.data?.employees || employeesRes?.data || []

  // Reset to page 1 when filters change
  const applyFilter = (newDate, newStatus) => {
    setSelectedDate(newDate)
    setStatusFilter(newStatus)
    setPage(1)
  }

  const toggleSettings = () => {
    setShowCfg(v => !v)
  }

  const toggleAdd = () => {
    setShowAdd(v => !v)
  }

  const saveCfg = async () => {
    setSaving(true)
    try {
      await updateSettings(cfg).unwrap()
      toast('Attendance settings saved.', 'success')
      setShowCfg(false)
    } catch { toast('Failed to save settings.', 'error') }
    setSaving(false)
  }

  const saveRecord = async (e) => {
    e.preventDefault()
    if (!form.employee_id || !form.date || !form.status) {
      toast('Employee, date and status are required.', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = { ...form }
      if (payload.status === 'absent') {
        payload.check_in = ''; payload.check_out = ''
        payload.late_minutes = 0; payload.working_hours = ''
      }
      await addRecord(payload).unwrap()
      toast('Attendance record saved.', 'success')
      setForm(blankForm())
      setShowAdd(false)
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to save attendance.', 'error')
    } finally { setSaving(false) }
  }

  const updateStatus = async (record, status) => {
    setUpdatingId(record.id)
    try {
      await updateRecord({ id: record.id, body: { status } }).unwrap()
      toast('Attendance updated.', 'success')
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to update.', 'error')
    } finally { setUpdatingId(null) }
  }

  const [pauseTarget, setPauseTarget] = useState(null)

  const toggleHrPause = (record) => {
    setPauseTarget(record)
  }

  const handleConfirmPauseResume = async (reason) => {
    if (!pauseTarget) return
    const record = pauseTarget
    const isPaused = !!record.hr_timer_paused
    setPauseTarget(null)
    setUpdatingId(record.id)
    try {
      await togglePause({
        action: isPaused ? 'hr_resume_timer' : 'hr_pause_timer',
        body: { 
          employee_id: record.employee_id,
          reason: reason || undefined
        }
      }).unwrap()
      toast(
        isPaused ? 'Employee timer resumed successfully.' : 'Employee timer paused successfully.',
        'success',
        { speak: false, sound: false }
      )
      window.dispatchEvent(new Event('attendance-changed'))
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to update timer.', 'error')
    } finally { setUpdatingId(null) }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <div className="attendance-view-tabs">
        <button
          type="button"
          className={`btn btn-sm ${activeView === 'records' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveView('records')}
        >
          Daily Records
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeView === 'sheet' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveView('sheet')}
        >
          Daily Work Update
        </button>
      </div>

      {activeView === 'sheet' ? (
        <AttendanceSheetView mode="hr" />
      ) : (
        <>
      {/* toolbar */}
      <div className="search-bar">
        <button className="btn btn-secondary" onClick={() => load()}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button className="btn btn-primary" onClick={toggleSettings}>
          <Settings size={14} /> {showCfg ? 'Hide' : 'Attendance'} Settings
        </button>
        <button className="btn btn-secondary" onClick={toggleAdd}>
          <Plus size={14} /> {showAdd ? 'Hide' : 'Add'} Record
        </button>

        {/* Date filter */}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Date:</span>
        <input
          type="date"
          className="form-input"
          value={selectedDate}
          onChange={e => applyFilter(e.target.value, statusFilter)}
          aria-label="Filter by date"
          style={{ maxWidth: 170 }}
        />
        <button className="btn btn-secondary" onClick={() => applyFilter('', statusFilter)}>All Days</button>

        {/* Status filter */}
        <select
          className="form-select"
          value={statusFilter}
          onChange={e => applyFilter(selectedDate, e.target.value)}
          aria-label="Filter by status"
          style={{ maxWidth: 140 }}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} records` : `${records.length} records`}
        </span>
      </div>

      {/* Settings panel */}
      {showCfg && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <h3 className="card-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Settings size={16} style={{ color:'var(--primary)' }} /> Attendance Rules (IST)
            </h3>
            <span style={{ fontSize: 11, color:'var(--text-muted)' }}>All times are India Standard Time</span>
          </div>
          <div className="att-cfg-grid">
            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><LogIn size={13} /> Check-in Window</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-checkin-open">Window Opens</label>
                  <input type="time" className="form-input" id="cfg-checkin-open" value={cfg.checkin_open}
                    onChange={e => setCfg(p => ({ ...p, checkin_open: e.target.value }))} />
                  <span className="form-hint">Earliest allowed check-in</span>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-checkin-close">Window Closes (No-show)</label>
                  <input type="time" className="form-input" id="cfg-checkin-close" value={cfg.checkin_close}
                    onChange={e => setCfg(p => ({ ...p, checkin_close: e.target.value }))} />
                  <span className="form-hint">After this → marked Absent + HR notified</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cfg-late-after">Late After</label>
                <input type="time" className="form-input" id="cfg-late-after" value={cfg.late_after}
                  onChange={e => setCfg(p => ({ ...p, late_after: e.target.value }))} />
                <span className="form-hint">Check-in after this time is flagged Late</span>
              </div>
            </div>
            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><Coffee size={13} /> Lunch Break</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-lunch-start">Lunch Start</label>
                  <input type="time" className="form-input" id="cfg-lunch-start" value={cfg.lunch_start}
                    onChange={e => setCfg(p => ({ ...p, lunch_start: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-lunch-end">Lunch End</label>
                  <input type="time" className="form-input" id="cfg-lunch-end" value={cfg.lunch_end}
                    onChange={e => setCfg(p => ({ ...p, lunch_end: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cfg-lunch-duration">Lunch Duration (minutes)</label>
                <input type="number" min="0" max="120" className="form-input" id="cfg-lunch-duration" value={cfg.lunch_duration_min}
                  onChange={e => setCfg(p => ({ ...p, lunch_duration_min: e.target.value }))} />
                <span className="form-hint">Deducted from net working hours</span>
              </div>
            </div>
            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><Sunset size={13} /> Evening / Tea Break</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-evening-start">Evening Break Start</label>
                  <input type="time" className="form-input" id="cfg-evening-start" value={cfg.evening_start}
                    onChange={e => setCfg(p => ({ ...p, evening_start: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-evening-end">Evening Break End</label>
                  <input type="time" className="form-input" id="cfg-evening-end" value={cfg.evening_end}
                    onChange={e => setCfg(p => ({ ...p, evening_end: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cfg-evening-duration">Evening Duration (minutes)</label>
                <input type="number" min="0" max="60" className="form-input" id="cfg-evening-duration" value={cfg.evening_duration_min}
                  onChange={e => setCfg(p => ({ ...p, evening_duration_min: e.target.value }))} />
                <span className="form-hint">Deducted from net working hours</span>
              </div>
            </div>
            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><LogOut size={13} /> Checkout Window</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-checkout-open">Checkout Opens</label>
                  <input type="time" className="form-input" id="cfg-checkout-open" value={cfg.checkout_open}
                    onChange={e => setCfg(p => ({ ...p, checkout_open: e.target.value }))} />
                  <span className="form-hint">Before this → Early Checkout + HR notified</span>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cfg-checkout-close">Checkout Closes</label>
                  <input type="time" className="form-input" id="cfg-checkout-close" value={cfg.checkout_close}
                    onChange={e => setCfg(p => ({ ...p, checkout_close: e.target.value }))} />
                  <span className="form-hint">After this → Overtime</span>
                </div>
              </div>
            </div>
          </div>
          <div className="att-cfg-summary">
            <Clock size={13} />
            <span>
              Check-in: <strong>{cfg.checkin_open} – {cfg.checkin_close}</strong> &nbsp;|&nbsp;
              Late after: <strong>{cfg.late_after}</strong> &nbsp;|&nbsp;
              Lunch: <strong>{cfg.lunch_start} – {cfg.lunch_end} ({cfg.lunch_duration_min}m)</strong> &nbsp;|&nbsp;
              Evening: <strong>{cfg.evening_start} – {cfg.evening_end} ({cfg.evening_duration_min}m)</strong> &nbsp;|&nbsp;
              Checkout: <strong>{cfg.checkout_open} – {cfg.checkout_close}</strong>
            </span>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop: 16, gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowCfg(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveCfg} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Add record form */}
      {showAdd && (
        <form className="card" style={{ marginBottom: 18 }} onSubmit={saveRecord}>
          <div className="card-header">
            <h3 className="card-title">Add / Update Attendance</h3>
            <span style={{ fontSize: 11, color:'var(--text-muted)' }}>One record per employee per date</span>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="record-employee">Employee</label>
              <select className="form-select" id="record-employee" value={form.employee_id}
                onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}>
                <option value="">Select employee</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-date">Date</label>
              <input type="date" className="form-input" id="record-date" value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="record-status">Status</label>
              <select className="form-select" id="record-status" value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-late-minutes">Late Minutes</label>
              <input type="number" min="0" className="form-input" id="record-late-minutes" value={form.late_minutes}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, late_minutes: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="record-checkin">Check In</label>
              <input type="time" className="form-input" id="record-checkin" value={form.check_in}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, check_in: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-checkout">Check Out</label>
              <input type="time" className="form-input" id="record-checkout" value={form.check_out}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, check_out: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Net Hours</label>
              <input className="form-input" placeholder="08:00" value={form.working_hours}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, working_hours: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Daily Task Update</label>
              <textarea className="form-input" rows={3} maxLength={2000}
                placeholder="Employee's daily work update..."
                value={form.daily_task_update}
                onChange={e => setForm(p => ({ ...p, daily_task_update: e.target.value }))} />
              <span className="form-hint">Shown in HR attendance reports for this date.</span>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ display:'flex', alignItems:'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                <Save size={14} /> {saving ? 'Saving...' : 'Save Record'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && records.length === 0 ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : records.length === 0 ? (
          <div className="table-empty"><p>No attendance records.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Date</th>
                  <th>Check In (IST)</th><th>Location</th><th>Device</th><th>Check Out (IST)</th>
                  <th>Net Hours</th><th>Mode</th><th>Late</th><th>Task Update</th><th>Status</th><th>Timer</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td onClick={() => setSelectedEmpId(r.employee_id)} style={{ cursor: 'pointer' }} title="Click to view employee biodata & statistics">
                      <div style={{ fontWeight: 600, color: 'var(--primary)', textDecoration: 'underline' }}>{r.employee_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.employee_code}</div>
                    </td>
                    <td>{r.date}</td>
                    <td>{r.check_in?.slice(0, 5) || '-'}</td>
                    <td>
                      {r.checkin_lat && r.checkin_lng ? (
                        <a href={`https://maps.google.com/?q=${r.checkin_lat},${r.checkin_lng}`} target="_blank" rel="noreferrer">
                          Map{r.checkin_accuracy ? ` (${Math.round(Number(r.checkin_accuracy))}m)` : ''}
                        </a>
                      ) : '-'}
                    </td>
                    <td>{r.checkin_device || '-'}</td>
                    <td>{r.check_out?.slice(0, 5) || '-'}</td>
                    <td>{r.working_hours || '-'}</td>
                    <td>
                      {r.mode === 'wfh' ? (
                        <span className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                          🏠 WFH
                        </span>
                      ) : r.mode === 'office' ? (
                        <span className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.12)', color: 'var(--primary)', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                          🏢 Office
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {r.late_minutes > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                          <span style={{ fontWeight: 600 }}>{r.late_minutes}m total</span>
                          {(r.lunch_late_minutes > 0 || r.evening_late_minutes > 0) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 10, color: 'var(--danger)' }}>
                              {r.lunch_late_minutes > 0 && <span>{r.lunch_late_minutes}m lunch</span>}
                              {r.evening_late_minutes > 0 && <span>{r.evening_late_minutes}m evening</span>}
                            </div>
                          )}
                        </div>
                      ) : '-'}
                    </td>
                    <td style={{ minWidth: 220, maxWidth: 320 }}>
                      {r.daily_task_update
                        ? <div className="task-update-cell" title={r.daily_task_update}>{r.daily_task_update}</div>
                        : '-'}
                    </td>
                    <td>
                      <select
                        className={`form-select status-badge status-${r.status === 'late' ? 'present' : r.status}`}
                        value={r.status === 'late' ? 'present' : r.status}
                        disabled={updatingId === r.id}
                        onChange={e => updateStatus(r, e.target.value)}
                        aria-label="Update record status"
                        style={{ width: 150, textTransform: 'capitalize' }}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      {(r.status === 'present' || r.status === 'late') && r.late_minutes > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, textAlign: 'center', fontWeight: '500' }}>
                          They were late by {r.late_minutes} mins
                        </div>
                      )}
                    </td>
                    <td>
                      {!r.check_in || r.check_out ? (
                        <StatusBadge status="secondary">Inactive</StatusBadge>
                      ) : (
                        <button
                          type="button"
                          className={`btn btn-sm ${r.hr_timer_paused ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => toggleHrPause(r)}
                          disabled={updatingId === r.id}
                          title={r.hr_timer_paused ? 'Resume employee timer' : 'Pause employee timer'}
                        >
                          {r.hr_timer_paused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                          {r.hr_timer_paused ? 'Resume' : 'Pause'}
                        </button>
                      )}
                      {r.hr_timer_paused && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          Paused {r.hr_pause_started_at ? `since ${String(r.hr_pause_started_at).slice(11, 16)}` : ''}
                          {r.hr_pause_reason ? ` (${r.hr_pause_reason})` : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--bg-card)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} records
                </span>
                <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">«</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 13, padding: '0 8px' }}>{page}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
                    <ChevronRight size={14} />
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <PauseResumeModal
        isOpen={!!pauseTarget}
        isPaused={!!pauseTarget?.hr_timer_paused}
        employeeName={pauseTarget?.name || 'Employee'}
        onConfirm={handleConfirmPauseResume}
        onClose={() => setPauseTarget(null)}
        loading={updatingId === pauseTarget?.id}
      />

      {selectedEmpId && (
        <div className="modal-overlay" onClick={() => setSelectedEmpId(null)}>
          <div className="modal employee-details-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, width: '90%', padding: 24, borderRadius: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <h2 className="modal-title" style={{ fontSize: 18, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <User size={20} /> Employee Details & Attendance Summary
              </h2>
              <button type="button" className="btn btn-icon btn-secondary" onClick={() => setSelectedEmpId(null)} aria-label="Close modal" style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {loadingEmpDetails || loadingEmpAttendance ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
                <div className="spinner" />
              </div>
            ) : !employeeData ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                Employee details not found.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
                {/* Column 1: Biodata */}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                    {employeeData.profile_image ? (
                      <img src={employeeData.profile_image} alt={employeeData.name} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }} />
                    ) : (
                      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                        {employeeData.name?.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{employeeData.name}</h3>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{employeeData.employee_code}</div>
                      <span className="status-badge" style={{
                        marginTop: 4,
                        display: 'inline-block',
                        background: employeeData.status === 'active' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        color: employeeData.status === 'active' ? 'var(--success)' : 'var(--danger)',
                        fontSize: 11, padding: '2px 8px'
                      }}>{employeeData.status}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <Mail size={16} style={{ color: 'var(--primary)' }} />
                      <span style={{ wordBreak: 'break-all' }}>{employeeData.email}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <Phone size={16} style={{ color: 'var(--primary)' }} />
                      <span>{employeeData.phone || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <Briefcase size={16} style={{ color: 'var(--primary)' }} />
                      <span>{employeeData.designation || 'N/A'} &middot; {employeeData.department || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <MapPin size={16} style={{ color: 'var(--primary)' }} />
                      <span>Branch: {employeeData.branch || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <Calendar size={16} style={{ color: 'var(--primary)' }} />
                      <span>Joined: {employeeData.joining_date || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <User size={16} style={{ color: 'var(--primary)' }} />
                      <span>Employment Type: <span style={{ textTransform: 'capitalize' }}>{employeeData.employment_type?.replace('_', ' ')}</span></span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Statistics */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Attendance Analytics
                      </h3>
                      <select
                        value={statsRange}
                        onChange={(e) => setStatsRange(e.target.value)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none', cursor: 'pointer' }}
                      >
                        <option value="7">Last 7 Days</option>
                        <option value="30">Last 30 Days (Default)</option>
                        <option value="90">Last 90 Days</option>
                        <option value="all">All Records</option>
                        <option value="custom">Custom Range...</option>
                      </select>
                    </div>
                    
                    {statsRange === 'custom' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>From Date</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>To Date</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>{stats.present}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Days Present</div>
                    </div>
                    <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{stats.absent}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Days Absent</div>
                    </div>
                    <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>{stats.late}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Late Arrivals</div>
                    </div>
                    <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{stats.halfDay}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Half Days</div>
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Total Tracked Days</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{stats.totalDays}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Early Checkouts</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{stats.earlyCheckout}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Work Mode: Office vs WFH</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{stats.officeDays}🏢 / {stats.wfhDays}🏠</strong>
                    </div>

                    {stats.totalDays > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Attendance Rate</span>
                          <strong>{Math.round((stats.present / stats.totalDays) * 100)}%</strong>
                        </div>
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: 'var(--success)', width: `${Math.round((stats.present / stats.totalDays) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </>
  )
}
