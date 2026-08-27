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

  const stats = useMemo(() => {
    let approved = 0
    let pending = 0
    let rejected = 0
    requests.forEach(r => {
      if (r.status === 'approved') approved++
      else if (r.status === 'pending') pending++
      else if (r.status === 'rejected') rejected++
    })
    return { total: pagination?.total || requests.length, approved, pending, rejected }
  }, [requests, pagination])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

      {/* Top Hero Toolbar Card */}
      <div className="card" style={{ padding: '20px 24px', borderRadius: '20px', border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          {/* Title & Subtitle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: '14px', background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)', flexShrink: 0 }}>
              <Briefcase size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>Work From Home Portal</h2>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>Manage your remote requests, shift attendance, and real-time activity verification</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={refreshAll} title="Refresh WFH requests">
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ borderRadius: '12px', padding: '9px 18px', fontWeight: 700 }}>
              <Plus size={16} /> Request Work From Home
            </button>
          </div>
        </div>

        {/* 3 Metric Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} style={{ color: 'var(--primary)' }} />
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Requests</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)' }}>{stats.total}</div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle size={18} style={{ color: 'var(--success)' }} />
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Approved</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--success)' }}>{stats.approved}</div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock size={18} style={{ color: 'var(--warning)' }} />
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pending</div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--warning)' }}>{stats.pending}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Active WFH Shift Today */}
      {hasActiveWFHToday && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <WFHAttendancePanel />

          <div className="wfh-proof-card">
            {/* Real-time Activity Tracker */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: `4px solid ${statusMeta.color}`, borderRadius: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: statusMeta.bg, color: statusMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StatusIcon size={21} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Automatic Activity Tracker</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusMeta.color, boxShadow: `0 0 8px ${statusMeta.color}`, animation: visibleStatus === 'active' ? 'pulse-dot 1.8s infinite ease-in-out' : 'none' }} />
                      <strong style={{ color: statusMeta.color, fontSize: '14px' }}>{statusMeta.label}</strong>
                    </div>
                  </div>
                </div>
                <span className="status-badge" style={{ background: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.color}`, borderRadius: '99px', fontSize: '11px', padding: '3px 10px' }}>
                  {localDateString()}
                </span>
              </div>

              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Current Evidence</div>
                <div style={{ color: 'var(--text)', fontSize: '13px', lineHeight: 1.45 }}>{currentStatusText}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Since Activity</div>
                  <strong style={{ color: isIdle ? 'var(--danger)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
                    <MousePointer2 size={14} /> {formatRelativeSeconds(secondsSinceActivity)}
                  </strong>
                </div>
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Productive Time</div>
                  <strong style={{ color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
                    <Timer size={14} /> {secsToHHMM(Math.floor(liveTimers.productive || 0))}
                  </strong>
                </div>
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Break Exemptions</div>
                  <strong style={{ color: 'var(--text)', fontSize: '11.5px' }}>
                    {DEFAULT_CFG.lunch_start}-{DEFAULT_CFG.lunch_end}
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
                    style={{ borderRadius: '8px', fontSize: '12px' }}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Today's Timeline Feed */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, borderRadius: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px' }}>
                  <Clock size={15} style={{ color: 'var(--primary)' }} /> Today's Activity Timeline
                </h3>
                <button className="btn btn-sm btn-secondary" onClick={() => refetchStatus()} style={{ borderRadius: '8px', padding: '4px 8px' }}>
                  <RefreshCw size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                {timelineToday.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 4px', textAlign: 'center' }}>
                    No proof events recorded yet today.
                  </div>
                ) : (
                  timelineToday.map((log) => {
                    const meta = STATUS_META[log.status] || STATUS_META.offline
                    return (
                      <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '65px auto', gap: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: `3px solid ${meta.color}` }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{log.created_at}</span>
                        <div style={{ minWidth: 0 }}>
                          <span className="status-badge" style={{ background: meta.bg, color: meta.color, fontSize: 10, padding: '1px 6px', marginBottom: 2 }}>
                            {meta.label}
                          </span>
                          <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2, overflowWrap: 'anywhere' }}>{log.custom_status}</div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WFH Requests History Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '18px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        
        {/* Table Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
            My WFH Requests
          </h3>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-card)', padding: '3px 10px', borderRadius: '99px', border: '1px solid var(--border)' }}>
            {pagination ? `${pagination.total} Total` : `${requests.length} Total`}
          </span>
        </div>

        {loading ? (
          <div className="loading-container" style={{ padding: '60px 0' }}><div className="spinner" /></div>
        ) : requests.length === 0 ? (
          <div className="table-empty" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>No Work From Home requests submitted yet.</p>
          </div>
        ) : (
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Dates & Duration</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Days</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Reason</th>
                  <th style={{ padding: '13px 16px', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Status</th>
                  <th style={{ padding: '13px 16px', textAlign: 'right', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => (
                  <tr
                    key={request.id}
                    style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.12s ease' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Dates */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                          {request.start_date} <span style={{ color: 'var(--text-muted)' }}>→</span> {request.end_date}
                        </span>
                      </div>
                    </td>

                    {/* Days */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {daysDiff(request.start_date, request.end_date)} Day{daysDiff(request.start_date, request.end_date) !== 1 ? 's' : ''}
                      </span>
                    </td>

                    {/* Reason */}
                    <td style={{ padding: '12px 16px', maxWidth: 280 }}>
                      <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={request.reason}>
                        {request.reason}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: '12px 16px' }}>
                      <span className={`status-badge status-${request.status}`} style={{ textTransform: 'capitalize', fontSize: '11.5px', fontWeight: 700, padding: '3px 10px', borderRadius: '99px' }}>
                        {request.status}
                      </span>
                    </td>

                    {/* Actions Column with Guaranteed Visible Eye Icon */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 12px',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '12px',
                          color: 'var(--primary)',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setViewWFH(request)}
                        title="View request details"
                      >
                        <Eye size={14} style={{ color: 'var(--primary)', stroke: 'var(--primary)' }} />
                        <span>View</span>
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

      {/* View Request Details Modal */}
      {viewWFH && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setViewWFH(null)}>
          <div className="card" style={{ maxWidth: 480, width: '100%', borderRadius: '20px', padding: 0, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }} onClick={event => event.stopPropagation()}>
            <div style={{ padding: '18px 24px', background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Outfit, sans-serif' }}>
                <FileText size={18} style={{ color: 'var(--primary)' }} /> WFH Request Details
              </h3>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setViewWFH(null)} style={{ borderRadius: '8px', padding: '4px 8px' }} aria-label="Close details">
                <X size={15} />
              </button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Duration</span>
                  <strong style={{ fontSize: '13px', color: 'var(--text)' }}>
                    {viewWFH.start_date} → {viewWFH.end_date}
                  </strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {daysDiff(viewWFH.start_date, viewWFH.end_date)} Day{daysDiff(viewWFH.start_date, viewWFH.end_date) !== 1 ? 's' : ''}
                  </div>
                </div>

                <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Status</span>
                  <span className={`status-badge status-${viewWFH.status}`} style={{ textTransform: 'capitalize', fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '99px', display: 'inline-block' }}>
                    {viewWFH.status}
                  </span>
                </div>
              </div>

              <div style={{ background: 'var(--surface-2)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Reason for WFH</span>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {viewWFH.reason}
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setViewWFH(null)} style={{ borderRadius: '10px', padding: '8px 18px' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Apply for Work From Home Modal */}
      {showForm && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !submitting && setShowForm(false)}>
          <div onClick={event => event.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: '520px', background: 'var(--bg-card)', borderRadius: '20px', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '18px 24px', background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Outfit, sans-serif' }}>
                <Plus size={18} style={{ color: 'var(--primary)' }} /> Apply for Work From Home
              </h3>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => !submitting && setShowForm(false)} style={{ borderRadius: '8px', padding: '4px 8px' }} aria-label="Close form">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="start-date" style={{ fontSize: '12px', fontWeight: 700 }}>Start Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" className="form-input" id="start-date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} style={{ borderRadius: '10px' }} required />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="end-date" style={{ fontSize: '12px', fontWeight: 700 }}>End Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" className="form-input" id="end-date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} style={{ borderRadius: '10px' }} required />
                </div>
              </div>

              {form.start_date && form.end_date && form.start_date <= form.end_date && (
                <div style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={13} />
                  <span>Total Duration: {daysDiff(form.start_date, form.end_date)} Day{daysDiff(form.start_date, form.end_date) !== 1 ? 's' : ''}</span>
                </div>
              )}

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="wfh-reason" style={{ fontSize: '12px', fontWeight: 700 }}>Reason for Remote Work <span style={{ color: 'var(--danger)' }}>*</span></label>
                <textarea
                  className="form-input"
                  id="wfh-reason"
                  rows={3}
                  value={form.reason}
                  onChange={event => setForm({ ...form, reason: event.target.value })}
                  placeholder="Explain why you need to work from home..."
                  style={{ borderRadius: '10px' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting} style={{ borderRadius: '10px' }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ borderRadius: '10px', padding: '9px 22px', fontWeight: 700 }}>
                  {submitting ? 'Submitting Request...' : 'Submit WFH Request'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
