import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
import { RefreshCw, Settings, Save, Clock, Coffee, LogIn, LogOut, Sunset, Plus, ChevronLeft, ChevronRight, PauseCircle, PlayCircle, User, Mail, Phone, Briefcase, Calendar, MapPin, X, Pencil, CheckCircle2, XCircle, Clock3, AlertCircle, Laptop } from 'lucide-react'
import { DEFAULT_CFG } from '../../utils/attendanceHelpers'
import { computeTimers } from '../../hooks/useAttendanceTimer'
import PauseResumeModal from '../../components/PauseResumeModal'
import StatusBadge from '../../components/ui/StatusBadge'
import AttendanceSheetView from '../../components/AttendanceSheetView'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import { detectDeviceInfo, formatDeviceLines } from '../../utils/deviceInfo'

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
  checkin_location: '',
  checkin_lat: '',
  checkin_lng: '',
  checkin_device: '',
})

const PER_PAGE = 20

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function hrNetHours(record) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(record || {}, key)
  const hasSessionTimer = record && (
    hasOwn('accumulated_work_seconds') ||
    hasOwn('accumulated_meeting_seconds') ||
    hasOwn('active_activity_type') ||
    hasOwn('clock_in_at')
  )
  if (!hasSessionTimer) return record?.working_hours || record?.net_working_hours || '-'
  return formatSeconds(computeTimers(record).productive)
}

export default function HrAttendance() {
  // Keep open HR pages in sync with the employee's running timer.
  const [, setTimerTick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => setTimerTick(tick => tick + 1), 1000)
    return () => window.clearInterval(interval)
  }, [])

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

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (selectedEmpId) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selectedEmpId])

  const { data: employeeDetailsRes, isFetching: loadingEmpDetails } = useGetEmployeeQuery(selectedEmpId, {
    skip: !selectedEmpId
  })

  const { data: employeeAttendanceRes, isFetching: loadingEmpAttendance } = useGetAttendanceQuery({
    employee_id: selectedEmpId,
    per_page: 200
  }, {
    skip: !selectedEmpId
  })

  const employeeData = useMemo(() => {
    if (!employeeDetailsRes) return null
    const rawData = employeeDetailsRes.data || employeeDetailsRes
    if (Array.isArray(rawData)) {
      return rawData[0] || null
    }
    return rawData
  }, [employeeDetailsRes])
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
  const pollingInterval = useVisibilityPolling(5000)
  const { data: attendanceRes, isFetching: loading, refetch: load } = useGetAttendanceQuery({
    page,
    per_page: PER_PAGE,
    ...(selectedDate ? { date: selectedDate } : {}),
    ...(statusFilter ? { status: statusFilter } : {})
  }, { pollingInterval })

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
    { per_page: 500 },
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

  const editRecord = (record) => {
    setForm({
      employee_id: record.employee_id,
      date: record.date || new Date().toISOString().slice(0, 10),
      status: record.status === 'late' ? 'present' : (record.status || 'present'),
      check_in: record.check_in?.slice(0, 5) || '',
      check_out: record.check_out?.slice(0, 5) || '',
      late_minutes: String(record.late_minutes || 0),
      working_hours: record.working_hours || record.net_working_hours || '',
      daily_task_update: record.daily_task_update || '',
      checkin_location: record.checkin_location || '',
      checkin_lat: record.checkin_lat ?? '',
      checkin_lng: record.checkin_lng ?? '',
      checkin_device: record.checkin_device || '',
    })
    setShowAdd(true)
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
    <div className="hr-attendance-page">
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
          <Plus size={14} /> {showAdd ? 'Hide' : 'Add / Update'} Record
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

            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><MapPin size={13} /> Office Locations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {(cfg.office_locations || []).map((loc, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="form-input" style={{ flex: 1 }} placeholder="Location name"
                      value={loc.name || ''}
                      onChange={e => {
                        const arr = [...(cfg.office_locations || [])]
                        arr[i] = { ...arr[i], name: e.target.value }
                        setCfg(p => ({ ...p, office_locations: arr }))
                      }} />
                    <input className="form-input" style={{ width: 130 }} placeholder="Lat"
                      value={loc.lat ?? ''}
                      onChange={e => {
                        const arr = [...(cfg.office_locations || [])]
                        arr[i] = { ...arr[i], lat: e.target.value }
                        setCfg(p => ({ ...p, office_locations: arr }))
                      }} />
                    <input className="form-input" style={{ width: 130 }} placeholder="Lng"
                      value={loc.lng ?? ''}
                      onChange={e => {
                        const arr = [...(cfg.office_locations || [])]
                        arr[i] = { ...arr[i], lng: e.target.value }
                        setCfg(p => ({ ...p, office_locations: arr }))
                      }} />
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => {
                      const arr = [...(cfg.office_locations || [])]; arr.splice(i, 1)
                      setCfg(p => ({ ...p, office_locations: arr }))
                    }}><X size={12} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setCfg(p => ({ ...p, office_locations: [...(p.office_locations || []), { name: '', lat: '', lng: '' }] }))}>
                  <Plus size={13} /> Add Location
                </button>
                <span className="form-hint">These locations appear in the Add/Update record form for quick selection.</span>
              </div>
            </div>

            <div className="att-cfg-section">
              <div className="att-cfg-section-title"><Laptop size={13} /> Devices</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {(cfg.devices || []).map((dev, i) => {
                  const name = typeof dev === 'object' ? (dev.name || '') : String(dev)
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input className="form-input" style={{ flex: 1 }} placeholder="Device name"
                        value={name}
                        onChange={e => {
                          const arr = [...(cfg.devices || [])]
                          arr[i] = { name: e.target.value }
                          setCfg(p => ({ ...p, devices: arr }))
                        }} />
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => {
                        const arr = [...(cfg.devices || [])]; arr.splice(i, 1)
                        setCfg(p => ({ ...p, devices: arr }))
                      }}><X size={12} /></button>
                    </div>
                  )
                })}
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setCfg(p => ({ ...p, devices: [...(p.devices || []), { name: '' }] }))}>
                  <Plus size={13} /> Add Device
                </button>
                <span className="form-hint">These devices appear in the Add/Update record form.</span>
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
            <div className="form-group">
              <label className="form-label" htmlFor="record-location">Location</label>
              <select className="form-select" id="record-location" value={form.checkin_location}
                onChange={e => {
                  const loc = (cfg.office_locations || []).find(l => l.name === e.target.value)
                  setForm(p => ({
                    ...p,
                    checkin_location: e.target.value,
                    checkin_lat: loc ? String(loc.lat) : p.checkin_lat,
                    checkin_lng: loc ? String(loc.lng) : p.checkin_lng,
                  }))
                }}
                disabled={form.status === 'absent'}>
                <option value="">Select location</option>
                {(cfg.office_locations || []).map(l => (
                  <option key={l.name} value={l.name}>{l.name}</option>
                ))}
              </select>
              <span className="form-hint">Choose an office location saved in Attendance Settings.</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-lat">Latitude</label>
              <input className="form-input" id="record-lat" type="number" step="any" placeholder="12.9265"
                value={form.checkin_lat}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, checkin_lat: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-lng">Longitude</label>
              <input className="form-input" id="record-lng" type="number" step="any" placeholder="77.5508"
                value={form.checkin_lng}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, checkin_lng: e.target.value }))} />
            </div>
          </div>

          {form.checkin_lat && form.checkin_lng && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Location Preview (Google Maps)</label>
              <div style={{ width: '100%', height: 220, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <iframe
                  title="Attendance location preview"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(form.checkin_lat)},${encodeURIComponent(form.checkin_lng)}&z=15&output=embed`}
                  style={{ width: '100%', height: '100%', border: 0 }}
                  loading="lazy"
                />
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="record-device">Device</label>
              <select className="form-select" id="record-device"
                value={(cfg.devices || []).some(d => (typeof d === 'object' ? d.name : d) === form.checkin_device) ? form.checkin_device : '__other'}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, checkin_device: e.target.value === '__other' ? '' : e.target.value }))}>
                <option value="">Select device</option>
                {(cfg.devices || []).map((d, i) => {
                  const name = typeof d === 'object' ? (d.name || '') : String(d)
                  return <option key={i} value={name}>{name}</option>
                })}
                <option value="__other">Other / Custom…</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="record-device-custom">Device Name (custom)</label>
              <input className="form-input" id="record-device-custom" placeholder="e.g. Biometric Scanner, Dell Latitude 5420"
                value={(cfg.devices || []).some(d => (typeof d === 'object' ? d.name : d) === form.checkin_device) ? '' : form.checkin_device}
                disabled={form.status === 'absent'}
                onChange={e => setForm(p => ({ ...p, checkin_device: e.target.value }))} />
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
                  <th>Net Hours</th><th>Overtime</th><th>Mode</th><th>Late</th><th>Task Update</th><th>Status</th><th>Timer</th>
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
                    <td>
                      {(() => {
                        const di = detectDeviceInfo(r.checkin_user_agent || (r.checkin_device === 'Biometric Scanner' ? 'Biometric Scanner' : r.checkin_device))
                        const lines = r.checkin_device === 'Biometric Scanner'
                          ? ['Biometric Scanner']
                          : formatDeviceLines(di)
                        const detail = [
                          `Device: ${di.device}`,
                          `Operating System: ${di.os || 'Unknown'}`,
                          `Browser: ${di.browser || 'Unknown'}`,
                          r.checkin_user_agent ? `User Agent: ${r.checkin_user_agent}` : '',
                          r.checkin_platform && `Platform: ${r.checkin_platform}`,
                          r.checkin_screen && `Screen: ${r.checkin_screen}`,
                          r.checkin_language && `Language: ${r.checkin_language}`,
                          r.checkin_timezone && `Time zone: ${r.checkin_timezone}`,
                          r.checkin_device && `Stored device: ${r.checkin_device}`,
                        ].filter(Boolean).join('\n')
                        return (
                          <div className="attendance-device" title={detail}>
                            {lines.map((ln, i) => (
                              <div key={i}>{ln}</div>
                            ))}
                          </div>
                        )
                      })()}
                    </td>
                    <td>{r.check_out?.slice(0, 5) || '-'}</td>
                    <td>{hrNetHours(r)}</td>
                    <td>
                      {r.overtime_seconds > 0 ? (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                          {r.overtime_hours || (r.overtime_seconds ? new Date(r.overtime_seconds * 1000).toISOString().slice(11, 19) : '-')}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
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
                      <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 6 }} onClick={() => editRecord(r)} title="Edit attendance details">
                        <Pencil size={12} /> Edit
                      </button>
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

      {selectedEmpId && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setSelectedEmpId(null)}>
          <div className="emp-modal-dialog" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="emp-modal-header">
              <div className="emp-modal-header-info">
                <div className="emp-modal-icon-pill">
                  <User size={18} />
                </div>
                <div>
                  <h2 className="emp-modal-title">Employee Profile & Attendance Summary</h2>
                  <p className="emp-modal-subtitle">
                    {employeeData ? `${employeeData.name} (${employeeData.employee_code || 'ID: #' + employeeData.id})` : 'Employee Details'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="emp-modal-close-btn"
                onClick={() => setSelectedEmpId(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="emp-modal-content">
              {loadingEmpDetails || loadingEmpAttendance ? (
                <div className="emp-modal-loading">
                  <div className="spinner" />
                  <span>Loading employee profile & attendance history...</span>
                </div>
              ) : !employeeData ? (
                <div className="emp-modal-empty">
                  <AlertCircle size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                  <div>Employee details not found.</div>
                </div>
              ) : (
                <div className="emp-modal-grid">
                  {/* Left Column: Biodata Card */}
                  <div className="emp-profile-card">
                    <div className="emp-profile-header">
                      {employeeData.profile_image ? (
                        <img
                          src={employeeData.profile_image.startsWith('data:') || employeeData.profile_image.startsWith('http') ? employeeData.profile_image : `/api/${employeeData.profile_image.replace(/^\/+/, '')}`}
                          alt={employeeData.name}
                          className="emp-profile-avatar"
                        />
                      ) : (
                        <div className="emp-profile-avatar-placeholder">
                          {employeeData.name?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="emp-profile-identity">
                        <h3 className="emp-profile-name">{employeeData.name}</h3>
                        <div className="emp-profile-badges">
                          <span className="emp-code-badge">{employeeData.employee_code || `#${employeeData.id}`}</span>
                          <span className={`emp-status-badge status-${employeeData.status}`}>
                            {employeeData.status === 'active' ? '● Active' : '● Inactive'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="emp-profile-divider" />

                    <div className="emp-profile-details">
                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><Mail size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Email Address</span>
                          <span className="emp-detail-value email-text" title={employeeData.email}>{employeeData.email || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><Phone size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Phone</span>
                          <span className="emp-detail-value">{employeeData.phone || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><Briefcase size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Designation & Dept</span>
                          <span className="emp-detail-value">{employeeData.designation || 'N/A'} · {employeeData.department || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><MapPin size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Branch Location</span>
                          <span className="emp-detail-value">{employeeData.branch || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><Calendar size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Joining Date</span>
                          <span className="emp-detail-value">{employeeData.joining_date || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="emp-detail-row">
                        <div className="emp-detail-icon"><User size={15} /></div>
                        <div className="emp-detail-info">
                          <span className="emp-detail-label">Employment Type</span>
                          <span className="emp-detail-value" style={{ textTransform: 'capitalize' }}>
                            {employeeData.employment_type?.replace('_', ' ') || 'Full Time'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Attendance Analytics */}
                  <div className="emp-analytics-card">
                    {/* Header + Range Filter */}
                    <div className="emp-analytics-header">
                      <div>
                        <h3 className="emp-analytics-title">Attendance Analytics</h3>
                        <span className="emp-analytics-subtitle">Summary & performance trends</span>
                      </div>
                      <select
                        value={statsRange}
                        onChange={(e) => setStatsRange(e.target.value)}
                        className="emp-analytics-select"
                      >
                        <option value="7">Last 7 Days</option>
                        <option value="30">Last 30 Days (Default)</option>
                        <option value="90">Last 90 Days</option>
                        <option value="all">All Records</option>
                        <option value="custom">Custom Range...</option>
                      </select>
                    </div>

                    {statsRange === 'custom' && (
                      <div className="emp-custom-dates-bar">
                        <div className="emp-date-field">
                          <label>From Date</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                          />
                        </div>
                        <div className="emp-date-field">
                          <label>To Date</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {/* 4 Primary KPI Cards (2x2 Grid) */}
                    <div className="emp-kpi-grid">
                      {/* Present */}
                      <div className="emp-kpi-box kpi-present">
                        <div className="emp-kpi-icon-wrap">
                          <CheckCircle2 size={20} />
                        </div>
                        <div className="emp-kpi-content">
                          <div className="emp-kpi-number">{stats.present}</div>
                          <div className="emp-kpi-label">Days Present</div>
                        </div>
                      </div>

                      {/* Absent */}
                      <div className="emp-kpi-box kpi-absent">
                        <div className="emp-kpi-icon-wrap">
                          <XCircle size={20} />
                        </div>
                        <div className="emp-kpi-content">
                          <div className="emp-kpi-number">{stats.absent}</div>
                          <div className="emp-kpi-label">Days Absent</div>
                        </div>
                      </div>

                      {/* Late */}
                      <div className="emp-kpi-box kpi-late">
                        <div className="emp-kpi-icon-wrap">
                          <Clock size={20} />
                        </div>
                        <div className="emp-kpi-content">
                          <div className="emp-kpi-number">{stats.late}</div>
                          <div className="emp-kpi-label">Late Arrivals</div>
                        </div>
                      </div>

                      {/* Half Days */}
                      <div className="emp-kpi-box kpi-halfday">
                        <div className="emp-kpi-icon-wrap">
                          <Clock3 size={20} />
                        </div>
                        <div className="emp-kpi-content">
                          <div className="emp-kpi-number">{stats.halfDay}</div>
                          <div className="emp-kpi-label">Half Days</div>
                        </div>
                      </div>
                    </div>

                    {/* Summary Insights Box */}
                    <div className="emp-summary-box">
                      <div className="emp-summary-row">
                        <span className="emp-summary-label">Total Tracked Days</span>
                        <strong className="emp-summary-value">{stats.totalDays}</strong>
                      </div>

                      <div className="emp-summary-row">
                        <span className="emp-summary-label">Early Checkouts</span>
                        <strong className="emp-summary-value">{stats.earlyCheckout}</strong>
                      </div>

                      <div className="emp-summary-row">
                        <span className="emp-summary-label">Work Mode Distribution</span>
                        <div className="emp-mode-pills">
                          <span className="emp-mode-pill mode-office">🏢 {stats.officeDays} Office</span>
                          <span className="emp-mode-pill mode-wfh">🏠 {stats.wfhDays} WFH</span>
                        </div>
                      </div>

                      {stats.totalDays > 0 && (
                        <div className="emp-rate-block">
                          <div className="emp-rate-header">
                            <span className="emp-summary-label">Attendance Reliability Rate</span>
                            <span className="emp-rate-percentage">
                              {Math.round((stats.present / stats.totalDays) * 100)}%
                            </span>
                          </div>
                          <div className="emp-rate-track">
                            <div
                              className="emp-rate-fill"
                              style={{ width: `${Math.min(100, Math.round((stats.present / stats.totalDays) * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
        </>
      )}
    </div>
  )
}
