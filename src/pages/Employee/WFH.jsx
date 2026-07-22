import { useState, useEffect, useRef, useCallback } from 'react'
import { Eye, X, Calendar, FileText, CheckCircle, ChevronLeft, ChevronRight, RefreshCw, Clock, AlertTriangle, Moon } from 'lucide-react'
import { useGetWFHRequestsQuery, useCreateWFHRequestMutation, useGetWFHMyStatusTodayQuery, useSubmitWFHStatusMutation, usePauseResumeTimerMutation, useRequestSleepModeMutation, useGetAttendanceStatusTodayQuery } from '../../store/apiSlice'
import { useToast } from '../../App'
import WFHAttendancePanel from '../../components/WFHAttendancePanel'
import { nowIST } from '../../utils/attendanceHelpers'

const PER_PAGE = 15
const IDLE_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes
const SYSTEM_SLEEP_THRESHOLD_MS = 5000

const daysDiff = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1)

const fmtTimer = (secs) => {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const isExemptTime = () => {
  const d = nowIST()
  const h = d.getHours()
  const m = d.getMinutes()
  const mins = h * 60 + m
  const lunchStart = 13 * 60 + 30 // 1:30 PM (810 mins)
  const lunchEnd = 14 * 60 + 30   // 2:30 PM (870 mins)
  const teaStart = 16 * 60 + 30   // 4:30 PM (990 mins)
  const teaEnd = 17 * 60          // 5:00 PM (1020 mins)
  return (mins >= lunchStart && mins < lunchEnd) || (mins >= teaStart && mins < teaEnd)
}

export default function EmpWFH() {
  const [showForm,      setShowForm]      = useState(false)
  const [viewWFH,       setViewWFH]       = useState(null)
  const [form,          setForm]          = useState({ start_date: '', end_date: '', reason: '' })
  const [page,          setPage]          = useState(1)
  const [pulseStatus,   setPulseStatus]   = useState('active')
  const [pulseText,     setPulseText]     = useState('')
  const [activeSeconds, setActiveSeconds] = useState(0)
  const [isIdle,        setIsIdle]        = useState(false)
  const [pauseType,     setPauseType]     = useState('')
  const [pauseReason,   setPauseReason]   = useState('')
  const [showSleepModal, setShowSleepModal] = useState(false)
  const [sleepReason,   setSleepReason]   = useState('')
  const { toast } = useToast()

  const idleTimerRef = useRef(null)
  const idleSentRef = useRef(false)
  const sleepSentRef = useRef(false)
  const lastTickRef = useRef(Date.now())
  const activeSecondsInitializedRef = useRef(false)

  // ----- RTK Query Hooks -----
  const { data: wfhRes, isLoading: loading, refetch: load } = useGetWFHRequestsQuery({
    page,
    per_page: PER_PAGE
  })
  const [createWFHRequest, { isLoading: submitting }] = useCreateWFHRequestMutation()
  const [pauseResumeTimer] = usePauseResumeTimerMutation()

  const d = wfhRes?.data
  const requests = d?.wfh_requests || d || []
  const pagination = d?.pagination || null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const hasActiveWFHToday = requests.some(r => {
    if (r.status !== 'approved') return false
    const start = new Date(r.start_date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(r.end_date)
    end.setHours(0, 0, 0, 0)
    return today >= start && today <= end
  })

  const { data: statusRes, refetch: refetchStatus } = useGetWFHMyStatusTodayQuery(undefined, {
    skip: !hasActiveWFHToday
  })
  const { data: attendanceRes, refetch: refetchAttendance } = useGetAttendanceStatusTodayQuery(undefined, {
    skip: !hasActiveWFHToday
  })
  const [submitWFHStatus, { isLoading: updatingStatus }] = useSubmitWFHStatusMutation()
  const [requestSleepMode, { isLoading: requestingSleep }] = useRequestSleepModeMutation()

  const attendanceToday = attendanceRes?.data
  const timelineToday = statusRes?.data?.timeline || []

  // --- Silent auto-status submit (no toast, fire-and-forget) ---
  const silentSubmitStatus = useCallback(async (status, customStatus) => {
    try {
      await submitWFHStatus({ status, custom_status: customStatus }).unwrap()
      refetchStatus()
    } catch { /* silent */ }
  }, [submitWFHStatus, refetchStatus])

  const triggerAutoPause = useCallback(async (type, reasonText) => {
    if (isExemptTime()) return // Ignore during lunch or tea break
    try {
      await pauseResumeTimer({ action: 'auto_pause_timer', body: {} }).unwrap()
      window.dispatchEvent(new Event('attendance-changed'))
      setPauseType(type)
      setPauseReason(reasonText)
      silentSubmitStatus('away', `⚠️ Timer Auto-Paused: ${reasonText}`)
      toast('Your timer was automatically paused due to inactivity.', 'error')
    } catch (e) {
      console.error('Auto pause failed', e)
    }
  }, [pauseResumeTimer, silentSubmitStatus, toast])

  // ====== ACTIVE TIMER ======
  useEffect(() => {
    if (!hasActiveWFHToday || !activeSecondsInitializedRef.current) return
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTickRef.current
      lastTickRef.current = now

      const systemSleepDetected = elapsed > SYSTEM_SLEEP_THRESHOLD_MS
      if (pulseStatus === 'active' && !isIdle) {
        if (systemSleepDetected) {
          idleSentRef.current = true
          setIsIdle(true)
          setPulseStatus('away')
          triggerAutoPause('System sleep/lock or browser inactivity detected')
          return
        }
        setActiveSeconds(prev => prev + 1)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [hasActiveWFHToday, activeSecondsInitializedRef.current, pulseStatus, isIdle, triggerAutoPause])

  useEffect(() => {
    if (!hasActiveWFHToday || !attendanceToday) return
    const persistedSeconds = Number(attendanceToday.worked_seconds ?? 0)
    if (Number.isNaN(persistedSeconds)) return

    if (!activeSecondsInitializedRef.current) {
      setActiveSeconds(persistedSeconds)
      activeSecondsInitializedRef.current = true
      return
    }

    if (persistedSeconds > activeSeconds) {
      setActiveSeconds(persistedSeconds)
    }
  }, [attendanceToday, hasActiveWFHToday, activeSeconds])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hasActiveWFHToday) {
        refetchAttendance()
        if (hasActiveWFHToday) refetchStatus()
      }
    }
    window.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)
    return () => {
      window.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [hasActiveWFHToday, refetchAttendance, refetchStatus])

  // ====== IDLE DETECTION (10 MINUTES) ======
  useEffect(() => {
    if (!hasActiveWFHToday) return

    const resetIdle = () => {
      if (idleSentRef.current) {
        idleSentRef.current = false
        setIsIdle(false)
        setPauseType('')
        setPauseReason('')
        setPulseStatus('active')
        if (isExemptTime()) {
          silentSubmitStatus('active', '✅ Active — Returned from idle')
        }
      }

      // Clear and restart the idle timer
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (!idleSentRef.current) {
          idleSentRef.current = true
          setIsIdle(true)
          setPulseStatus('away')
          if (!isExemptTime()) {
            triggerAutoPause('Idle (No activity for 10 minutes)')
          } else {
            silentSubmitStatus('away', '⚠️ Away — Idle (Exempt time: Lunch/Tea break)')
          }
        }
      }, IDLE_TIMEOUT_MS)
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }))
    resetIdle()

    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetIdle))
      clearTimeout(idleTimerRef.current)
    }
  }, [hasActiveWFHToday, silentSubmitStatus, triggerAutoPause])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.start_date || !form.end_date || !form.reason) {
      toast('Fill all fields.', 'error')
      return
    }
    if (new Date(form.start_date) > new Date(form.end_date)) {
      toast('Start date cannot be after end date.', 'error')
      return
    }
    try {
      const res = await createWFHRequest(form).unwrap()
      toast(res.message || 'Work from home request submitted.', 'success')
      setShowForm(false)
      setForm({ start_date: '', end_date: '', reason: '' })
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to submit.', 'error')
    }
  }


  const handleUpdateStatus = async (e) => {
    e.preventDefault()
    if (!pulseText.trim()) {
      toast('Please enter what you are working on.', 'error')
      return
    }
    try {
      await submitWFHStatus({ status: pulseStatus, custom_status: pulseText.trim() }).unwrap()
      toast('Pulse status updated.', 'success')
      setPulseText('')
      setIsIdle(false)
      setPauseType('')
      setPauseReason('')
      idleSentRef.current = false
      sleepSentRef.current = false
      lastTickRef.current = Date.now()
      refetchStatus()
    } catch (err) {
      toast(err.data?.message || 'Failed to update status.', 'error')
    }
  }

  const handleRequestSleep = async (e) => {
    e.preventDefault()
    if (!sleepReason.trim()) {
      toast('Please provide a reason for sleep mode.', 'error')
      return
    }
    try {
      await requestSleepMode({ reason: sleepReason.trim() }).unwrap()
      toast('Sleep mode requested. HR will review your request.', 'success')
      setShowSleepModal(false)
      setSleepReason('')
    } catch (err) {
      toast(err.data?.message || 'Failed to request sleep mode.', 'error')
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  // Determine the timer display color based on status
  const timerColor = pulseStatus === 'active' && !isIdle
    ? 'var(--success)'
    : pulseStatus === 'away' || isIdle
      ? 'var(--danger)'
      : 'var(--warning)'

  return (
    <>
      <style>{`
        @keyframes pulse-dot {
          0% { transform: scale(0.95); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.6; }
        }
        @keyframes timer-glow {
          0% { text-shadow: 0 0 8px currentColor; }
          50% { text-shadow: 0 0 16px currentColor, 0 0 32px currentColor; }
          100% { text-shadow: 0 0 8px currentColor; }
        }
      `}</style>

      <div className="search-bar">
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Request Work From Home</button>
        <button className="btn btn-secondary" onClick={() => { load(); if (hasActiveWFHToday) refetchStatus() }}><RefreshCw size={14} /> Refresh</button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} requests` : `${requests.length} requests`}
        </span>
      </div>

      {hasActiveWFHToday && (
        <>
          <WFHAttendancePanel />

          {/* ─── Active Timer Card ─── */}
          <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(135deg, var(--bg-card), var(--surface-2))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Clock size={22} style={{ color: timerColor }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Active Work Time Today</div>
                <div style={{
                  fontSize: 32, fontWeight: 800, fontFamily: 'Outfit, monospace',
                  color: timerColor,
                  animation: pulseStatus === 'active' && !isIdle ? 'timer-glow 2.5s infinite ease-in-out' : 'none',
                  letterSpacing: '0.04em'
                }}>
                  {fmtTimer(activeSeconds)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {pauseType && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--danger-soft)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--danger)', minWidth: 220 }}>
                  <AlertTriangle size={14} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>
                      Timer paused — {pauseType === 'sleep' ? 'Sleep/lock detected' : 'Idle detected'}
                    </span>
                    {pauseReason && (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pauseReason}</span>
                    )}
                  </div>
                </div>
              )}
              {pulseStatus === 'meeting' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--warning-soft)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>
                  <Clock size={14} /> Timer paused — In meeting
                </div>
              )}
              {pulseStatus === 'break' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--info-soft)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--info)' }}>
                  <Clock size={14} /> Timer paused — On break
                </div>
              )}
              {pulseStatus === 'active' && !isIdle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--success-soft)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'pulse-dot 1.8s infinite ease-in-out' }} />
                  Timer running
                </div>
              )}
            </div>
          </div>

          {/* ─── Live Pulse Check-in ─── */}
          <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, var(--bg-card), var(--surface-2))', borderColor: 'var(--primary-soft)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: isIdle ? 'var(--danger)' : 'var(--success)', borderRadius: '50%', boxShadow: isIdle ? '0 0 8px var(--danger)' : '0 0 8px var(--success)', animation: 'pulse-dot 1.8s infinite ease-in-out' }} />
              WFH Live Pulse Check-in
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {/* Status updates input */}
              <form onSubmit={handleUpdateStatus} style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Current Status</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { value: 'active', label: 'Active', color: 'var(--success)' },
                      { value: 'meeting', label: 'In Meeting', color: 'var(--warning)' },
                      { value: 'break', label: 'On Break', color: 'var(--text-muted)' }
                    ].map(item => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => { setPulseStatus(item.value); setIsIdle(false); idleSentRef.current = false }}
                        className="btn"
                        style={{
                          flex: 1,
                          background: pulseStatus === item.value ? item.color : 'var(--bg-input)',
                          color: pulseStatus === item.value ? '#fff' : 'var(--text-primary)',
                          borderColor: pulseStatus === item.value ? item.color : 'var(--border)',
                          textTransform: 'capitalize',
                          transition: 'all 0.2s ease',
                          fontSize: 13,
                          padding: '6px 12px'
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="pulse-custom" style={{ marginBottom: 6 }}>What are you working on right now?</label>
                  <input
                    type="text"
                    className="form-input"
                    id="pulse-custom"
                    value={pulseText}
                    onChange={e => setPulseText(e.target.value)}
                    placeholder="e.g. Designing dashboards, fixing client bugs"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button type="submit" className="btn btn-primary animate-fade-in" disabled={updatingStatus}>
                    {updatingStatus ? 'Updating Pulse...' : 'Send Pulse Update'}
                  </button>
                </div>
              </form>

              {/* Today's status history */}
              <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
                <h4 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10 }}>Today's Timeline</h4>
                <div style={{ flex: 1, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
                  {timelineToday.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', padding: '10px 0' }}>
                      No pulse updates sent today. Let HR know you are online!
                    </div>
                  ) : (
                    timelineToday.map(log => (
                      <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: log.status === 'away' ? 'var(--danger-soft)' : 'var(--bg-input)', borderRadius: 8, fontSize: 13, borderLeft: log.status === 'away' ? '3px solid var(--danger)' : '3px solid transparent' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12 }}>{log.created_at}</span>
                        {log.status === 'away' && <AlertTriangle size={12} style={{ color: 'var(--danger)', flexShrink: 0 }} />}
                        <span className={`status-badge status-${log.status}`} style={{ textTransform: 'capitalize', padding: '2px 6px', fontSize: 11 }}>
                          {log.status}
                        </span>
                        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={log.custom_status}>
                          {log.custom_status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : requests.length === 0 ? (
          <div className="table-empty"><div className="empty-icon">-</div><p>No WFH requests found.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td>{r.start_date}</td>
                    <td>{r.end_date}</td>
                    <td>{daysDiff(r.start_date, r.end_date)}</td>
                    <td><span className="leave-reason-preview">{r.reason}</span></td>
                    <td><span className={`status-badge status-${r.status}`}>{r.status}</span></td>
                    <td>
                      <button className="btn btn-icon btn-secondary leave-view-btn" title="View details" aria-label="View details" onClick={() => setViewWFH(r)}>
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--bg-card)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} requests
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

      {/* Details modal */}
      {viewWFH && (
        <div className="modal-overlay" onClick={() => setViewWFH(null)}>
          <div className="modal leave-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FileText size={18} style={{ color:'var(--primary)' }} /> WFH Request Details
              </h2>
              <button className="modal-close" onClick={() => setViewWFH(null)} aria-label="Close details"><X size={16} /></button>
            </div>
            <div className="leave-detail-body">
              <div className="leave-detail-grid">
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><Calendar size={13} /> Duration</span>
                  <span className="leave-detail-value">
                    {viewWFH.start_date} → {viewWFH.end_date}
                    <em style={{ marginLeft:6, color:'var(--text-secondary)', fontSize:12 }}>
                      ({daysDiff(viewWFH.start_date, viewWFH.end_date)} day{daysDiff(viewWFH.start_date, viewWFH.end_date) !== 1 ? 's' : ''})
                    </em>
                  </span>
                </div>
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><CheckCircle size={13} /> Status</span>
                  <span className={`status-badge status-${viewWFH.status}`}>{viewWFH.status}</span>
                </div>
              </div>
              <div className="leave-detail-reason">
                <span className="leave-detail-label"><FileText size={13} /> Reason</span>
                <p className="leave-detail-reason-text">{viewWFH.reason}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setViewWFH(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Apply form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => !submitting && setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Apply for Work From Home</h2>
              <button className="modal-close" onClick={() => !submitting && setShowForm(false)} aria-label="Close form"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="start-date">Start Date</label>
                  <input type="date" className="form-input" id="start-date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="end-date">End Date</label>
                  <input type="date" className="form-input" id="end-date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wfh-reason">Reason</label>
                <textarea
                  className="form-textarea"
                  id="wfh-reason"
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  placeholder="Explain why you need to work from home..."
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Sleep Mode Modal */}
      {showSleepModal && (
        <div className="modal-overlay" onClick={() => !requestingSleep && setShowSleepModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Moon size={18} style={{ color: 'var(--warning)' }} /> Request Sleep Mode
              </h2>
              <button className="modal-close" onClick={() => !requestingSleep && setShowSleepModal(false)}>×</button>
            </div>
            <form onSubmit={handleRequestSleep}>
              <div className="form-group">
                <label className="form-label" htmlFor="sleep-reason">Reason for stepping away</label>
                <textarea
                  className="form-textarea"
                  id="sleep-reason"
                  value={sleepReason}
                  onChange={e => setSleepReason(e.target.value)}
                  placeholder="e.g. Doctor appointment, power outage, personal errand..."
                  rows={3}
                  required
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Note: Requesting Sleep Mode will pause your work timer immediately and notify HR for approval.
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSleepModal(false)} disabled={requestingSleep}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={requestingSleep} style={{ background: 'var(--warning)', borderColor: 'var(--warning)' }}>
                  {requestingSleep ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
