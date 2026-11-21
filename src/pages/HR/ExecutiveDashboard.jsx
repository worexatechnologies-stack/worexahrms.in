import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../App'
import {
  useGetDashboardQuery,
  useGetActivityLogsQuery,
  useDecideLeaveMutation,
  useDecideWFHRequestMutation,
  useDecideBreakMutation,
  useDecideLateCheckinMutation
} from '../../store/apiSlice'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import {
  Users,
  UserCheck,
  UserX,
  CalendarDays,
  BriefcaseBusiness,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  FileText,
  Clock3,
  Laptop,
  Home,
  ChevronRight,
  Bell,
  Coffee,
  LogOut,
  Check,
  X,
  Loader2,
  Building2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Search,
  Sparkles,
  Activity,
  TrendingUp,
  Zap,
  Cake,
  Radio,
  Clock,
  Eye,
  Filter
} from 'lucide-react'
import { MOTIVATION_QUOTES } from '../../data/motivationQuotes'

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`

/* ── Leave display helpers ── */
const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  earned: 'Annual Leave',
  other: 'Other Leave',
}
const leaveTypeLabel = (t) =>
  LEAVE_TYPE_LABELS[t] ||
  (t ? t.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Leave')

const leaveDays = (s, e) => {
  if (!s || !e) return 1
  return Math.max(
    1,
    Math.round((new Date(e + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000) + 1
  )
}
const fmtShortDate = (d) => {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const fmtDateTime = (d) => {
  if (!d) return ''
  const ms = Date.parse(String(d).replace(' ', 'T'))
  const dt = isNaN(ms) ? new Date() : new Date(ms)
  return dt.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

/* ── Break request helper ── */
const breakTypeLabel = (r) => {
  const t = String(r?.request_type || r?.break_type || '').toLowerCase()
  if (t === 'checkout_undo') return 'Check-Out Undo'
  if (t === 'late_return') return 'Late Break Return'
  if (t === 'meeting') return 'Client / Tech Meeting'
  if (t === 'lunch_break' || t === 'lunch') return 'Lunch Break'
  if (t === 'evening_break' || t === 'evening') return 'Evening Break'
  if (t === 'break' || t === 'manual') return 'Code Pause'
  return r?.break_type ? r.break_type.replace('_', ' ') : 'Break'
}
const fmtTimeHM = (t) => (t ? String(t).slice(0, 5) : '')

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

/* ── Modern IT Metric Card Component ── */
function MetricCommandCard({ icon: Icon, label, value, subtext, trend, positive = true, tone = 'blue', onClick }) {
  return (
    <article
      className={`exec-kpi ${tone} relative overflow-hidden group cursor-pointer transition-all duration-200 hover:-translate-y-1`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="exec-kpi-icon">
          <Icon size={20} strokeWidth={2.1} />
        </span>
        {trend && (
          <span className={`exec-trend ${positive ? 'positive' : 'negative'} flex items-center gap-0.5 text-xs font-bold`}>
            {positive ? <ArrowUpRight size={13} strokeWidth={2.4} /> : <ArrowDownRight size={13} strokeWidth={2.4} />}
            {trend}
          </span>
        )}
      </div>

      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        {value}
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span>
        {onClick && (
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
            Inspect &rarr;
          </span>
        )}
      </div>

      {subtext && (
        <div className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
          {subtext}
        </div>
      )}
    </article>
  )
}

export default function ExecutiveDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isViyana = user?.company_slug === 'viyana'
  const pollingInterval = useVisibilityPolling(5000)
  const { data: response } = useGetDashboardQuery(
    { range: 'month' },
    { refetchOnFocus: true, refetchOnReconnect: true, pollingInterval }
  )

  // Instant Hydration from Local Storage Cache
  const hrCacheKey = user?.id ? `hrms_hr_dash_cache_${user.id}` : 'hrms_hr_dash_cache_default'
  const [cachedStats, setCachedStats] = useState(() => {
    try {
      const raw = localStorage.getItem(hrCacheKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (response?.data) {
      setCachedStats(response.data)
      try {
        localStorage.setItem(hrCacheKey, JSON.stringify(response.data))
      } catch { }
    }
  }, [response?.data, hrCacheKey])

  const stats = response?.data || cachedStats || {}
  const hires = stats.recent_hires || []
  const [activeKpiModal, setActiveKpiModal] = useState(null)
  const [modalSearch, setModalSearch] = useState('')

  // Live Real-Time Radar State
  const [activeRadarTab, setActiveRadarTab] = useState('floor') // 'floor' | 'wfh' | 'breaks' | 'leaves'
  const [radarSearch, setRadarSearch] = useState('')

  const { data: activityRes, isFetching: activityLoading } = useGetActivityLogsQuery(
    { per_page: 8 },
    { pollingInterval }
  )
  const activityLogs = activityRes?.data?.logs || []

  // Deterministic daily sprint inspiration
  const dailyInspiration = useMemo(() => {
    try {
      const now = new Date()
      const start = new Date(now.getFullYear(), 0, 0)
      const diff = now - start
      const oneDay = 1000 * 60 * 60 * 24
      const dayOfYear = Math.floor(diff / oneDay)
      return MOTIVATION_QUOTES[dayOfYear % MOTIVATION_QUOTES.length] || MOTIVATION_QUOTES[0]
    } catch {
      return 'Great engineering starts with disciplined execution and clear architecture.'
    }
  }, [])

  // Departments & Tech Squads Breakdown
  const departments = useMemo(() => {
    let list = stats.department_summary || stats.departments
    if (!list || !list.length) {
      if (Array.isArray(stats.total_employees_list) && stats.total_employees_list.length) {
        const counts = {}
        stats.total_employees_list.forEach((emp) => {
          const d = (emp.department || 'General Tech').trim()
          counts[d] = (counts[d] || 0) + 1
        })
        const palette = [
          '#2563eb', // Royal Blue
          '#06b6d4', // Cyan
          '#8b5cf6', // Violet
          '#f59e0b', // Amber
          '#10b981', // Emerald
          '#ec4899', // Pink
          '#f97316', // Orange
          '#64748b', // Slate
        ]
        const total = stats.total_employees_list.length
        list = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count], i) => ({
            name,
            count,
            percentage: Number(((count / total) * 100).toFixed(1)),
            color: palette[i % palette.length],
          }))
      }
    }
    return list && list.length
      ? list
      : [{ name: 'Engineering Fleet', count: stats.total_employees || 0, percentage: 100, color: '#2563eb' }]
  }, [stats])

  const donutGradient = useMemo(() => {
    if (!departments || !departments.length) return 'conic-gradient(#2563eb 0 100%)'
    let currentPct = 0
    const stops = []
    departments.forEach((d) => {
      const start = currentPct
      currentPct += d.percentage || 0
      stops.push(`${d.color} ${start}% ${currentPct}%`)
    })
    if (currentPct < 100 && departments.length) {
      stops.push(`${departments[departments.length - 1].color} ${currentPct}% 100%`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [departments])

  // Live Digital Clock
  const [liveClock, setLiveClock] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setLiveClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const hour = liveClock.getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night'

  // Extract core active workforce lists
  const presentEmployees = stats.present_employees || []
  const wfhEmployees = stats.wfh_employees || []
  const absentEmployees = stats.absent_today || []
  const leaveEmployees = stats.on_leave_employees || []
  const activeBreakSessions = stats.active_break_sessions || []
  const recentHires = stats.recent_hires || []
  const upcomingBirthdays = stats.upcoming_birthdays || []

  // Helper to calculate break elapsed minutes
  const getElapsedMinutes = (startedAt) => {
    if (!startedAt) return 0
    const t = Date.parse(String(startedAt).replace(' ', 'T'))
    if (isNaN(t)) return 0
    return Math.max(0, Math.floor((Date.now() - t) / 60000))
  }

  // Filtered radar fleet by search term
  const filteredRadarList = useMemo(() => {
    const q = radarSearch.trim().toLowerCase()
    let rawList = []

    if (activeRadarTab === 'floor') rawList = presentEmployees
    else if (activeRadarTab === 'wfh') rawList = wfhEmployees
    else if (activeRadarTab === 'breaks') rawList = activeBreakSessions
    else if (activeRadarTab === 'leaves') rawList = leaveEmployees

    if (!q) return rawList
    return rawList.filter((emp) => {
      const name = String(emp.name || emp.employee_name || '').toLowerCase()
      const code = String(emp.employee_code || '').toLowerCase()
      const dept = String(emp.department || '').toLowerCase()
      const desig = String(emp.designation || emp.break_type || '').toLowerCase()
      return name.includes(q) || code.includes(q) || dept.includes(q) || desig.includes(q)
    })
  }, [activeRadarTab, radarSearch, presentEmployees, wfhEmployees, activeBreakSessions, leaveEmployees])

  // Modal deep-dive filter
  const filteredModalList = useMemo(() => {
    if (!activeKpiModal?.list) return []
    const q = modalSearch.trim().toLowerCase()
    if (!q) return activeKpiModal.list
    return activeKpiModal.list.filter(
      (emp) =>
        (emp.name && emp.name.toLowerCase().includes(q)) ||
        (emp.employee_name && emp.employee_name.toLowerCase().includes(q)) ||
        (emp.employee_code && String(emp.employee_code).toLowerCase().includes(q)) ||
        (emp.department && emp.department.toLowerCase().includes(q)) ||
        (emp.designation && emp.designation.toLowerCase().includes(q))
    )
  }, [activeKpiModal, modalSearch])

  /* ── Leave & WFH approve / reject mutations ── */
  const [decideLeave] = useDecideLeaveMutation()
  const [decideWfh] = useDecideWFHRequestMutation()
  const [decideBreak] = useDecideBreakMutation()
  const [decideLate] = useDecideLateCheckinMutation()
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  const sortByLatest = (list) =>
    [...(list || [])].sort((a, b) => {
      const tA = new Date(a.created_at || a.date || a.check_in_date || 0).getTime() || 0
      const tB = new Date(b.created_at || b.date || b.check_in_date || 0).getTime() || 0
      return tB - tA
    })

  const pendingLeaves = useMemo(() => sortByLatest(stats.pending_leave_requests), [stats.pending_leave_requests])
  const pendingWfh = useMemo(() => sortByLatest(stats.pending_wfh_requests), [stats.pending_wfh_requests])
  const pendingBreaks = useMemo(() => sortByLatest(stats.pending_break_requests), [stats.pending_break_requests])
  const pendingLates = useMemo(() => sortByLatest(stats.pending_late_approvals), [stats.pending_late_approvals])

  const wrap = async (key, fn) => {
    if (busyId) return
    setBusyId(key)
    setActionError('')
    try {
      await fn()
    } catch (e) {
      setActionError(e?.data?.message || 'Could not update this request. Please retry.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDecide = (request, status) =>
    wrap(request.id + ':' + status, () => decideLeave({ id: request.id, status }).unwrap())

  const handleDecideWfh = (request, status) =>
    wrap('wfh:' + request.id + ':' + status, () => decideWfh({ id: request.id, status }).unwrap())

  const handleDecideBreak = (request, status) =>
    wrap('brk:' + request.id + ':' + status, () =>
      decideBreak({ action: status, body: { request_id: request.id } }).unwrap()
    )

  const handleDecideLate = (request, status) =>
    wrap('late:' + request.id + ':' + status, () =>
      decideLate({ action: status, notificationId: request.id }).unwrap()
    )

  /* ── Unified Approvals Center ── */
  const [openApproval, setOpenApproval] = useState(null)
  const [approveAllBusy, setApproveAllBusy] = useState(false)

  const approvalTypes = [
    {
      key: 'wfh',
      label: 'Work From Home',
      shortLabel: 'WFH',
      desc: 'Remote shifts & geofence requests',
      count: pendingWfh.length,
      list: pendingWfh,
      manage: '/wfh',
      tone: 'cyan',
      Icon: Home,
    },
    {
      key: 'leave',
      label: 'Leave Requests',
      shortLabel: 'Leave',
      desc: 'Casual, sick & paid time-off',
      count: pendingLeaves.length,
      list: pendingLeaves,
      manage: '/leaves',
      tone: 'emerald',
      Icon: CalendarDays,
    },
    {
      key: 'late',
      label: 'Late Check-in',
      shortLabel: 'Late Login',
      desc: 'Late clock-in approval waivers',
      count: pendingLates.length,
      list: pendingLates,
      manage: '/attendance',
      tone: 'amber',
      Icon: Clock3,
    },
    {
      key: 'break',
      label: 'Break & Overtime',
      shortLabel: 'Break',
      desc: 'Extended breaks & client meetings',
      count: pendingBreaks.length,
      list: pendingBreaks,
      manage: '/attendance',
      tone: 'purple',
      Icon: Coffee,
    },
  ]
  const totalPending = pendingWfh.length + pendingLeaves.length + pendingLates.length + pendingBreaks.length
  const activeApprovalType = approvalTypes.find((t) => t.key === openApproval)

  const handleApproveAll = async () => {
    if (approveAllBusy || totalPending === 0) return
    if (
      !window.confirm(
        'Approve all pending requests?\n\nAll currently pending WFH, Leave, Late Login, and Break requests will be approved.'
      )
    )
      return
    setApproveAllBusy(true)
    setActionError('')
    try {
      for (const r of pendingWfh) await decideWfh({ id: r.id, status: 'approved' }).unwrap()
      for (const r of pendingLeaves) await decideLeave({ id: r.id, status: 'approved' }).unwrap()
      for (const r of pendingLates) await decideLate({ action: 'approve', notificationId: r.id }).unwrap()
      for (const r of pendingBreaks) await decideBreak({ action: 'approve', body: { request_id: r.id } }).unwrap()
    } catch (e) {
      setActionError(e?.data?.message || 'Could not approve all requests. Please retry.')
    } finally {
      setApproveAllBusy(false)
      setOpenApproval(null)
    }
  }

  const avatarSrc = (img) =>
    img ? (String(img).startsWith('data:') ? img : `/api/${img}`) : ''
  const initialsOf = (n) =>
    (n || '?')
      .split(' ')
      .map((x) => x[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()

  const renderApprovalItem = (kind, item) => {
    const who = (
      <div className="exec-pending-head">
        {avatarSrc(item.profile_image) ? (
          <img className="exec-pending-avatar" src={avatarSrc(item.profile_image)} alt={item.employee_name} />
        ) : (
          <span className="exec-pending-avatar exec-pending-avatar-fallback">
            {initialsOf(item.employee_name)}
          </span>
        )}
        <div className="exec-pending-who">
          <b>{item.employee_name}</b>
          <small>
            {item.employee_code || 'Team Member'}
            {item.department ? ` · ${item.department}` : ''}
          </small>
        </div>
        <span className="exec-status status-pending">Pending</span>
      </div>
    )

    let detail
    if (kind === 'leave') {
      detail = (
        <div className="exec-pending-dates">
          <span className="exec-pending-type inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-blue-500" /> {leaveTypeLabel(item.leave_type)}</span>
          <span>
            {fmtShortDate(item.start_date)} – {fmtShortDate(item.end_date)} · {leaveDays(item.start_date, item.end_date)} day
            {leaveDays(item.start_date, item.end_date) > 1 ? 's' : ''}
          </span>
        </div>
      )
    } else if (kind === 'wfh') {
      detail = (
        <div className="exec-pending-dates">
          <span className="exec-pending-type inline-flex items-center gap-1.5"><Home size={13} className="text-cyan-500" /> Work From Home</span>
          <span>
            {fmtShortDate(item.start_date)} – {fmtShortDate(item.end_date)} · {leaveDays(item.start_date, item.end_date)} day
            {leaveDays(item.start_date, item.end_date) > 1 ? 's' : ''}
          </span>
        </div>
      )
    } else if (kind === 'late') {
      detail = (
        <div className="exec-pending-dates">
          <span className="exec-pending-type inline-flex items-center gap-1.5"><Clock3 size={13} className="text-amber-500" /> Late Check-In</span>
          <span>
            {item.check_in_date ? fmtShortDate(item.check_in_date) : ''}
            {item.check_in_time ? ` at ${fmtTimeHM(item.check_in_time)}` : ''}
          </span>
        </div>
      )
    } else if (item.request_type === 'late_return') {
      detail = (
        <div className="exec-pending-dates">
          <span className="exec-pending-type inline-flex items-center gap-1.5"><Clock3 size={13} className="text-purple-500" /> Late Break Return · {item.requested_minutes} min late</span>
          <span>{item.date ? `on ${fmtShortDate(item.date)}` : ''}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--color-success, #22c55e)', marginTop: 2 }}>
            <CheckCircle2 size={13} className="shrink-0" />
            <span>Approving will credit <strong>{item.requested_minutes} min</strong> to active shift hours</span>
          </span>
        </div>
      )
    } else {
      detail = (
        <div className="exec-pending-dates">
          <span className="exec-pending-type inline-flex items-center gap-1.5"><Coffee size={13} className="text-purple-500" /> {breakTypeLabel(item)}</span>
          <span>
            {item.date ? `on ${fmtShortDate(item.date)}` : ''}
            {item.requested_minutes ? ` · ${item.requested_minutes} min` : ''}
          </span>
        </div>
      )
    }

    const reason =
      kind === 'late' ? (
        <div className="exec-pending-reason">Late check-in waiver submitted by employee.</div>
      ) : (
        <div className="exec-pending-reason">Reason: {item.reason || '—'}</div>
      )

    const meta = <div className="exec-pending-meta">Requested {fmtDateTime(item.created_at)}</div>

    let actions
    if (kind === 'leave') {
      actions = (
        <div className="exec-pending-actions">
          <button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecide(item, 'rejected')}>
            {busyId === item.id + ':rejected' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject
          </button>
          <button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecide(item, 'approved')}>
            {busyId === item.id + ':approved' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve
          </button>
        </div>
      )
    } else if (kind === 'wfh') {
      actions = (
        <div className="exec-pending-actions">
          <button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideWfh(item, 'rejected')}>
            {busyId === 'wfh:' + item.id + ':rejected' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject
          </button>
          <button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideWfh(item, 'approved')}>
            {busyId === 'wfh:' + item.id + ':approved' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve
          </button>
        </div>
      )
    } else if (kind === 'late') {
      actions = (
        <div className="exec-pending-actions">
          <button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideLate(item, 'reject')}>
            {busyId === 'late:' + item.id + ':reject' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject
          </button>
          <button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideLate(item, 'approve')}>
            {busyId === 'late:' + item.id + ':approve' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve
          </button>
        </div>
      )
    } else {
      actions = (
        <div className="exec-pending-actions">
          <button className="exec-btn exec-btn-reject" disabled={!!busyId} onClick={() => handleDecideBreak(item, 'reject')}>
            {busyId === 'brk:' + item.id + ':reject' ? <Loader2 size={14} className="spin" /> : <X size={14} />} Reject
          </button>
          <button className="exec-btn exec-btn-approve" disabled={!!busyId} onClick={() => handleDecideBreak(item, 'approve')}>
            {busyId === 'brk:' + item.id + ':approve' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve
          </button>
        </div>
      )
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

  return (
    <div className="exec-dashboard space-y-6">

      {/* ── 1. MODERN EXECUTIVE PAGE HEADER ── */}
      <section className="rounded-2xl bg-white dark:bg-[#0c1322] border border-slate-200/90 dark:border-slate-800/80 p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 transition-all">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Operations Console
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Live Biometric Telemetry
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {greeting}, {user?.name?.split(' ')[0] || 'Admin'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">
            Here is your live workforce telemetry, floor presence, and governance decisions for today.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Live IST Clock Pill */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
            <Clock className="h-3.5 w-3.5 text-blue-500" />
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
              {liveClock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase">IST</span>
          </div>

          {/* Quick Action Button */}
          <button
            type="button"
            onClick={() => navigate('/employees')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Plus size={14} /> Add Employee
          </button>
        </div>
      </section>

      {/* ── 2. HIGH-IMPACT TECH KPI COMMAND GRID (5 COLUMNS) ── */}
      <div className="it-kpi-grid">
        {/* KPI 1: Total Tech Fleet */}
        <MetricCommandCard
          icon={Users}
          label="Total Workforce"
          value={stats.total_employees || 0}
          subtext={`${stats.workforce_stats?.full_time_count ?? stats.active_employees ?? 0} Full-time · ${stats.workforce_stats?.intern_count ?? 0} Intern`}
          trend="+5.3% QoQ"
          tone="blue"
          onClick={() => {
            setModalSearch('')
            setActiveKpiModal({
              type: 'total',
              title: 'Total Workforce Fleet',
              subtitle: 'All active employees and contractors in the organization',
              list: stats.total_employees_list || [],
            })
          }}
        />

        {/* KPI 2: Floor Presence HQ */}
        <MetricCommandCard
          icon={UserCheck}
          label="Present in Office"
          value={presentEmployees.length}
          subtext="On-time biometric arrival · HQ Floor"
          trend={`${stats.total_employees ? Math.round((presentEmployees.length / stats.total_employees) * 100) : 0}% fleet`}
          tone="green"
          onClick={() => {
            setModalSearch('')
            setActiveKpiModal({
              type: 'present',
              title: 'Present in Office HQ',
              subtitle: 'Employees who marked biometric or attendance punch today',
              list: presentEmployees,
            })
          }}
        />

        {/* KPI 3: Remote Fleet WFH */}
        <MetricCommandCard
          icon={Laptop}
          label="Remote Fleet (WFH)"
          value={wfhEmployees.length}
          subtext="Geofence & IP Guard Verified"
          trend="Distributed"
          tone="cyan"
          onClick={() => {
            setModalSearch('')
            setActiveKpiModal({
              type: 'wfh',
              title: 'Remote Workforce (WFH)',
              subtitle: 'Active employees operating from approved remote locations today',
              list: wfhEmployees,
            })
          }}
        />

        {/* KPI 4: Live Fleet Pauses */}
        <MetricCommandCard
          icon={Coffee}
          label="Active Breaks"
          value={activeBreakSessions.length}
          subtext="Currently on Lunch / Coffee / Meeting"
          trend="Live Fleet"
          tone="orange"
          onClick={() => {
            setModalSearch('')
            setActiveKpiModal({
              type: 'breaks',
              title: 'Employees on Active Break',
              subtitle: 'Live session monitor with elapsed minutes',
              list: activeBreakSessions,
            })
          }}
        />

        {/* KPI 5: Absent & Planned Off */}
        <MetricCommandCard
          icon={UserX}
          label="Absent / On Leave"
          value={`${absentEmployees.length} / ${stats.on_leave_today || leaveEmployees.length || 0}`}
          subtext={`${absentEmployees.length} Unplanned · ${stats.on_leave_today || leaveEmployees.length || 0} Planned Leave`}
          trend="Compliance"
          positive={false}
          tone="rose"
          onClick={() => {
            setModalSearch('')
            setActiveKpiModal({
              type: 'absent',
              title: 'Absent & On Leave Today',
              subtitle: 'Employees without punch records or on approved time off today',
              list: [...absentEmployees, ...leaveEmployees],
            })
          }}
        />
      </div>

      {/* ── 3. REAL-TIME TECH FLEET & FLOOR RADAR ── */}
      <section className="exec-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Fleet Radar & Live Presence
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              Real-Time Tech Floor Monitor
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live presence status, biometric check-in timestamps, and active work sessions.
            </p>
          </div>

          {/* Quick Fleet Search & Hub Link */}
          <div className="flex items-center gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter active fleet..."
                value={radarSearch}
                onChange={(e) => setRadarSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
              />
              {radarSearch && (
                <button
                  type="button"
                  onClick={() => setRadarSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/attendance')}
              className="hidden sm:inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
            >
              Full Hub <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Radar Tabs Switcher */}
        <div className="flex flex-wrap gap-2 mb-6 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveRadarTab('floor')}
            className={`it-radar-tab ${activeRadarTab === 'floor' ? 'active' : ''}`}
          >
            <UserCheck size={15} />
            <span>HQ Floor ({presentEmployees.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveRadarTab('wfh')}
            className={`it-radar-tab ${activeRadarTab === 'wfh' ? 'active' : ''}`}
          >
            <Laptop size={15} />
            <span>Remote Squad ({wfhEmployees.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveRadarTab('breaks')}
            className={`it-radar-tab ${activeRadarTab === 'breaks' ? 'active' : ''}`}
          >
            <Coffee size={15} />
            <span>Live Pauses ({activeBreakSessions.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveRadarTab('leaves')}
            className={`it-radar-tab ${activeRadarTab === 'leaves' ? 'active' : ''}`}
          >
            <CalendarDays size={15} />
            <span>On Leave ({leaveEmployees.length || stats.on_leave_today || 0})</span>
          </button>
        </div>

        {/* Tab Content: Fleet Cards Grid */}
        <div className="it-fleet-grid">
          {filteredRadarList.length === 0 ? (
            <div className="col-span-full py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mb-2">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                {activeRadarTab === 'breaks'
                  ? 'All Engineers Active on Keyboard'
                  : `No team members found in ${activeRadarTab} channel`}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {activeRadarTab === 'breaks'
                  ? 'Zero active pause sessions currently recorded across the organization.'
                  : 'Check-ins and activity updates appear here automatically as events occur.'}
              </p>
            </div>
          ) : (
            filteredRadarList.slice(0, 12).map((item, idx) => {
              const name = item.name || item.employee_name || 'Team Member'
              const code = item.employee_code ? `#${item.employee_code}` : ''
              const dept = item.department || 'Tech Operations'
              const desig = item.designation || 'Engineer'
              const imgSrc = avatarSrc(item.profile_image)

              // Active break session elapsed calculation
              const isBreakTab = activeRadarTab === 'breaks'
              const elapsedMin = isBreakTab ? getElapsedMinutes(item.started_at) : null
              const isPresencePaused = ['floor', 'wfh'].includes(activeRadarTab) && (item.is_paused || item.active_activity_type === 'pause')

              return (
                <div key={item.id || item.employee_id || idx} className="it-fleet-card">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
                      {imgSrc ? (
                        <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(name)
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                          {name}
                        </span>
                        {code && (
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {code}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {desig} · {dept}
                      </div>
                    </div>
                  </div>

                  {/* Status Indicator on Right */}
                  <div className="text-right shrink-0">
                    {activeRadarTab === 'floor' && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${isPresencePaused ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'}`}>
                        {isPresencePaused ? 'Paused · screen / tab' : `In: ${item.check_in ? String(item.check_in).slice(0, 5) : 'Active'}`}
                      </span>
                    )}

                    {activeRadarTab === 'wfh' && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${isPresencePaused ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800' : 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800'}`}>
                        {isPresencePaused ? 'Paused · screen / tab' : 'Verified WFH'}
                      </span>
                    )}

                    {activeRadarTab === 'breaks' && (
                      <div className="flex flex-col items-end">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping"></span>
                          {elapsedMin}m elapsed
                        </span>
                        <span className="text-[9px] text-slate-400 capitalize mt-0.5">
                          {item.break_type || 'Break'}
                        </span>
                      </div>
                    )}

                    {activeRadarTab === 'leaves' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                        {item.leave_type ? leaveTypeLabel(item.leave_type) : 'On Leave'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {filteredRadarList.length > 12 && (
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
            <button
              type="button"
              onClick={() => {
                setModalSearch('')
                setActiveKpiModal({
                  type: activeRadarTab,
                  title: `${activeRadarTab.toUpperCase()} Workforce Channel`,
                  subtitle: `Full registry of employees currently active in ${activeRadarTab}`,
                  list: filteredRadarList,
                })
              }}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
            >
              +{filteredRadarList.length - 12} more team members · View full channel registry &rarr;
            </button>
          </div>
        )}
      </section>

      {/* ── 4. SQUAD DYNAMICS & ATTENDANCE TRENDS (GRID) ── */}
      <div className="exec-grid exec-grid-main">
        {/* Left: Tech Squad Dynamics */}
        <section className="exec-panel exec-workforce-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="exec-panel-head">
            <div>
              <span className="exec-kicker">Squad Distribution</span>
              <h2>Tech Squads & Teams</h2>
            </div>
            {!isViyana && (
              <button
                className="exec-select text-xs font-bold text-blue-600 dark:text-blue-400"
                onClick={() => navigate('/departments')}
                title="Manage all tech squads"
              >
                <span>All squads</span>
                <ChevronRight size={14} />
              </button>
            )}
          </div>

          <div className="workforce-body-grid">
            {/* Multi-Segment Donut Core */}
            <div className="workforce-chart-pane">
              <div className="workforce-donut-ring" style={{ background: donutGradient }}>
                <div className="workforce-donut-core">
                  <strong>{stats.active_employees || stats.total_employees || 0}</strong>
                  <span>Active Staff</span>
                  <span className="workforce-status-tag">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Operational
                  </span>
                </div>
              </div>
              <div className="workforce-chart-caption">
                <span>{departments.length} Squads Active</span>
              </div>
            </div>

            {/* Squad Spectrum Bars */}
            <div className="workforce-legend-pane">
              <div className="workforce-teams-list">
                {departments.slice(0, 5).map((d, i) => (
                  <div
                    key={d.name || i}
                    className="workforce-team-row"
                    onClick={() => {
                      setModalSearch(d.name)
                      setActiveKpiModal({
                        type: 'dept',
                        title: `${d.name} Squad`,
                        subtitle: `${d.count} engineer${d.count > 1 ? 's' : ''} in ${d.name}`,
                        list: (stats.total_employees_list || []).filter(
                          (e) => (e.department || '').toLowerCase() === d.name.toLowerCase()
                        ),
                      })
                    }}
                    title={`View ${d.name} team members`}
                  >
                    <div className="workforce-team-title">
                      <span className="workforce-team-dot" style={{ backgroundColor: d.color }} />
                      <span className="workforce-team-label">{d.name}</span>
                    </div>

                    <div className="workforce-team-bar-track">
                      <div
                        className="workforce-team-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(8, d.percentage))}%`,
                          backgroundColor: d.color,
                        }}
                      />
                    </div>

                    <div className="workforce-team-figures">
                      <span className="workforce-team-count">{d.count}</span>
                      <span className="workforce-team-pct">{d.percentage}%</span>
                    </div>
                  </div>
                ))}

                {departments.length > 5 && (
                  <button
                    type="button"
                    className="workforce-more-link"
                    onClick={() => navigate('/departments')}
                  >
                    +{departments.length - 5} more departments &rarr;
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Squad Intelligence Strip */}
          <div className="workforce-intel-strip">
            <div className="workforce-intel-item">
              <span className="workforce-intel-lbl">Primary Tech Squad</span>
              <strong className="workforce-intel-val text-blue-600">
                {departments[0]?.name || 'N/A'} ({departments[0]?.percentage || 0}%)
              </strong>
            </div>
            <div className="workforce-intel-item">
              <span className="workforce-intel-lbl">Total Departments</span>
              <strong className="workforce-intel-val">
                {departments.length} Squads Active
              </strong>
            </div>
            <div className="workforce-intel-item">
              <span className="workforce-intel-lbl">Workforce Split</span>
              <strong className="workforce-intel-val">
                {stats.workforce_stats?.full_time_count ?? (stats.active_employees || 0)} Full-Time {stats.workforce_stats?.intern_count ? `· ${stats.workforce_stats.intern_count} Intern` : ''}
              </strong>
            </div>
          </div>
        </section>

        {/* Right: Weekly Punch Telemetry */}
        <section className="exec-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="exec-panel-head">
            <div>
              <span className="exec-kicker">Weekly Attendance Trend</span>
              <h2>Punches & Velocity</h2>
            </div>
            <button className="exec-select text-xs font-bold text-blue-600 dark:text-blue-400" onClick={() => navigate('/attendance')}>
              This Week <ChevronRight size={14} />
            </button>
          </div>

          <div className="exec-bars">
            {[78, 88, 84, 95, 92, 60, 52].map((height, i) => (
              <div className="exec-bar-col" key={i}>
                <div className="exec-bar" style={{ height: `${height}%` }} />
                <span>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
              </div>
            ))}
          </div>

          <div className="exec-mini-stats">
            <span>
              <b>{presentEmployees.length}</b>Present
            </span>
            <span>
              <b className="red">{absentEmployees.length}</b>Absent
            </span>
            <span>
              <b className="purple">{stats.on_leave_today || 0}</b>On leave
            </span>
            <span>
              <b className="cyan">{wfhEmployees.length}</b>WFH
            </span>
          </div>
        </section>
      </div>

      {/* ── 5. GOVERNANCE & APPROVALS CENTER (INBOX ZERO PARADIGM) ── */}
      <section className="exec-panel exec-approvals-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
        <div className="exec-panel-head">
          <div className="exec-panel-head-left">
            <span className="exec-kicker">Governance & Decisions</span>
            <div className="exec-panel-title-row">
              <h2>Approvals Command Center</h2>
              {totalPending > 0 ? (
                <span className="approvals-head-pill pending">
                  <span className="pulse-dot" />
                  {totalPending} Action{totalPending > 1 ? 's' : ''} Required
                </span>
              ) : (
                <span className="approvals-head-pill clear">
                  <CheckCircle2 size={13} />
                  Inbox Zero · All Clear
                </span>
              )}
            </div>
          </div>
          <div className="exec-panel-head-right">
            {totalPending > 0 && (
              <button
                className="exec-btn exec-btn-approve"
                disabled={approveAllBusy}
                onClick={handleApproveAll}
                style={{ padding: '8px 14px', fontSize: '13px' }}
              >
                {approveAllBusy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve All
              </button>
            )}
            <button
              className="exec-link text-xs font-bold text-blue-600 dark:text-blue-400"
              onClick={() => navigate('/activity-logs')}
              title="View approval history & audit log"
            >
              <span>Audit History</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {actionError && <div className="exec-action-error">{actionError}</div>}

        {/* 4 Modular Channels */}
        <div className="approvals-channels-grid">
          {approvalTypes.map((type) => {
            const isSelected = openApproval === type.key
            const IconComp = type.Icon
            return (
              <div
                key={type.key}
                className={`approvals-channel-card tone-${type.tone} ${isSelected ? 'selected' : ''}`}
                onClick={() => setOpenApproval(isSelected ? null : type.key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setOpenApproval(isSelected ? null : type.key)
                }}
              >
                <div className="approvals-card-top">
                  <span className="approvals-card-icon-wrap">
                    <IconComp size={18} />
                  </span>
                  {type.count > 0 ? (
                    <span className="approvals-card-pill pending">
                      <span className="pulse-dot" />
                      {type.count} Pending
                    </span>
                  ) : (
                    <span className="approvals-card-pill clear">
                      <Check size={11} />
                      Clear
                    </span>
                  )}
                </div>

                <div className="approvals-card-info">
                  <h4>{type.label}</h4>
                  <p>{type.desc}</p>
                </div>

                <div className="approvals-card-action">
                  <span className="approvals-card-trigger">
                    {type.count > 0
                      ? isSelected
                        ? 'Hide Queue'
                        : `Review (${type.count})`
                      : isSelected
                      ? 'Close'
                      : 'Inspect Queue'}
                    <ChevronRight size={13} className={`approvals-card-arrow ${isSelected ? 'open' : ''}`} />
                  </span>
                  <button
                    type="button"
                    className="approvals-card-manage-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(type.manage)
                    }}
                    title={`Open ${type.label} page`}
                  >
                    Manage &rarr;
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Expanded Queue for Selected Channel */}
        {openApproval && activeApprovalType && (
          <div className="approvals-expansion-panel">
            <div className="approvals-expansion-head">
              <div className="approvals-expansion-title">
                <span className={`approvals-expansion-icon tone-${activeApprovalType.tone}`}>
                  <activeApprovalType.Icon size={18} />
                </span>
                <div>
                  <h3>{activeApprovalType.label} Queue</h3>
                  <p>
                    {activeApprovalType.count > 0
                      ? `${activeApprovalType.count} pending request${activeApprovalType.count > 1 ? 's' : ''} awaiting administrative decision`
                      : 'All requests in this channel have been resolved'}
                  </p>
                </div>
              </div>
              <div className="approvals-expansion-controls">
                <button
                  type="button"
                  className="approvals-direct-page-btn"
                  onClick={() => navigate(activeApprovalType.manage)}
                >
                  Go to {activeApprovalType.shortLabel} Manager <ArrowRight size={13} />
                </button>
                <button
                  type="button"
                  className="approvals-close-panel-btn"
                  onClick={() => setOpenApproval(null)}
                  title="Close queue"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {activeApprovalType.list.length === 0 ? (
              <div className="approvals-channel-empty">
                <div className="approvals-empty-icon">
                  <CheckCircle2 size={30} className="text-emerald-500" />
                </div>
                <div className="approvals-empty-text">
                  <h4>No pending {activeApprovalType.label.toLowerCase()} requests</h4>
                  <p>All employee requests in this category are up to date and resolved.</p>
                </div>
                <button
                  type="button"
                  className="exec-link text-xs font-bold text-blue-600"
                  onClick={() => navigate(activeApprovalType.manage)}
                >
                  View past {activeApprovalType.shortLabel.toLowerCase()} records &rarr;
                </button>
              </div>
            ) : (
              <div className="approvals-cards-grid">
                {activeApprovalType.list.map((item) => renderApprovalItem(activeApprovalType.key, item))}
              </div>
            )}
          </div>
        )}

        {/* Zero-Pending Governance Strip (Shown when no channel is open) */}
        {!openApproval && (
          <div className="approvals-console-strip">
            <div className="approvals-console-card">
              <div className="approvals-console-icon tone-emerald">
                <ShieldCheck size={20} />
              </div>
              <div className="approvals-console-body">
                <strong>All Queues Synchronized</strong>
                <span>Zero blocking bottlenecks across WFH, leaves, late check-ins, and breaks.</span>
              </div>
            </div>

            <div className="approvals-console-card">
              <div className="approvals-console-icon tone-blue">
                <Bell size={20} />
              </div>
              <div className="approvals-console-body">
                <strong>Real-Time Policy Verification</strong>
                <span>New employee submissions notify HR instantly with fast single-click decisions.</span>
              </div>
            </div>

            <div className="approvals-console-card">
              <div className="approvals-console-icon tone-purple">
                <FileText size={20} />
              </div>
              <div className="approvals-console-body">
                <strong>Compliance & Audit Logging</strong>
                <span>All decisions are immutably logged with timestamp and author.</span>
              </div>
              <button
                type="button"
                className="approvals-console-btn"
                onClick={() => navigate('/activity-logs')}
              >
                View Log &rarr;
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 6. SIDE-BY-SIDE: RECENT TECH ONBOARDINGS & CULTURE MILESTONES ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Recent Tech Onboardings */}
        <section className="exec-panel p-6 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <span className="exec-kicker">Talent Pipeline</span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Recent Tech Onboardings</h3>
            </div>
            <button
              type="button"
              onClick={() => navigate('/employees')}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              Directory <ChevronRight size={14} />
            </button>
          </div>

          {recentHires.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No recent onboardings in the current quarter.
            </div>
          ) : (
            <div className="space-y-3">
              {recentHires.slice(0, 4).map((h, i) => (
                <div
                  key={h._id || h.id || i}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 transition-all hover:bg-slate-100 dark:hover:bg-slate-800/80"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
                      {avatarSrc(h.profile_image) ? (
                        <img src={avatarSrc(h.profile_image)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(h.name)
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {h.name}
                        {h.employee_code && (
                          <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                            #{h.employee_code}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {h.designation || 'Engineer'} · {h.department || 'Tech'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                      Joined {fmtShortDate(h.joining_date) || 'Recent'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right: Team Birthdays & Culture Pulse */}
        <section className="exec-panel p-6 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <span className="exec-kicker">Culture & Milestones</span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Upcoming Team Birthdays</h3>
            </div>
            <button
              type="button"
              onClick={() => navigate('/holidays')}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              Holidays <ChevronRight size={14} />
            </button>
          </div>

          {upcomingBirthdays.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No birthdays in the next 30 days.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingBirthdays.slice(0, 3).map((b, i) => (
                <div
                  key={b.id || i}
                  className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-sm shrink-0">
                      <Cake size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {b.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {b.designation || 'Team Member'} · {b.department || 'Tech'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                      <Cake size={11} className="shrink-0" />
                      <span>{b.bday_md ? `Birthday on ${b.bday_md}` : 'Upcoming'}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Daily Sprint Motivation */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 italic">
            <Sparkles className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              "{dailyInspiration}"
              <span className="block not-italic text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">
                Engineering Culture Pulse
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* ── 7. LIVE ACTIVITY STREAM & SHORTCUT TOOLS ── */}
      <div className="exec-grid exec-grid-bottom">
        {/* Live Activity Feed */}
        <section className="exec-panel exec-activity-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="exec-panel-head">
            <div>
              <span className="exec-kicker">Audit Trail Stream</span>
              <h2>Real-Time Activity Log</h2>
            </div>
            <button className="exec-link text-xs font-bold text-blue-600 dark:text-blue-400" onClick={() => navigate('/activity-logs')}>
              Full Log <ChevronRight size={14} />
            </button>
          </div>
          {activityLoading && activityLogs.length === 0 ? (
            <div className="exec-activity-empty">Loading real-time audit stream…</div>
          ) : activityLogs.length === 0 ? (
            <div className="exec-activity-empty">No recent activity events recorded.</div>
          ) : (
            <div className="exec-activity-list">
              {activityLogs.slice(0, 5).map((log) => {
                const ItemIcon = activityIcon(log)
                return (
                  <div key={log.id} className="exec-activity-item">
                    <span className={`exec-activity-icon ${log.type || 'info'}`}>
                      <ItemIcon size={15} />
                    </span>
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
        </section>

        {/* Quick Actions & Module Shortcuts */}
        <section className="exec-panel exec-quick-panel p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 shadow-lg">
          <div className="exec-panel-head">
            <div>
              <span className="exec-kicker">Command Center</span>
              <h2>Quick Actions</h2>
            </div>
            <button className="exec-link text-xs font-bold text-blue-600 dark:text-blue-400" onClick={() => navigate('/employees')}>
              All Modules <ChevronRight size={14} />
            </button>
          </div>

          <div className="exec-actions">
            {[
              { icon: Users, label: 'Employees', sub: 'Directory & records', path: '/employees', color: 'indigo' },
              { icon: Clock3, label: 'Attendance', sub: 'Biometric punches', path: '/attendance', color: 'emerald' },
              { icon: FileText, label: 'Leave Requests', sub: 'Governance & PTO', path: '/leaves', color: 'amber' },
              ...(!isViyana ? [{ icon: Building2, label: 'Departments', sub: 'Tech squads', path: '/departments', color: 'violet' }] : []),
              { icon: Laptop, label: 'WFH Requests', sub: 'Remote workforce', path: '/wfh', color: 'cyan' },
              { icon: BriefcaseBusiness, label: 'Payroll', sub: 'Slips & salaries', path: '/payroll', color: 'rose' },
            ].map(({ icon: Icon, label, sub, path, color }) => (
              <button
                key={label}
                type="button"
                className="exec-action-btn"
                onClick={() => navigate(path)}
              >
                <span className={`exec-action-icon ${color}`}>
                  <Icon size={17} />
                </span>
                <div className="exec-action-text">
                  <span className="exec-action-label">{label}</span>
                  <span className="exec-action-desc">{sub}</span>
                </div>
                <ChevronRight size={14} className="exec-action-arrow" />
              </button>
            ))}
          </div>

          {/* Quick System Utilities */}
          <div className="exec-quick-footer">
            <div className="exec-quick-footer-title">System Utilities</div>
            <div className="exec-quick-tools-grid">
              <button
                type="button"
                className="exec-quick-tool-chip"
                onClick={() => navigate('/holidays')}
              >
                <CalendarDays size={14} />
                <span>Holiday Calendar</span>
              </button>
              <button
                type="button"
                className="exec-quick-tool-chip"
                onClick={() => navigate('/activity-logs')}
              >
                <ShieldCheck size={14} />
                <span>Audit Trail</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ── 8. KPI DETAIL LIST MODAL (DRILL DOWN) ── */}
      {activeKpiModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15,23,42,0.65)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
              padding: '20px',
              boxSizing: 'border-box',
            }}
            onClick={() => setActiveKpiModal(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '640px',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                borderRadius: '24px',
                boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 'calc(100vh - 60px)',
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '20px 24px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: 'var(--text)',
                    }}
                  >
                    {activeKpiModal.title}
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 9px',
                        borderRadius: 99,
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        fontWeight: 800,
                      }}
                    >
                      {filteredModalList.length}
                    </span>
                  </h2>
                  <small style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                    {activeKpiModal.subtitle}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveKpiModal(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search Input */}
              <div
                style={{
                  padding: '12px 24px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                }}
              >
                <div style={{ position: 'relative' }}>
                  <Search
                    size={15}
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    placeholder="Search by engineer name, code, designation, or squad..."
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 14px 9px 36px',
                      borderRadius: '12px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    autoFocus
                  />
                  {modalSearch && (
                    <button
                      type="button"
                      onClick={() => setModalSearch('')}
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Employee list scroll */}
              <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredModalList.length === 0 ? (
                  <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
                    No team members found matching your search.
                  </div>
                ) : (
                  filteredModalList.map((emp, i) => {
                    const empName = emp.name || emp.employee_name || 'Team Member'
                    const empCode = emp.employee_code ? `#${emp.employee_code}` : ''
                    const empDept = emp.department || 'Tech Operations'
                    const empDesig = emp.designation || 'Engineer'
                    const imgSrc = avatarSrc(emp.profile_image)

                    return (
                      <div
                        key={emp.id || emp.employee_id || i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          borderRadius: '14px',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: '10px',
                              background: 'var(--primary-soft)',
                              color: 'var(--primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: '14px',
                              overflow: 'hidden',
                              flexShrink: 0,
                            }}
                          >
                            {imgSrc ? (
                              <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              initialsOf(empName)
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
                              {empName}
                              {empCode && (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 6, fontWeight: 600 }}>
                                  {empCode}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                              {empDesig} · {empDept}
                            </div>
                          </div>
                        </div>

                        {/* Status Badges on right */}
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          {emp.check_in && (
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>
                              In: {String(emp.check_in).slice(0, 5)}
                            </div>
                          )}

                          {emp.break_type && (
                            <span
                              style={{
                                fontSize: '10.5px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 99,
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#d97706',
                              }}
                            >
                              {breakTypeLabel(emp)}
                            </span>
                          )}

                          {emp.work_mode && (
                            <span
                              style={{
                                fontSize: '10.5px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 99,
                                background:
                                  emp.work_mode === 'wfh'
                                    ? 'rgba(6, 182, 212, 0.15)'
                                    : 'rgba(99, 102, 241, 0.15)',
                                color: emp.work_mode === 'wfh' ? '#06b6d4' : '#6366f1',
                              }}
                            >
                              {emp.work_mode === 'wfh' ? 'WFH' : 'HQ FLOOR'}
                            </span>
                          )}

                          {activeKpiModal.type === 'absent' && (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 99,
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: 'var(--danger)',
                              }}
                            >
                              Absent
                            </span>
                          )}

                          {activeKpiModal.type === 'wfh' && emp.reason && (
                            <div
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {emp.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
