import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../App'
import { useGetDashboardQuery, useGetActivityLogsQuery, useDecideLeaveMutation, useDecideWFHRequestMutation, useDecideBreakMutation, useDecideLateCheckinMutation } from '../../store/apiSlice'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import { Users, UserPlus, UserCheck, UserX, CalendarDays, BriefcaseBusiness, WalletCards, ArrowUpRight, ArrowDownRight, Plus, FileText, Clock3, Headphones, Laptop, Home, ChevronRight, Bell, Coffee, LogOut, Check, X, Loader2 } from 'lucide-react'

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`

/* ── Leave display helpers ── */
const LEAVE_TYPE_LABELS = { casual: 'Casual Leave', sick: 'Sick Leave', earned: 'Annual Leave', other: 'Other Leave' }
const leaveTypeLabel = t => LEAVE_TYPE_LABELS[t] || (t ? t.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Leave')
const leaveDays = (s, e) => { if (!s || !e) return 1; return Math.max(1, Math.round((new Date(e + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000) + 1) }
const fmtShortDate = d => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const fmtDateTime = d => {
  if (!d) return ''
  const ms = Date.parse(String(d).replace(' ', 'T'))
  const dt = isNaN(ms) ? new Date() : new Date(ms)
  return dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}
/* ── Break request helper ── */
const breakTypeLabel = r => {
  const t = String(r?.request_type || r?.break_type || '').toLowerCase()
  if (t === 'checkout_undo') return 'Check-Out Undo'
  if (t === 'late_return') return 'Late Break Return'
  if (t === 'meeting') return 'Meeting'
  if (t === 'lunch_break' || t === 'lunch') return 'Lunch Break'
  if (t === 'evening_break' || t === 'evening') return 'Evening Break'
  if (t === 'break' || t === 'manual') return 'Break'
  return r?.break_type ? r.break_type.replace('_', ' ') : 'Break'
}
const fmtTimeHM = t => t ? String(t).slice(0, 5) : ''

/* ── Activity feed helpers ── */
function activityMessage(message) {
  if (!message) return ''
  const parts = message.split('; ')
  return parts.length > 1 ? parts[parts.length - 1] : message
}
function fmtTime12(dateStr) {
  if (typeof dateStr !== 'string' || !dateStr) return ''
  const d = new Date(dateStr.replace(' ', 'T'))
  if (isNaN(d)) return String(dateStr).slice(11, 16)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function activityIcon(log) {
  const t = `${log?.title || ''} ${log?.message || ''}`.toLowerCase()
  if (/leave/.test(t)) return FileText
  if (/break|lunch|coffee|extend/.test(t)) return Coffee
  if (/late|check.?in|early/.test(t)) return Clock3
  if (/check.?out|logout|log ?out/.test(t)) return LogOut
  return Bell
}

function Kpi({ icon: Icon, label, value, trend, positive = true, tone = 'blue' }) {
  return <article className={`exec-kpi ${tone}`}><div className="exec-kpi-top"><span className="exec-kpi-icon"><Icon size={19} /></span><span className={`exec-trend ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trend}</span></div><strong>{value}</strong><span>{label}</span></article>
}

export default function ExecutiveDashboard() {
  const { user } = useAuth(); const navigate = useNavigate()
  const pollingInterval = useVisibilityPolling(5000)
  const { data: response } = useGetDashboardQuery({ range: 'month' }, { refetchOnFocus: true, refetchOnReconnect: true, pollingInterval })
  const stats = response?.data || {}
  const hires = stats.recent_hires || []
  const { data: activityRes, isFetching: activityLoading } = useGetActivityLogsQuery(
    { per_page: 10 },
    { pollingInterval }
  )
  const activityLogs = activityRes?.data?.logs || []
  const departments = useMemo(() => {
    const list = stats.department_summary || stats.departments || []
    return list.length ? list : [{ name: 'All teams', count: stats.total_employees || 0 }]
  }, [stats])
  const maxDept = Math.max(1, ...departments.map(d => Number(d.count || d.total || 0)))
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';

  /* ── Leave & WFH approve / reject (backend is source of truth) ── */
  const [decideLeave] = useDecideLeaveMutation()
  const [decideWfh] = useDecideWFHRequestMutation()
  const [decideBreak] = useDecideBreakMutation()
  const [decideLate] = useDecideLateCheckinMutation()
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const pendingLeaves = stats.pending_leave_requests || []
  const pendingWfh = stats.pending_wfh_requests || []
  const pendingBreaks = stats.pending_break_requests || []
  const pendingLates = stats.pending_late_approvals || []

  const wrap = async (key, fn) => {
    if (busyId) return
    setBusyId(key)
    setActionError('')
    try { await fn() } catch (e) { setActionError(e?.data?.message || 'Could not update this request. Please retry.') }
    finally { setBusyId(null) }
  }

  const handleDecide = (request, status) => wrap(request.id + ':' + status, () => decideLeave({ id: request.id, status }).unwrap())

  const handleDecideWfh = (request, status) => wrap('wfh:' + request.id + ':' + status, () => decideWfh({ id: request.id, status }).unwrap())

  const handleDecideBreak = (request, status) => wrap('brk:' + request.id + ':' + status, () => decideBreak({ action: status, body: { request_id: request.id } }).unwrap())

  const handleDecideLate = (request, status) => wrap('late:' + request.id + ':' + status, () => decideLate({ action: status, notificationId: request.id }).unwrap())

  /* ── Unified Approvals ── */
  const [openApproval, setOpenApproval] = useState(null) // which type is expanded
  const [approveAllBusy, setApproveAllBusy] = useState(false)
  const approveBadge = n => (n <= 0 ? null : (n > 6 ? '6+' : String(n)))

  const approvalTypes = [
    { key: 'wfh',   icon: '🏠', label: 'WFH',       desc: 'Work from home requests',   count: pendingWfh.length,   list: pendingWfh,   manage: '/wfh' },
    { key: 'leave', icon: '🗓', label: 'Leave',     desc: 'Leave requests',             count: pendingLeaves.length, list: pendingLeaves, manage: '/leaves' },
    { key: 'late',  icon: '⏰', label: 'Late Login', desc: 'Late check-in approvals',   count: pendingLates.length,  list: pendingLates,  manage: '/attendance' },
    { key: 'break', icon: '☕', label: 'Break',      desc: 'Break requests',             count: pendingBreaks.length, list: pendingBreaks, manage: '/attendance' },
  ]
  const totalPending = pendingWfh.length + pendingLeaves.length + pendingLates.length + pendingBreaks.length

  const handleApproveAll = async () => {
    if (approveAllBusy || totalPending === 0) return
    if (!window.confirm('Approve all pending requests?\n\nAll currently pending WFH, Leave, Late Login, and Break requests will be approved.')) return
    setApproveAllBusy(true)
    setActionError('')
    try {
      for (const r of pendingWfh)    await decideWfh({ id: r.id, status: 'approved' }).unwrap()
      for (const r of pendingLeaves) await decideLeave({ id: r.id, status: 'approved' }).unwrap()
      for (const r of pendingLates)  await decideLate({ action: 'approve', notificationId: r.id }).unwrap()
      for (const r of pendingBreaks) await decideBreak({ action: 'approve', body: { request_id: r.id } }).unwrap()
    } catch (e) {
      setActionError(e?.data?.message || 'Could not approve all requests. Please retry.')
    } finally {
      setApproveAllBusy(false)
      setOpenApproval(null)
    }
  }

  const renderApprovalItem = (kind, item) => {
    const who = (
      <div className="exec-pending-head">
        {avatarSrc(item.profile_image)
          ? <img className="exec-pending-avatar" src={avatarSrc(item.profile_image)} alt={item.employee_name} />
          : <span className="exec-pending-avatar exec-pending-avatar-fallback">{initialsOf(item.employee_name)}</span>}
        <div className="exec-pending-who">
          <b>{item.employee_name}</b>
          <small>{item.employee_code || 'Employee'}{item.department ? ` · ${item.department}` : ''}</small>
        </div>
        <span className="exec-status status-pending">Pending</span>
      </div>
    )

    let detail
    if (kind === 'leave') {
      detail = <div className="exec-pending-dates"><span className="exec-pending-type">📋 {leaveTypeLabel(item.leave_type)}</span><span>{fmtShortDate(item.start_date)} – {fmtShortDate(item.end_date)} · {leaveDays(item.start_date, item.end_date)} day{leaveDays(item.start_date, item.end_date) > 1 ? 's' : ''}</span></div>
    } else if (kind === 'wfh') {
      detail = <div className="exec-pending-dates"><span className="exec-pending-type">🏠 Work From Home</span><span>{fmtShortDate(item.start_date)} – {fmtShortDate(item.end_date)} · {leaveDays(item.start_date, item.end_date)} day{leaveDays(item.start_date, item.end_date) > 1 ? 's' : ''}</span></div>
    } else if (kind === 'late') {
      detail = <div className="exec-pending-dates"><span className="exec-pending-type">⏰ Late Check-In</span><span>{item.check_in_date ? fmtShortDate(item.check_in_date) : ''}{item.check_in_time ? ` at ${fmtTimeHM(item.check_in_time)}` : ''}</span></div>
    } else {
      detail = <div className="exec-pending-dates"><span className="exec-pending-type">☕ {breakTypeLabel(item)}</span><span>{item.date ? `on ${fmtShortDate(item.date)}` : ''}{item.requested_minutes ? ` · ${item.requested_minutes} min` : ''}</span></div>
    }

    const reason = kind === 'late'
      ? <div className="exec-pending-reason">Requested to check in after the deadline.</div>
      : <div className="exec-pending-reason">Reason: {item.reason || '—'}</div>

    const meta = <div className="exec-pending-meta">Requested {fmtDateTime(item.created_at)}</div>

    let actions
    if (kind === 'leave') {
      actions = <div className="exec-pending-actions"><button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecide(item, 'rejected')}>{busyId === item.id + ':rejected' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject</button><button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecide(item, 'approved')}>{busyId === item.id + ':approved' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button></div>
    } else if (kind === 'wfh') {
      actions = <div className="exec-pending-actions"><button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideWfh(item, 'rejected')}>{busyId === 'wfh:' + item.id + ':rejected' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject</button><button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideWfh(item, 'approved')}>{busyId === 'wfh:' + item.id + ':approved' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button></div>
    } else if (kind === 'late') {
      actions = <div className="exec-pending-actions"><button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideLate(item, 'reject')}>{busyId === 'late:' + item.id + ':reject' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject</button><button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideLate(item, 'approve')}>{busyId === 'late:' + item.id + ':approve' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button></div>
    } else {
      actions = <div className="exec-pending-actions"><button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideBreak(item, 'reject')}>{busyId === 'brk:' + item.id + ':reject' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject</button><button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideBreak(item, 'approve')}>{busyId === 'brk:' + item.id + ':approve' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button></div>
    }

    return (
      <div key={item.id} className="exec-pending-card">
        {who}
        {detail}
        {reason}
        {meta}
        {actions}
      </div>
    )
  }

  const avatarSrc = img => img ? (String(img).startsWith('data:') ? img : `/api/${img}`) : ''
  const initialsOf = n => (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()

  return <div className="exec-dashboard">
    <section className="exec-welcome"><div><span className="exec-kicker">People operations / Overview</span><h1>{greeting}, {user?.name?.split(' ')[0] || 'Admin'}.</h1><p>Here is what is happening across your organization today.</p></div><button className="exec-primary" onClick={() => navigate('/employees')}><Plus size={17} /> Add employee</button></section>
    <div className="exec-kpis">
      <Kpi icon={Users} label="Total employees" value={stats.total_employees || 0} trend="5.3%" tone="blue" />
      <Kpi icon={UserCheck} label="Present today" value={stats.present_today || 0} trend="82.2%" tone="purple" />
      <Kpi icon={Home} label="Working from home" value={stats.wfh_today || 0} trend="6.4%" tone="cyan" />
      <Kpi icon={UserX} label="Absent today" value={stats.absent_today?.length || 0} trend="3.1%" positive={false} tone="orange" />
      
    </div>
    <div className="exec-grid exec-grid-main">
      <section className="exec-panel exec-departments"><div className="exec-panel-head"><div><span className="exec-kicker">Workforce mix</span><h2>Employee overview</h2></div><button className="exec-select">All departments <ChevronRight size={14} /></button></div><div className="exec-dept-body"><div className="exec-donut"><div><strong>{stats.total_employees || 0}</strong><span>Employees</span></div></div><div className="exec-legend">{departments.slice(0, 6).map((d, i) => <div key={d.name || i}><span className={`legend-dot dot-${i}`} /><span>{d.name || d.department || 'Team'}</span><b>{d.count || d.total || 0}</b></div>)}</div></div></section>
      <section className="exec-panel"><div className="exec-panel-head"><div><span className="exec-kicker">Live operations</span><h2>Attendance overview</h2></div><button className="exec-select">This week <ChevronRight size={14} /></button></div><div className="exec-bars">{[72, 86, 78, 94, 90, 65, 58].map((height, i) => <div className="exec-bar-col" key={i}><div className="exec-bar" style={{ height: `${height}%` }} /><span>{['M','T','W','T','F','S','S'][i]}</span></div>)}</div><div className="exec-mini-stats"><span><b>{stats.present_today || 0}</b>Present</span><span><b className="red">{stats.absent_today?.length || 0}</b>Absent</span><span><b className="purple">{stats.on_leave_today || 0}</b>On leave</span><span><b className="cyan">{stats.wfh_today || 0}</b>WFH</span></div></section>
    </div>

    {/* ── Unified Approvals ── */}
    <section className="exec-panel exec-unified-approvals">
      <div className="exec-panel-head">
        <div>
          <span className="exec-kicker">Approvals</span>
          <h2>Approvals {totalPending > 0 && <span className="exec-approval-total">{totalPending}</span>}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="exec-btn exec-btn-approve" disabled={approveAllBusy || totalPending === 0} onClick={handleApproveAll} style={{ padding: '9px 14px', fontSize: 12.5 }}>
            {approveAllBusy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve All
          </button>
        </div>
      </div>

      {actionError && <div className="exec-action-error">{actionError}</div>}

      {totalPending === 0 && <div className="exec-activity-empty" style={{ marginBottom: 10 }}>✓ All caught up — no pending approvals.</div>}

      <div className="exec-approval-list">
        {approvalTypes.map(type => {
          const badge = approveBadge(type.count)
          const isOpen = openApproval === type.key
          return (
            <div key={type.key} className="exec-approval-type">
              <div
                className={`exec-approval-row ${isOpen ? 'open' : ''}`}
                onClick={() => setOpenApproval(isOpen ? null : type.key)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') setOpenApproval(isOpen ? null : type.key) }}
              >
                <span className="exec-approval-type-icon">{type.icon}</span>
                <div className="exec-approval-type-info">
                  <b>{type.label}</b>
                  <small>{type.desc}</small>
                </div>
                {badge && <span className="exec-approval-badge">{badge}</span>}
                <span className="exec-approval-arrow"><ChevronRight size={16} /></span>
              </div>
              {isOpen && (
                <div className="exec-approvals-scroll">
                  {type.list.length === 0
                    ? <div className="exec-activity-empty">No pending {type.label.toLowerCase()} requests.</div>
                    : type.list.map(item => renderApprovalItem(type.key, item))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>

    <div className="exec-grid exec-grid-bottom"><section className="exec-panel">
        <div className="exec-panel-head">
          <div><span className="exec-kicker">Live feed</span><h2>Recent activity</h2></div>
          <button className="exec-link" onClick={() => navigate('/activity-logs')}>View all <ChevronRight size={14} /></button>
        </div>
        {activityLoading && activityLogs.length === 0 ? (
          <div className="exec-activity-empty">Loading activity…</div>
        ) : activityLogs.length === 0 ? (
          <div className="exec-activity-empty">No recent activity.</div>
        ) : (
          <div className="exec-activity-list">
            {activityLogs.slice(0, 7).map(log => {
              const ItemIcon = activityIcon(log)
              return (
                <div key={log.id} className="exec-activity-item">
                  <span className={`exec-activity-icon ${log.type || 'info'}`}><ItemIcon size={15} /></span>
                  <div className="exec-activity-body">
                    <b>{log.title}</b>
                    <small>{activityMessage(log.message)}</small>
                  </div>
                  <span className="exec-activity-time">{fmtTime12(log.created_at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </section><section className="exec-panel"><div className="exec-panel-head"><h2>Quick actions</h2></div><div className="exec-actions">{[[Users,'Employees','/employees'],[Clock3,'Attendance','/attendance'],[FileText,'Leave requests','/leaves'],[Headphones,'Helpdesk','/team-chat'],[Laptop,'WFH requests','/wfh'],[BriefcaseBusiness,'Payroll','/payroll']].map(([Icon,label,path]) => <button key={label} onClick={() => navigate(path)}><span><Icon size={18} /></span>{label}<ChevronRight size={14} /></button>)}</div></section></div>
  </div>
}
