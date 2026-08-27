import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Eye,
  FileText,
  MousePointer2,
  RefreshCw,
  Timer,
  X
} from 'lucide-react'
import {
  useCreateWFHRequestMutation,
  useGetAttendanceStatusTodayQuery,
  useGetWFHMyStatusTodayQuery,
  useGetWFHRequestsQuery,
  useSubmitWFHStatusMutation
} from '../../store/apiSlice'
import { useToast } from '../../App'
import WFHAttendancePanel from '../../components/WFHAttendancePanel'
import useAttendanceTimer from '../../hooks/useAttendanceTimer'
import useIdleActivityTracker from '../../hooks/useIdleActivityTracker'
import { DEFAULT_CFG, secsToHHMM } from '../../utils/attendanceHelpers'

const PER_PAGE = 15
const IDLE_TIMEOUT_MS = 10 * 60 * 1000

const EXEMPT_WINDOWS = [
  { start: DEFAULT_CFG.lunch_start, end: DEFAULT_CFG.lunch_end },
  { start: DEFAULT_CFG.evening_start, end: DEFAULT_CFG.evening_end },
]

const STATUS_META = {
  active: { label: 'Active', color: 'var(--success)', bg: 'var(--success-soft, rgba(16,185,129,0.12))', icon: Activity },
  away: { label: 'Away', color: 'var(--danger)', bg: 'var(--danger-soft, rgba(239,68,68,0.12))', icon: AlertTriangle },
  meeting: { label: 'In Meeting', color: 'var(--warning)', bg: 'var(--warning-soft, rgba(245,158,11,0.12))', icon: Briefcase },
  break: { label: 'On Break', color: 'var(--info, #3b82f6)', bg: 'var(--info-soft, rgba(59,130,246,0.12))', icon: Coffee },
  sleep: { label: 'Sleep/Lock', color: 'var(--warning)', bg: 'var(--warning-soft, rgba(245,158,11,0.12))', icon: AlertTriangle },
  offline: { label: 'Offline', color: 'var(--text-muted)', bg: 'var(--bg-input)', icon: Clock },
}

function localDateString(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

function daysDiff(start, end) {
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1)
}

function isTodayInRange(request) {
  if (request?.status !== 'approved') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(request.start_date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(request.end_date)
  end.setHours(0, 0, 0, 0)
  return today >= start && today <= end
}

function formatRelativeSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  if (safe < 60) return `${safe}s`
  const minutes = Math.floor(safe / 60)
  if (minutes < 60) return `${minutes}m ${safe % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function latestTimelineItem(timeline) {
  return Array.isArray(timeline) && timeline.length > 0 ? timeline[0] : null
}

export default function EmpWFH() {
  const [showForm, setShowForm] = useState(false)
  const [viewWFH, setViewWFH] = useState(null)
  const [form, setForm] = useState({ start_date: '', end_date: '', reason: '' })
  const [page, setPage] = useState(1)
  const { toast } = useToast()

  const autoStateRef = useRef({ idle: false, sleepLogged: false })

  const { data: wfhRes, isLoading: loading, refetch: load } = useGetWFHRequestsQuery({
    page,
    per_page: PER_PAGE
  })
  const [createWFHRequest, { isLoading: submitting }] = useCreateWFHRequestMutation()
  const [submitWFHStatus, { isLoading: updatingStatus }] = useSubmitWFHStatusMutation()

  const data = wfhRes?.data
  const requests = data?.wfh_requests || data || []
  const pagination = data?.pagination || null

  const activeWfhToday = useMemo(() => (
    Array.isArray(requests) ? requests.find(isTodayInRange) : null
  ), [requests])
  const hasActiveWFHToday = !!activeWfhToday

  const { data: statusRes, refetch: refetchStatus } = useGetWFHMyStatusTodayQuery(undefined, {
    skip: !hasActiveWFHToday,
    pollingInterval: hasActiveWFHToday ? 30000 : 0,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })

  const { data: attendanceRes, refetch: refetchAttendance } = useGetAttendanceStatusTodayQuery(undefined, {
    skip: !hasActiveWFHToday,
    pollingInterval: hasActiveWFHToday ? 60000 : 0,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })

  const {
    isIdle,
    isAsleep,
    secondsSinceActivity,
    reset: resetActivityTracker
  } = useIdleActivityTracker({
    enabled: hasActiveWFHToday,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    exemptWindows: EXEMPT_WINDOWS
  })

  const attendanceToday = attendanceRes?.data
  const liveTimers = useAttendanceTimer(hasActiveWFHToday ? attendanceToday : null)
  const timelineToday = statusRes?.data?.timeline || []
  const latestStatus = latestTimelineItem(timelineToday)

  const visibleStatus = isIdle
    ? 'away'
    : (statusRes?.data?.status || (hasActiveWFHToday ? 'active' : 'offline'))
  const statusMeta = STATUS_META[visibleStatus] || STATUS_META.offline
  const StatusIcon = statusMeta.icon
  const currentStatusText = isIdle
    ? (isAsleep ? 'Away - Sleep/lock detected' : 'Away - Idle (no activity 10+ min)')
    : (latestStatus?.custom_status || (hasActiveWFHToday ? 'Automatic activity tracker is watching for idle time.' : 'No active WFH approval today.'))

  const silentSubmitStatus = useCallback(async (payload) => {
    try {
      await submitWFHStatus(payload).unwrap()
      refetchStatus()
    } catch {
      // Automatic proof logging is intentionally quiet; HR will see the next successful pulse.
    }
  }, [submitWFHStatus, refetchStatus])

  useEffect(() => {
    if (!hasActiveWFHToday) {
      autoStateRef.current = { idle: false, sleepLogged: false }
      return
    }

    if (isIdle) {
      const shouldLogSleep = isAsleep && !autoStateRef.current.sleepLogged
      if (!autoStateRef.current.idle || shouldLogSleep) {
        autoStateRef.current = {
          idle: true,
          sleepLogged: autoStateRef.current.sleepLogged || isAsleep
        }
        silentSubmitStatus({
          status: 'away',
          custom_status: isAsleep
            ? 'Away - Sleep/lock detected'
            : 'Away - Idle (no activity 10+ min)'
        })
      }
      return
    }

    if (autoStateRef.current.idle) {
      autoStateRef.current = { idle: false, sleepLogged: false }
      silentSubmitStatus({ status: 'active', custom_status: 'Active - resumed' })
      resetActivityTracker()
    }
  }, [hasActiveWFHToday, isAsleep, isIdle, resetActivityTracker, silentSubmitStatus])

  useEffect(() => {
    if (!hasActiveWFHToday) return undefined

    const handleFocusRefresh = () => {
      refetchAttendance()
      refetchStatus()
    }

    window.addEventListener('focus', handleFocusRefresh)
    return () => window.removeEventListener('focus', handleFocusRefresh)
  }, [hasActiveWFHToday, refetchAttendance, refetchStatus])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!form.start_date || !form.end_date || !form.reason.trim()) {
      toast('Fill all fields.', 'error')
      return
    }
    if (new Date(form.start_date) > new Date(form.end_date)) {
      toast('Start date cannot be after end date.', 'error')
      return
    }

    try {
      const res = await createWFHRequest({ ...form, reason: form.reason.trim() }).unwrap()
      toast(res.message || 'Work from home request submitted.', 'success')
      setShowForm(false)
      setForm({ start_date: '', end_date: '', reason: '' })
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to submit.', 'error')
    }
  }

  const handleManualStatus = async (status) => {
    const messages = {
      active: 'Active - manual override',
      meeting: 'In Meeting - manual override',
      break: 'On Break - manual override',
    }

    try {
      if (status === 'active') {
        autoStateRef.current = { idle: false, sleepLogged: false }
        resetActivityTracker()
      }
      await submitWFHStatus({ status, custom_status: messages[status] }).unwrap()
      refetchStatus()
      toast('WFH status updated.', 'success')
    } catch (err) {
      toast(err.data?.message || 'Failed to update status.', 'error')
    }
  }

  const refreshAll = () => {
    load()
    if (hasActiveWFHToday) {
      refetchStatus()
      refetchAttendance()
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <style>{`
        @keyframes pulse-dot {
          0% { transform: scale(0.95); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.6; }
        }
        .wfh-proof-card {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
          gap: 16px;
          margin-bottom: 20px;
        }
        @media (max-width: 900px) {
          .wfh-proof-card { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="search-bar">
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Request Work From Home</button>
        <button className="btn btn-secondary" onClick={refreshAll}><RefreshCw size={14} /> Refresh</button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} requests` : `${requests.length} requests`}
        </span>
      </div>

      {hasActiveWFHToday && (
        <>
          <WFHAttendancePanel />

          <div className="wfh-proof-card">
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: `4px solid ${statusMeta.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: statusMeta.bg, color: statusMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StatusIcon size={21} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Automatic Activity Tracker</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusMeta.color, boxShadow: `0 0 8px ${statusMeta.color}`, animation: visibleStatus === 'active' ? 'pulse-dot 1.8s infinite ease-in-out' : 'none' }} />
                      <strong style={{ color: statusMeta.color }}>{statusMeta.label}</strong>
                    </div>
                  </div>
                </div>
                <span className="status-badge" style={{ background: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.color}` }}>
                  {localDateString()}
                </span>
              </div>

              <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>Current evidence</div>
                <div style={{ color: 'var(--text-primary)', lineHeight: 1.45 }}>{currentStatusText}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Since last browser activity</div>
                  <strong style={{ color: isIdle ? 'var(--danger)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MousePointer2 size={14} /> {formatRelativeSeconds(secondsSinceActivity)}
                  </strong>
                </div>
                <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Productive timer today</div>
                  <strong style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Timer size={14} /> {secsToHHMM(Math.floor(liveTimers.productive || 0))}
                  </strong>
                </div>
                <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Break windows exempt</div>
                  <strong style={{ color: 'var(--text-primary)', fontSize: 12 }}>
                    {DEFAULT_CFG.lunch_start}-{DEFAULT_CFG.lunch_end}, {DEFAULT_CFG.evening_start}-{DEFAULT_CFG.evening_end}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {[
                  { status: 'active', label: 'Active', Icon: Activity },
                  { status: 'meeting', label: 'In Meeting', Icon: Briefcase },
                  { status: 'break', label: 'On Break', Icon: Coffee },
                ].map(({ status, label, Icon }) => (
                  <button
                    key={status}
                    type="button"
                    className={`btn btn-sm ${visibleStatus === status ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleManualStatus(status)}
                    disabled={updatingStatus}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={15} style={{ color: 'var(--primary)' }} /> Today's Timeline
                </h3>
                <button className="btn btn-sm btn-secondary" onClick={() => refetchStatus()}>
                  <RefreshCw size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {timelineToday.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 4px' }}>
                    No proof events recorded yet today.
                  </div>
                ) : (
                  timelineToday.map((log) => {
                    const meta = STATUS_META[log.status] || STATUS_META.offline
                    return (
                      <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '70px auto', gap: 10, padding: '9px 10px', background: 'var(--bg-input)', borderRadius: 8, borderLeft: `3px solid ${meta.color}` }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{log.created_at}</span>
                        <div style={{ minWidth: 0 }}>
                          <span className="status-badge" style={{ background: meta.bg, color: meta.color, fontSize: 10, padding: '1px 6px', marginBottom: 4 }}>
                            {meta.label}
                          </span>
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, overflowWrap: 'anywhere' }}>{log.custom_status}</div>
                        </div>
                      </div>
                    )
                  })
                )}
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
                {requests.map(request => (
                  <tr key={request.id}>
                    <td>{request.start_date}</td>
                    <td>{request.end_date}</td>
                    <td>{daysDiff(request.start_date, request.end_date)}</td>
                    <td><span className="leave-reason-preview">{request.reason}</span></td>
                    <td><span className={`status-badge status-${request.status}`}>{request.status}</span></td>
                    <td>
                      <button className="btn btn-icon btn-secondary leave-view-btn" title="View details" aria-label="View details" onClick={() => setViewWFH(request)}>
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination && totalPages > 1 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--bg-card)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages} &nbsp;-&nbsp; {pagination.total} requests
                </span>
                <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">&laquo;</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 13, padding: '0 8px' }}>{page}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
                    <ChevronRight size={14} />
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">&raquo;</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {viewWFH && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setViewWFH(null)}>
          <div className="modal leave-detail-modal" style={{ maxWidth: 480 }} onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FileText size={18} style={{ color:'var(--primary)' }} /> WFH Request Details
              </h2>
              <button className="modal-close" onClick={() => setViewWFH(null)} aria-label="Close details"><X size={18} /></button>
            </div>
            <div className="leave-detail-body" style={{ padding: '0 24px 20px' }}>
              <div className="leave-detail-grid">
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><Calendar size={13} /> Duration</span>
                  <span className="leave-detail-value">
                    {viewWFH.start_date} to {viewWFH.end_date}
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
              <div className="leave-detail-reason" style={{ marginTop: 14 }}>
                <span className="leave-detail-label" style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}><FileText size={13} /> Reason</span>
                <p className="leave-detail-reason-text" style={{ marginTop: 6 }}>{viewWFH.reason}</p>
              </div>
              <div className="modal-footer" style={{ margin: '20px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setViewWFH(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showForm && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !submitting && setShowForm(false)}>
          <div onClick={event => event.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"520px",background:"#ffffff",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(15,23,42,0.35)",border:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2>Apply for Work From Home</h2>
              <button className="modal-close" onClick={() => !submitting && setShowForm(false)} aria-label="Close form"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '0 24px 20px' }}>
              <div className="form-row">
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label" htmlFor="start-date">Start Date</label>
                  <input type="date" className="form-input" id="start-date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} required />
                </div>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label" htmlFor="end-date">End Date</label>
                  <input type="date" className="form-input" id="end-date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} required />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="wfh-reason">Reason</label>
                <textarea
                  className="form-textarea"
                  id="wfh-reason"
                  value={form.reason}
                  onChange={event => setForm({ ...form, reason: event.target.value })}
                  placeholder="Explain why you need to work from home..."
                  required
                />
              </div>
              <div className="modal-footer" style={{ margin: '18px -24px -20px', padding: '14px 24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
