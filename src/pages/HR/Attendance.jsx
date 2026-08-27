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
import { RefreshCw, Settings, Save, Clock, Coffee, LogIn, LogOut, Sunset, Plus, ChevronLeft, ChevronRight, PauseCircle, PlayCircle, User, Mail, Phone, Briefcase, Calendar, MapPin, X, Pencil, CheckCircle2, XCircle, Clock3, AlertCircle, Laptop, Search, Filter, Sparkles, UserCheck } from 'lucide-react'
import { DEFAULT_CFG } from '../../utils/attendanceHelpers'
import { computeTimers } from '../../hooks/useAttendanceTimer'
import PauseResumeModal from '../../components/PauseResumeModal'
import StatusBadge from '../../components/ui/StatusBadge'
import AttendanceSheetView from '../../components/AttendanceSheetView'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import { detectDeviceInfo, formatDeviceLines } from '../../utils/deviceInfo'

function AttendanceAvatar({ name, image, size = 36 }) {
  if (image) {
    const src = String(image).startsWith('data:') ? image : `/api/${image}`
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size, borderRadius: '10px', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
      />
    )
  }
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hue = ((name || '').charCodeAt(0) || 0) * 19 % 360
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '10px',
        background: `hsl(${hue}, 65%, 52%)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.36,
        fontFamily: 'Outfit, sans-serif',
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      {initials}
    </div>
  )
}

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

function getDeviceLabel(record) {
  if (!record) return '—'
  if (record.checkin_device === 'Biometric Scanner') return 'Biometric Scanner'
  if (record.checkin_device) return record.checkin_device
  if (record.checkin_user_agent) {
    const di = detectDeviceInfo(record.checkin_user_agent)
    const lines = formatDeviceLines(di)
    return lines[0] || 'Web Browser'
  }
  return '—'
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

  const [pauseConfirmRecord, setPauseConfirmRecord] = useState(null)

  // Form & Settings state
  const [showAdd,    setShowAdd]    = useState(false)
  const [showCfg,    setShowCfg]    = useState(false)
  const [cfg,        setCfg]        = useState(DEFAULT_CFG)
  const [form,       setForm]       = useState(blankForm)
  const [saving,     setSaving]     = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [activeView, setActiveView] = useState('records')

  // Search, Filters & Pagination
  const [search,         setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedDate,   setSelectedDate]   = useState(new Date().toISOString().slice(0, 10))
  const [statusFilter,   setStatusFilter]   = useState('')
  const [page,           setPage]           = useState(1)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

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
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {})
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
    // API returns { success, message, data: {...settings} } — unwrap .data
    setCfg({ ...DEFAULT_CFG, ...(remoteSettings.data || remoteSettings) })
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
      {/* Top Header & Search Toolbar */}
      <div className="card" style={{ padding: '16px 20px', borderRadius: '18px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        
        {/* Row 1: Search Box + Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          
          {/* Search Box with instant filtering */}
          <div className="input-icon-wrap" style={{ flex: '1 1 300px', minWidth: 240, position: 'relative' }}>
            <Search size={16} className="input-icon" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input form-input-icon"
              placeholder="Search by employee name, code (#WT...), or department..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ borderRadius: '12px', paddingRight: search ? 32 : 12 }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => load()} title="Refresh attendance records">
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
            <button className={`btn ${showCfg ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleSettings}>
              <Settings size={14} /> {showCfg ? 'Close Settings' : 'Rules & Settings'}
            </button>
            <button className="btn btn-primary" onClick={toggleAdd}>
              <Plus size={15} /> {showAdd ? 'Close Form' : 'Add / Update Record'}
            </button>
          </div>
        </div>

        {/* Row 2: Date Picker + Quick Date Pills + Status Filter + Count */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            
            {/* Date Input with Calendar Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', padding: '5px 12px', borderRadius: '10px', border: '1px solid var(--border)' }}>
              <Calendar size={14} style={{ color: 'var(--primary)' }} />
              <input
                type="date"
                value={selectedDate}
                onChange={e => applyFilter(e.target.value, statusFilter)}
                aria-label="Filter by date"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: '13px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>

            {/* Quick Date Pills */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={`btn btn-sm ${selectedDate === new Date().toISOString().slice(0, 10) ? 'btn-primary' : 'btn-secondary'}`}
                style={{ borderRadius: '8px', fontSize: '11.5px', padding: '4px 10px' }}
                onClick={() => applyFilter(new Date().toISOString().slice(0, 10), statusFilter)}
              >
                Today
              </button>
              <button
                type="button"
                className={`btn btn-sm ${selectedDate === '' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ borderRadius: '8px', fontSize: '11.5px', padding: '4px 10px' }}
                onClick={() => applyFilter('', statusFilter)}
              >
                All Dates
              </button>
            </div>

            {/* Status Filter */}
            <select
              className="form-select"
              value={statusFilter}
              onChange={e => applyFilter(selectedDate, e.target.value)}
              aria-label="Filter by status"
              style={{ maxWidth: 140, borderRadius: '10px', fontSize: '12.5px', padding: '5px 10px' }}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Record Count Badge */}
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '5px 12px', borderRadius: '99px', border: '1px solid var(--border)' }}>
            {pagination ? `${pagination.total} Records` : `${records.length} Records`}
          </div>
        </div>
      </div>

      {/* Settings panel */}
      {showCfg && (
        <div className="card" style={{ marginBottom: 22, borderRadius: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', padding: 0, overflow: 'hidden' }}>
          
          {/* Header */}
          <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.04) 100%)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: '12px', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}>
                <Settings size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>Attendance Rules & Timing Policies</h3>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Configure check-in windows, break policies, and office geofence locations</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '4px 10px', borderRadius: '99px', background: 'rgba(99, 102, 241, 0.12)', color: 'var(--primary)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                IST (UTC+05:30)
              </span>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowCfg(false)} style={{ borderRadius: '10px' }}>
                <X size={14} /> Close
              </button>
            </div>
          </div>

          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* 4 Core Rule Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              
              {/* 1. Check-In Window */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: '#6366f1', marginBottom: 14 }}>
                  <LogIn size={16} /> Check-In Window
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Window Opens</label>
                    <input type="time" className="form-input" value={cfg.checkin_open}
                      onChange={e => setCfg(p => ({ ...p, checkin_open: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Earliest allowed punch-in</span>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Window Closes (No-show)</label>
                    <input type="time" className="form-input" value={cfg.checkin_close}
                      onChange={e => setCfg(p => ({ ...p, checkin_close: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Marked Absent + HR notified</span>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Late Threshold</label>
                    <input type="time" className="form-input" value={cfg.late_after}
                      onChange={e => setCfg(p => ({ ...p, late_after: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Punches after this are marked Late</span>
                  </div>
                </div>
              </div>

              {/* 2. Lunch Break */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: '#f59e0b', marginBottom: 14 }}>
                  <Coffee size={16} /> Lunch Break
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Lunch Start</label>
                      <input type="time" className="form-input" value={cfg.lunch_start}
                        onChange={e => setCfg(p => ({ ...p, lunch_start: e.target.value }))}
                        style={{ borderRadius: '10px' }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Lunch End</label>
                      <input type="time" className="form-input" value={cfg.lunch_end}
                        onChange={e => setCfg(p => ({ ...p, lunch_end: e.target.value }))}
                        style={{ borderRadius: '10px' }} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Lunch Duration (Minutes)</label>
                    <input type="number" min="0" max="120" className="form-input" value={cfg.lunch_duration_min}
                      onChange={e => setCfg(p => ({ ...p, lunch_duration_min: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Deducted from net productive hours</span>
                  </div>
                </div>
              </div>

              {/* 3. Evening / Tea Break */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: '#a855f7', marginBottom: 14 }}>
                  <Sunset size={16} /> Evening / Tea Break
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Break Start</label>
                      <input type="time" className="form-input" value={cfg.evening_start}
                        onChange={e => setCfg(p => ({ ...p, evening_start: e.target.value }))}
                        style={{ borderRadius: '10px' }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Break End</label>
                      <input type="time" className="form-input" value={cfg.evening_end}
                        onChange={e => setCfg(p => ({ ...p, evening_end: e.target.value }))}
                        style={{ borderRadius: '10px' }} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Break Duration (Minutes)</label>
                    <input type="number" min="0" max="60" className="form-input" value={cfg.evening_duration_min}
                      onChange={e => setCfg(p => ({ ...p, evening_duration_min: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Deducted from net productive hours</span>
                  </div>
                </div>
              </div>

              {/* 4. Checkout Window */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: '#10b981', marginBottom: 14 }}>
                  <LogOut size={16} /> Checkout Window
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Checkout Opens</label>
                    <input type="time" className="form-input" value={cfg.checkout_open}
                      onChange={e => setCfg(p => ({ ...p, checkout_open: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Punches before this = Early Checkout</span>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Checkout Closes</label>
                    <input type="time" className="form-input" value={cfg.checkout_close}
                      onChange={e => setCfg(p => ({ ...p, checkout_close: e.target.value }))}
                      style={{ borderRadius: '10px' }} />
                    <span className="form-hint" style={{ fontSize: '11px' }}>Punches after this = Overtime</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Office Locations & Devices in a 2-Col layout */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
              
              {/* Office Locations */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: 'var(--text)' }}>
                    <MapPin size={16} style={{ color: 'var(--primary)' }} /> Office Locations (Geofencing)
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ borderRadius: '8px', fontSize: '11.5px', padding: '4px 8px' }}
                    onClick={() => setCfg(p => ({ ...p, office_locations: [...(p.office_locations || []), { name: '', lat: '', lng: '' }] }))}
                  >
                    <Plus size={13} /> Add Location
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(cfg.office_locations || []).map((loc, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                      <input className="form-input" style={{ flex: 2, padding: '6px 10px', fontSize: '12.5px', borderRadius: '8px' }} placeholder="Office Name (e.g. HQ Bangalore)"
                        value={loc.name || ''}
                        onChange={e => {
                          const arr = [...(cfg.office_locations || [])]
                          arr[i] = { ...arr[i], name: e.target.value }
                          setCfg(p => ({ ...p, office_locations: arr }))
                        }} />
                      <input className="form-input" style={{ flex: 1, padding: '6px 10px', fontSize: '12px', borderRadius: '8px' }} placeholder="Lat"
                        value={loc.lat ?? ''}
                        onChange={e => {
                          const arr = [...(cfg.office_locations || [])]
                          arr[i] = { ...arr[i], lat: e.target.value }
                          setCfg(p => ({ ...p, office_locations: arr }))
                        }} />
                      <input className="form-input" style={{ flex: 1, padding: '6px 10px', fontSize: '12px', borderRadius: '8px' }} placeholder="Lng"
                        value={loc.lng ?? ''}
                        onChange={e => {
                          const arr = [...(cfg.office_locations || [])]
                          arr[i] = { ...arr[i], lng: e.target.value }
                          setCfg(p => ({ ...p, office_locations: arr }))
                        }} />
                      <button type="button" className="btn btn-sm btn-danger" style={{ padding: '6px 8px', borderRadius: '8px' }} onClick={() => {
                        const arr = [...(cfg.office_locations || [])]; arr.splice(i, 1)
                        setCfg(p => ({ ...p, office_locations: arr }))
                      }}><X size={13} /></button>
                    </div>
                  ))}
                  {(!cfg.office_locations || cfg.office_locations.length === 0) && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No office locations configured.</div>
                  )}
                </div>
              </div>

              {/* Devices */}
              <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '13.5px', color: 'var(--text)' }}>
                    <Laptop size={16} style={{ color: 'var(--primary)' }} /> Authorized Devices & Hardware
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ borderRadius: '8px', fontSize: '11.5px', padding: '4px 8px' }}
                    onClick={() => setCfg(p => ({ ...p, devices: [...(p.devices || []), { name: '' }] }))}
                  >
                    <Plus size={13} /> Add Device
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(cfg.devices || []).map((dev, i) => {
                    const name = typeof dev === 'object' ? (dev.name || '') : String(dev)
                    return (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                        <input className="form-input" style={{ flex: 1, padding: '6px 10px', fontSize: '12.5px', borderRadius: '8px' }} placeholder="Device Name (e.g. Biometric Scanner, Office Tablet)"
                          value={name}
                          onChange={e => {
                            const arr = [...(cfg.devices || [])]
                            arr[i] = { name: e.target.value }
                            setCfg(p => ({ ...p, devices: arr }))
                          }} />
                        <button type="button" className="btn btn-sm btn-danger" style={{ padding: '6px 8px', borderRadius: '8px' }} onClick={() => {
                          const arr = [...(cfg.devices || [])]; arr.splice(i, 1)
                          setCfg(p => ({ ...p, devices: arr }))
                        }}><X size={13} /></button>
                      </div>
                    )
                  })}
                  {(!cfg.devices || cfg.devices.length === 0) && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No specific devices configured.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Rule Policy Summary Bar */}
            <div style={{ background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.12))', padding: '12px 18px', borderRadius: '12px', border: '1px solid rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: '12px', color: 'var(--text)' }}>
              <Clock size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span>
                <strong>Shift Timing:</strong> {cfg.checkin_open} – {cfg.checkout_close} &nbsp;•&nbsp;
                <strong>Late After:</strong> {cfg.late_after} &nbsp;•&nbsp;
                <strong>Lunch:</strong> {cfg.lunch_start} – {cfg.lunch_end} ({cfg.lunch_duration_min}m) &nbsp;•&nbsp;
                <strong>Evening Break:</strong> {cfg.evening_start} – {cfg.evening_end} ({cfg.evening_duration_min}m)
              </span>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCfg(false)} style={{ borderRadius: '10px' }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveCfg} disabled={saving} style={{ borderRadius: '10px', padding: '9px 20px', fontWeight: 700 }}>
                <Save size={15} /> {saving ? 'Saving Settings...' : 'Save Timing Policy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Update Attendance Form */}
      {showAdd && (
        <form className="card" style={{ marginBottom: 22, borderRadius: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', padding: 0, overflow: 'hidden' }} onSubmit={saveRecord}>
          
          {/* Header */}
          <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: '12px', background: '#3b82f6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)' }}>
                <Plus size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>Manual Attendance Entry</h3>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Log or modify shift hours, punch times, and work updates for any employee</p>
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowAdd(false)} style={{ borderRadius: '10px' }}>
              <X size={14} /> Close Form
            </button>
          </div>

          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Section 1: Employee, Date, Status, Late Minutes */}
            <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <User size={15} style={{ color: 'var(--primary)' }} /> Employee & Status Details
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                
                {/* Employee Select */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-employee" style={{ fontSize: '12px', fontWeight: 700 }}>Employee <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select className="form-select" id="record-employee" value={form.employee_id}
                    onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
                    style={{ borderRadius: '10px' }} required>
                    <option value="">Select an employee...</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employee_code ? `#${emp.employee_code}` : ''}) {emp.department ? `· ${emp.department}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-date" style={{ fontSize: '12px', fontWeight: 700 }}>Attendance Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" className="form-input" id="record-date" value={form.date}
                    onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    style={{ borderRadius: '10px' }} required />
                </div>

                {/* Status */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-status" style={{ fontSize: '12px', fontWeight: 700 }}>Attendance Status <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select className="form-select" id="record-status" value={form.status}
                    onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    style={{ borderRadius: '10px' }}>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                {/* Late Minutes */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-late-minutes" style={{ fontSize: '12px', fontWeight: 700 }}>Late Arrival (Mins)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" min="0" className="form-input" id="record-late-minutes" value={form.late_minutes}
                      disabled={form.status === 'absent'}
                      onChange={e => setForm(p => ({ ...p, late_minutes: e.target.value }))}
                      style={{ borderRadius: '10px', flex: 1 }} />
                    <button type="button" className="btn btn-secondary btn-sm" style={{ borderRadius: '8px', fontSize: '11px', padding: '0 8px' }}
                      disabled={form.status === 'absent'}
                      onClick={() => setForm(p => ({ ...p, late_minutes: String((Number(p.late_minutes) || 0) + 15) }))}>
                      +15m
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ borderRadius: '8px', fontSize: '11px', padding: '0 8px' }}
                      disabled={form.status === 'absent'}
                      onClick={() => setForm(p => ({ ...p, late_minutes: '0' }))}>
                      0m
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Shift Timings & Work Updates */}
            <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={15} style={{ color: '#10b981' }} /> Timings & Work Update
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-checkin" style={{ fontSize: '12px', fontWeight: 700 }}>Check-In Time</label>
                  <input type="time" className="form-input" id="record-checkin" value={form.check_in}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, check_in: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-checkout" style={{ fontSize: '12px', fontWeight: 700 }}>Check-Out Time</label>
                  <input type="time" className="form-input" id="record-checkout" value={form.check_out}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, check_out: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Net Working Hours</label>
                  <input className="form-input" placeholder="e.g. 08:30:00" value={form.working_hours}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, working_hours: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>
              </div>

              {/* Daily Task Update */}
              <div className="form-group" style={{ marginTop: 14, marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px', fontWeight: 700 }}>Daily Standup / Work Summary</label>
                <textarea className="form-input" rows={2} maxLength={2000}
                  placeholder="Summary of accomplishments or tasks completed during this shift..."
                  value={form.daily_task_update}
                  onChange={e => setForm(p => ({ ...p, daily_task_update: e.target.value }))}
                  style={{ borderRadius: '10px' }} />
              </div>
            </div>

            {/* Section 3: Geolocation & Device Verification */}
            <div style={{ background: 'var(--surface-2)', padding: '18px', borderRadius: '16px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={15} style={{ color: '#06b6d4' }} /> Location & Device Verification
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                
                {/* Location Select */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-location" style={{ fontSize: '12px', fontWeight: 700 }}>Saved Office Location</label>
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
                    disabled={form.status === 'absent'}
                    style={{ borderRadius: '10px' }}>
                    <option value="">Select location...</option>
                    {(cfg.office_locations || []).map(l => (
                      <option key={l.name} value={l.name}>{l.name}</option>
                    ))}
                  </select>
                </div>

                {/* Latitude */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-lat" style={{ fontSize: '12px', fontWeight: 700 }}>Latitude</label>
                  <input className="form-input" id="record-lat" type="number" step="any" placeholder="12.9265"
                    value={form.checkin_lat}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, checkin_lat: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>

                {/* Longitude */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-lng" style={{ fontSize: '12px', fontWeight: 700 }}>Longitude</label>
                  <input className="form-input" id="record-lng" type="number" step="any" placeholder="77.5508"
                    value={form.checkin_lng}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, checkin_lng: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>

                {/* Device */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="record-device" style={{ fontSize: '12px', fontWeight: 700 }}>Device Profile</label>
                  <select className="form-select" id="record-device"
                    value={(cfg.devices || []).some(d => (typeof d === 'object' ? d.name : d) === form.checkin_device) ? form.checkin_device : '__other'}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, checkin_device: e.target.value === '__other' ? '' : e.target.value }))}
                    style={{ borderRadius: '10px' }}>
                    <option value="">Select device...</option>
                    {(cfg.devices || []).map((d, i) => {
                      const name = typeof d === 'object' ? (d.name || '') : String(d)
                      return <option key={i} value={name}>{name}</option>
                    })}
                    <option value="__other">Other / Custom…</option>
                  </select>
                </div>
              </div>

              {/* Custom Device field if needed */}
              {form.checkin_device && !(cfg.devices || []).some(d => (typeof d === 'object' ? d.name : d) === form.checkin_device) && (
                <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
                  <label className="form-label" htmlFor="record-device-custom" style={{ fontSize: '12px', fontWeight: 700 }}>Custom Device Name</label>
                  <input className="form-input" id="record-device-custom" placeholder="e.g. Biometric Scanner, Dell Latitude 5420"
                    value={form.checkin_device}
                    disabled={form.status === 'absent'}
                    onChange={e => setForm(p => ({ ...p, checkin_device: e.target.value }))}
                    style={{ borderRadius: '10px' }} />
                </div>
              )}

              {/* Location Google Maps Live Preview */}
              {form.checkin_lat && form.checkin_lng && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ width: '100%', height: 180, borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <iframe
                      title="Attendance location preview"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(form.checkin_lat)},${encodeURIComponent(form.checkin_lng)}&z=15&output=embed`}
                      style={{ width: '100%', height: '100%', border: 0 }}
                      loading="lazy"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Form Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)} style={{ borderRadius: '10px' }}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} style={{ borderRadius: '10px', padding: '9px 22px', fontWeight: 700 }}>
                <Save size={15} /> {saving ? 'Saving Record...' : 'Save Attendance Record'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Redesigned Attendance Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '18px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        {loading && records.length === 0 ? (
          <div className="loading-container" style={{ padding: '60px 0' }}><div className="spinner" /></div>
        ) : records.length === 0 ? (
          <div className="table-empty" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>No attendance records found matching your filters.</p>
          </div>
        ) : (
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Employee</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Date</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Timings (IST)</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Net Hours</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Mode</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Location & Device</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Status</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Daily Task</th>
                  <th style={{ padding: '13px 16px', textAlign: 'right', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const isCheckedIn = !!r.check_in && !r.check_out
                  const isPaused = !!r.hr_timer_paused
                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Employee with Avatar & Code */}
                      <td style={{ padding: '12px 16px' }}>
                        <div
                          onClick={() => setSelectedEmpId(r.employee_id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                          title="Click to view employee profile & stats"
                        >
                          <AttendanceAvatar name={r.employee_name} image={r.profile_image} size={36} />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: 'var(--primary)', textDecoration: 'none' }}>{r.employee_name}</span>
                              {r.employee_code && (
                                <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '6px', background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                                  #{r.employee_code}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: 2 }}>
                              {r.designation ? `${r.designation} · ` : ''}{r.department || 'Team Member'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                        {r.date}
                      </td>

                      {/* Timings (In / Out) */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', fontWeight: 700, color: '#10b981' }}>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>IN:</span>
                            {r.check_in ? String(r.check_in).slice(0, 5) : '—'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>OUT:</span>
                            {r.check_out ? String(r.check_out).slice(0, 5) : (isCheckedIn ? <span style={{ color: '#3b82f6', fontSize: '11px', fontWeight: 700 }}>Active</span> : '—')}
                          </div>
                        </div>
                      </td>

                      {/* Net Hours & Live Timer */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isCheckedIn && (
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                          )}
                          <b style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                            {hrNetHours(r)}
                          </b>
                        </div>
                        {r.late_minutes > 0 && (
                          <span style={{ display: 'inline-block', marginTop: 3, fontSize: '10.5px', fontWeight: 700, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)', padding: '1px 6px', borderRadius: 4 }}>
                            {r.late_minutes}m late
                          </span>
                        )}
                        {r.overtime_seconds > 0 && (
                          <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#10b981', marginTop: 2 }}>
                            +{r.overtime_hours || formatSeconds(r.overtime_seconds)} OT
                          </div>
                        )}
                      </td>

                      {/* Work Mode */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        {r.mode === 'wfh' || r.work_mode === 'wfh' ? (
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            🏠 WFH
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            🏢 Office
                          </span>
                        )}
                      </td>

                      {/* Location & Device */}
                      <td style={{ padding: '12px 16px', fontSize: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {r.checkin_lat && r.checkin_lng ? (
                            <a
                              href={`https://maps.google.com/?q=${r.checkin_lat},${r.checkin_lng}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                            >
                              <MapPin size={12} />
                              <span>{r.checkin_location || 'Map'}{r.checkin_accuracy ? ` (${Math.round(Number(r.checkin_accuracy))}m)` : ''}</span>
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>{r.checkin_location || '—'}</span>
                          )}
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Laptop size={11} />
                            <span>{getDeviceLabel(r)}</span>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <select
                          className={`form-select status-badge status-${r.status === 'late' ? 'present' : r.status}`}
                          value={r.status === 'late' ? 'present' : r.status}
                          disabled={updatingId === r.id}
                          onChange={e => updateStatus(r, e.target.value)}
                          aria-label="Update record status"
                          style={{ width: 130, padding: '4px 8px', fontSize: '11.5px', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>

                      {/* Daily Task Update */}
                      <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                        {r.daily_task_update ? (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 200,
                              background: 'var(--surface-2)',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--border)',
                            }}
                            title={r.daily_task_update}
                          >
                            {r.daily_task_update}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {isCheckedIn && (
                            <button
                              type="button"
                              className={`btn btn-sm ${isPaused ? 'btn-success' : 'btn-secondary'}`}
                              style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '8px' }}
                              onClick={() => toggleHrPause(r)}
                              disabled={updatingId === r.id}
                              title={isPaused ? 'Resume timer' : 'Pause timer'}
                            >
                              {isPaused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                              <span>{isPaused ? 'Resume' : 'Pause'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '5px 10px', fontSize: '11px', borderRadius: '8px' }}
                            onClick={() => editRecord(r)}
                            title="Edit attendance details"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
