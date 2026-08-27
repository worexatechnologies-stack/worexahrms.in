import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast, useSound } from '../../App'
import { timeToSecs } from '../../utils/attendanceHelpers'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import { useTabLock } from '../../hooks/useTabLock'
import { playWelcomeSound } from '../../utils/audioHelper'
import {
  useGetDashboardQuery,
  useGetActivityLogsQuery,
  useDecideLateCheckinMutation,
  useDecideBreakMutation,
  useExtendBreakMutation,
  useApproveAllBreaksMutation
} from '../../store/apiSlice'
import {
  Calendar, Utensils, RefreshCw, Coffee,
  ChevronLeft, ChevronRight, Bell, Search, X,
  Users, UserCheck, UserX, AlertTriangle, FileText, Cake,
} from 'lucide-react'

/* ── MUI core ── */
import { createTheme, ThemeProvider } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Typography from '@mui/material/Typography'
import Avatar from '@mui/material/Avatar'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'

/* ── MUI X Charts ── */
import { BarChart } from '@mui/x-charts/BarChart'

/* ══════════════  MUI Theme ══════════════ */
const BRAND       = '#2563eb'
const BRAND_GREEN = '#2563eb'
const BRAND_LATE  = '#f59e0b'
const BRAND_ABSENT= '#f43f5e'
const BRAND_INFO  = '#0ea5e9'
const BREAK_MINUTE_OPTIONS = [10, 20, 30, 45, 50, 60]

const muiTheme = createTheme({
  palette: {
    primary: { main: '#2563eb', contrastText: '#fff' },
    success: { main: '#10b981' },
    warning: { main: '#f59e0b' },
    error:   { main: '#f43f5e' },
    info:    { main: '#0ea5e9' },
  },
  typography: {
    fontFamily: "'Inter', 'Outfit', sans-serif",
  },
  shape: { borderRadius: 24 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          borderRadius: 24,
          transition: 'all 0.3s ease',
          '&:hover': { boxShadow: 'var(--shadow-md)', transform: 'translateY(-2px)' },
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: { padding: '20px 24px 10px' },
        title: { fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em' },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: '0 24px 20px', '&:last-child': { paddingBottom: 20 } },
      },
    },
  },
})

/* ── helpers ── */
function alertMessage(message) {
  if (!message) return ''
  const parts = message.split('; ')
  return parts.length > 1 ? parts[parts.length - 1] : message
}
function alertDecision(message) {
  return message?.match(/;decision=([^;]+)/)?.[1] || ''
}
function getLunchLateStartText(req, cfg) {
  if (req.request_type !== 'lunch_break') return ''
  const lateMins = Math.max(0, Math.ceil(
    (timeToSecs(req.request_time?.slice(0, 5)) - timeToSecs(cfg.lunch_start || '13:30')) / 60
  ))
  return lateMins > 0 ? ` (${lateMins} min late)` : ''
}
function fmtDateLabel(dateStr) {
  if (typeof dateStr !== 'string' || !dateStr) return ''
  const d = new Date(dateStr.replace(' ', 'T'))
  if (isNaN(d)) return dateStr.slice(0, 10)
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const day = new Date(d); day.setHours(0,0,0,0)
  if (day.getTime() === today.getTime()) return 'Today'
  if (day.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtTime12(dateStr) {
  if (typeof dateStr !== 'string' || !dateStr) return ''
  const d = new Date(dateStr.replace(' ', 'T'))
  if (isNaN(d)) return dateStr.slice(11, 16)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function groupByDay(alerts) {
  const map = {}
  alerts.forEach(n => {
    const raw = n?.created_at
    const day = typeof raw === 'string' ? raw.slice(0, 10) : ''
    if (!map[day]) map[day] = []
    map[day].push(n)
  })
  return map
}

function employeePhotoUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
  const cleanPath = String(path).replace(/^\/+/, '')
  const cleanBase = String('/api').replace(/\/+$/, '')
  return `${cleanBase}/${cleanPath}`
}

const ALERTS_PER_PAGE = 20

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton-page">
      <div className="dashboard-skeleton-stats">
        {[1, 2, 3, 4].map(item => (
          <div key={item} className="dashboard-skeleton-card">
            <span className="dashboard-skeleton dashboard-skeleton-title" />
            <span className="dashboard-skeleton dashboard-skeleton-value" />
          </div>
        ))}
      </div>
      <div className="dashboard-skeleton-card">
        <span className="dashboard-skeleton dashboard-skeleton-title" />
        <div className="dashboard-skeleton dashboard-skeleton-chart" />
      </div>
      <div className="dashboard-skeleton-stats">
        <div className="dashboard-skeleton-card">
          <span className="dashboard-skeleton dashboard-skeleton-line wide" />
          <span className="dashboard-skeleton dashboard-skeleton-line" />
        </div>
        <div className="dashboard-skeleton-card">
          <span className="dashboard-skeleton dashboard-skeleton-line wide" />
          <span className="dashboard-skeleton dashboard-skeleton-line" />
        </div>
      </div>
    </div>
  )
}

/* ══ Stat Card ══ */
function StatCard({ icon, value, label, color, iconBg }) {
  return (
    <Card className="hr-stat-card" sx={{ flex: { xs: '1 1 calc(50% - 8px)', sm: '1 1 220px' }, minWidth: { xs: 'calc(50% - 8px)', sm: 220 } }}>
      <CardContent className="hr-stat-card-content" sx={{ display: 'flex', alignItems: 'center', gap: 2, p: '18px 20px !important' }}>
        <Box sx={{
          width: 52, height: 52, borderRadius: 3,
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Box sx={{ color, fontSize: 0, display: 'flex' }}>{icon}</Box>
        </Box>
        <Box className="hr-stat-copy" sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
            {value}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 500, mt: 0.4, color: 'var(--text-secondary)', lineHeight: 1.25 }}>
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

function getLeaveDateParams(range) {
  const today = new Date()
  const offset = today.getTimezoneOffset()
  const localToday = new Date(today.getTime() - (offset * 60 * 1000))
  const toStr = localToday.toISOString().slice(0, 10)

  if (range === 'day') {
    return { date: toStr }
  } else if (range === 'week') {
    const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000 - (offset * 60 * 1000))
    return { from: past.toISOString().slice(0, 10), to: toStr }
  } else if (range === 'month') {
    const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000 - (offset * 60 * 1000))
    return { from: past.toISOString().slice(0, 10), to: toStr }
  } else if (range === 'year') {
    const past = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000 - (offset * 60 * 1000))
    return { from: past.toISOString().slice(0, 10), to: toStr }
  }
  return {} // 'all'
}

function getLeaveRangeLabel(range) {
  switch (range) {
    case 'day': return 'Today'
    case 'week': return 'This Week'
    case 'month': return 'This Month'
    case 'year': return 'This Year'
    case 'all': return 'All Time'
    default: return ''
  }
}

export default function HrDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  
  const [alertDate,       setAlertDate]      = useState('')
  const [alertPage,       setAlertPage]      = useState(1)
  const [actioningAlert,  setActioningAlert] = useState(null)
  const [breakTimers,     setBreakTimers]    = useState({})
  const [showWelcome,     setShowWelcome]    = useState(false)
  const [attendanceRange, setAttendanceRange] = useState('month')
  const [leaveRange,      setLeaveRange]     = useState('month')
  const [activityQueryEnabled, setActivityQueryEnabled] = useState(false)
  const lazyActivityRef = useRef(null)
  const lazyLeaveChartRef = useRef(null)

  const [extendBreakModal, setExtendBreakModal] = useState(false)
  const [selectedBreakSess, setSelectedBreakSess] = useState(null)
  const [extensionMinutes, setExtensionMinutes] = useState(10)
  const [extensionReason, setExtensionReason] = useState('')
  const isPollLeader = useTabLock(user?.id)
  const dashboardPollingInterval = useVisibilityPolling(isPollLeader ? 60000 : 0)

  useEffect(() => {
    if (extendBreakModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [extendBreakModal])

  // ----- RTK Query Hooks -----
  const { data: dashboardRes, isLoading: loading } = useGetDashboardQuery({ range: attendanceRange }, {
    pollingInterval: dashboardPollingInterval,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })
  const stats = dashboardRes?.data

  const leaveParams = useMemo(() => getLeaveDateParams(leaveRange), [leaveRange])
  const activityParams = useMemo(() => ({
    per_page: ALERTS_PER_PAGE,
    page: alertPage,
    ...(alertDate ? { date: alertDate } : {}),
    ...(leaveParams.date ? { leave_date: leaveParams.date } : {}),
    ...(leaveParams.from ? { leave_from: leaveParams.from } : {}),
    ...(leaveParams.to ? { leave_to: leaveParams.to } : {}),
  }), [alertDate, alertPage, leaveParams])
  const {
    data: alertsRes,
    isFetching: alertsLoading,
    isUninitialized: activityUninitialized,
    refetch: reloadAlerts
  } = useGetActivityLogsQuery(activityParams, {
    skip: !activityQueryEnabled,
  })
  const leaveChartSummary = alertsRes?.data?.leave_summary || null

  const [decideLateCheckinApi] = useDecideLateCheckinMutation()
  const [decideBreakApi] = useDecideBreakMutation()
  const [extendBreakApi] = useExtendBreakMutation()
  const [approveAllBreaksApi] = useApproveAllBreaksMutation()

  const handleExtendBreakSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!selectedBreakSess) return
    try {
      await extendBreakApi({
        employee_id: selectedBreakSess.employee_id,
        extension_minutes: Number(extensionMinutes),
        extension_reason: extensionReason
      }).unwrap()
      toast('Break extended successfully.', 'success')
      setExtendBreakModal(false)
      setExtensionReason('')
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to extend break', 'error')
    }
  }

  const d = alertsRes?.data
  const alerts = d?.logs || []
  const alertPagination = d?.pagination || null
  const isActivityLoading = activityUninitialized || (alertsLoading && alerts.length === 0)
  const leaveChartLoading = activityUninitialized || (alertsLoading && !leaveChartSummary)

  const { soundEnabled } = useSound()



  useEffect(() => {
    if (!sessionStorage.getItem('hr_welcome_played')) {
      sessionStorage.setItem('hr_welcome_played', 'true')
      setShowWelcome(true)
      const welcomeTimer = window.setTimeout(() => {
        if (soundEnabled) playWelcomeSound()
      }, 300)
      return () => window.clearTimeout(welcomeTimer)
    }
  }, [soundEnabled])

  useEffect(() => {
    if (!stats || activityQueryEnabled) return undefined
    const targets = [lazyLeaveChartRef.current, lazyActivityRef.current].filter(Boolean)
    if (targets.length === 0) return undefined

    if (!('IntersectionObserver' in window)) {
      const timer = window.setTimeout(() => setActivityQueryEnabled(true), 300)
      return () => window.clearTimeout(timer)
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setActivityQueryEnabled(true)
        observer.disconnect()
      }
    }, { rootMargin: '180px 0px' })

    targets.forEach(target => observer.observe(target))
    return () => observer.disconnect()
  }, [activityQueryEnabled, stats])

  const applyDateFilter = (date) => {
    setActivityQueryEnabled(true)
    setAlertDate(date); setAlertPage(1)
  }
  const clearDateFilter = () => applyDateFilter('')
  const handleReloadAlerts = () => {
    if (!activityQueryEnabled) {
      setActivityQueryEnabled(true)
      return
    }
    reloadAlerts()
  }

  const decideLateCheckin = async (alert, decision) => {
    setActioningAlert(alert.id)
    try {
      await decideLateCheckinApi({ action: decision, notificationId: alert.id }).unwrap()
    } catch {}
    setActioningAlert(null)
  }

  const decideRequest = async (request, decision, durationMinutes, extendMinutes) => {
    setActioningAlert(`request-${request.id}`)
    try {
      const body = { request_id: request.id }
      if (decision === 'approve') {
        if (durationMinutes != null) body.duration_minutes = durationMinutes
        if (durationMinutes != null) body.approved_minutes = durationMinutes
        if (extendMinutes   != null) body.extend_minutes   = extendMinutes
        if (extendMinutes   != null) body.approved_minutes = extendMinutes
      }
      await decideBreakApi({ action: decision, body }).unwrap()
    } catch {}
    setActioningAlert(null)
  }

  const approveAllBreakRequests = async () => {
    setActioningAlert('approve-all-breaks')
    try {
      const res = await approveAllBreaksApi({}).unwrap()
      toast(res.message || 'Pending break requests approved.', 'success')
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to approve break requests', 'error')
    } finally {
      setActioningAlert(null)
    }
  }

  if (loading) return <DashboardSkeleton />

  /* ── data prep ── */
  const mStats          = stats?.monthly_stats || []
  const pendingRequests = stats?.pending_break_requests || []
  
  const leavePending = leaveChartSummary?.pending || 0
  const leaveApproved = leaveChartSummary?.approved || 0
  const leaveRejected = leaveChartSummary?.rejected || 0
  const leaveTotal = leavePending + leaveApproved + leaveRejected

  const totalAlertPages = alertPagination ? alertPagination.pages : 1
  const totalAlerts = alertPagination ? alertPagination.total : alerts.length
  const visibleAlertStart = alerts.length ? ((alertPage - 1) * ALERTS_PER_PAGE) + 1 : 0
  const visibleAlertEnd = Math.min(alertPage * ALERTS_PER_PAGE, totalAlerts)
  const groupedAlerts   = groupByDay(alerts)
  const dayKeys         = Object.keys(groupedAlerts).sort((a, b) => b.localeCompare(a))

  const attendanceChartData = stats?.attendance_chart?.length
    ? stats.attendance_chart.map(item => {
        const present = parseInt(item.present) || 0
        const late = parseInt(item.late) || 0
        const absent = parseInt(item.absent) || 0
        return {
          month: item.label || item.month || '',
          value: present,
          total: present + late + absent,
        }
      })
    : mStats.length
      ? mStats.slice(-8).map(m => {
          const present = parseInt(m.present) || 0
          const late = parseInt(m.late) || 0
          const absent = parseInt(m.absent) || 0
          return {
            month: m.month ? m.month.slice(5) : '',
            value: present,
            total: present + late + absent,
          }
        })
      : [
          { month: 'Jan', value: 18, total: 22 },
          { month: 'Feb', value: 21, total: 24 },
          { month: 'Mar', value: 19, total: 23 },
          { month: 'Apr', value: 23, total: 25 },
          { month: 'May', value: 24, total: 26 },
          { month: 'Jun', value: 22, total: 25 },
        ]
  const attendanceMax = Math.max(1, ...attendanceChartData.map(item => Math.max(item.value, item.total)))
  const attendanceAxis = [attendanceMax, Math.round(attendanceMax * 0.75), Math.round(attendanceMax * 0.5), Math.round(attendanceMax * 0.25)]
  const linePoints = attendanceChartData.map((item, index) => {
    const x = 54 + index * (592 / Math.max(1, attendanceChartData.length - 1))
    const y = 188 - (item.total / attendanceMax) * 142
    return `${x},${y}`
  }).join(' ')

  return (
    <ThemeProvider theme={muiTheme}>
      <div className="dashboard-command-center hr-command-center">
        <section className="dashboard-command-header">
          <div>
            <span className="dashboard-eyebrow">HRMS</span>
            <h2>Dashboard</h2>
            <p>Welcome back, {user?.name?.split(' ')[0] || 'HR Manager'}!</p>
          </div>
          <div className="dashboard-command-date"><Calendar size={18} /><span>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
        </section>
      {/* ── Welcome banner ── */}

      {showWelcome && (
        <div className="welcome-hero welcome-fade-in">
          <div className="welcome-hero-content">
            <h1 className="welcome-hero-title">Welcome back, {user?.name?.split(' ')[0] || 'HR Manager'}!</h1>
            <p className="welcome-hero-subtitle">Here is the snapshot of today's activities.</p>
          </div>
          <div className="welcome-hero-date">
            <div className="welcome-hero-date-icon"><Calendar size={18} strokeWidth={2.5} color="#fff" /></div>
            <div className="welcome-hero-date-text">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Requests (Pinned Top) ── */}
      {pendingRequests.length > 0 && (
        <Card sx={{ mb: 2, background: 'var(--surface)', border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)' }}>
          <CardHeader
            title="Pending Requests"
            action={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-success"
                  onClick={approveAllBreakRequests}
                  disabled={actioningAlert === 'approve-all-breaks'}
                >
                  Approve All
                </button>
                <Box sx={{ bgcolor: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 11, fontWeight: 700, px: 1.2, py: 0.3, borderRadius: 2 }}>
                  {pendingRequests.length} pending
                </Box>
              </Stack>
            }
            sx={{ '& .MuiCardHeader-action': { alignSelf: 'center', mt: 0 }, '& .MuiCardHeader-title': { color: 'var(--text)', fontSize: '15px', fontWeight: '700' } }}
          />
          <CardContent sx={{ pt: '8px !important' }}>
              <div className="pending-request-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {pendingRequests.map(req => {
                  const requestBreakType = req.break_type || (req.request_type === 'break' ? 'manual' : req.request_type === 'lunch_break' ? 'lunch' : req.request_type === 'evening_break' ? 'evening' : req.request_type)
                  const selectedDur = breakTimers[req.id] ?? req.requested_minutes ?? 30
                  const isActioning = actioningAlert === `request-${req.id}`
                  const cfg         = stats?.attendance_settings || {}
                  return (
                    <div key={req.id} className="alert-item break-request-item" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                      <div className="notif-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '8px' }}>
                        {req.request_type === 'meeting'       ? <Calendar size={14} />
                          : requestBreakType === 'lunch'  ? <Utensils size={14} />
                          : req.request_type === 'checkout_undo'? <RefreshCw size={14} />
                          : <Coffee size={14} />}
                        <span style={{ fontWeight: '600' }}>
                          {req.request_type === 'meeting'       ? 'Meeting Request'
                            : requestBreakType === 'lunch'  ? 'Lunch Extension Request'
                            : requestBreakType === 'evening' ? 'Evening Extension Request'
                            : req.request_type === 'checkout_undo'? 'Check-Out Undo'
                            : 'Manual Break Request'}
                        </span>
                      </div>
                      <div className="alert-message" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.4' }}>
                        {req.request_type === 'checkout_undo'
                          ? <><strong>{req.employee_name}</strong> requested to undo check-out</>
                          : req.request_type === 'meeting'
                          ? <><strong>{req.employee_name}</strong> requested a meeting at {req.request_time?.slice(0, 5)}{req.reason ? <>. Reason: {req.reason}</> : null}</>
                          : <><strong>{req.employee_name}</strong> requested {req.requested_minutes || selectedDur} minutes at {req.request_time?.slice(0, 5)}{getLunchLateStartText(req, cfg)}{req.reason ? <>. Reason: {req.reason}</> : null}</>}
                      </div>
                      {(requestBreakType === 'lunch' || requestBreakType === 'evening') && (
                        <div style={{ marginTop: 8, marginBottom: 12 }}>
                           <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 500 }}>Approve extra time:</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {BREAK_MINUTE_OPTIONS.map(min => (
                              <button key={min} type="button"
                                className={`break-preset-btn${selectedDur === min ? ' active' : ''}`}
                                onClick={() => setBreakTimers(p => ({ ...p, [req.id]: min }))}
                                disabled={isActioning}>{min === 60 ? '1 hour' : `${min}m`}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {requestBreakType === 'manual' && (
                        <div className="break-timer-row" style={{ marginBottom: 12 }}>
                          <span className="break-timer-label">Duration:</span>
                          <div className="break-timer-presets">
                            {BREAK_MINUTE_OPTIONS.map(min => (
                              <button key={min}
                                className={`break-preset-btn${selectedDur === min ? ' active' : ''}`}
                                onClick={() => setBreakTimers(p => ({ ...p, [req.id]: min }))}
                                disabled={isActioning}>{min === 60 ? '1 hour' : `${min}m`}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="alert-actions" style={{ display: 'flex', gap: '8px' }}>
                        {requestBreakType === 'lunch' || requestBreakType === 'evening' ? (
                          <button className="btn btn-sm btn-success" disabled={isActioning} onClick={() => decideRequest(req, 'approve', selectedDur, selectedDur)} style={{ flex: 1, justifyContent: 'center' }}>Approve ({selectedDur}m)</button>
                        ) : requestBreakType === 'manual' ? (
                          <button className="btn btn-sm btn-success" disabled={isActioning} onClick={() => decideRequest(req, 'approve', selectedDur, undefined)} style={{ flex: 1, justifyContent: 'center' }}>
                            Approve ({selectedDur}m)
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-success" disabled={isActioning} onClick={() => decideRequest(req, 'approve')} style={{ flex: 1, justifyContent: 'center' }}>Approve</button>
                        )}
                        <button className="btn btn-sm btn-danger" disabled={isActioning} onClick={() => decideRequest(req, 'reject')} style={{ flex: 1, justifyContent: 'center' }}>Reject</button>
                      </div>
                    </div>
                  )
                })}
              </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stat cards ── */}
      <Stack className="hr-stats-row" direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <StatCard icon={<Users size={22} />}         value={stats?.total_employees || 0}  label="Total Employees" color={BRAND}        iconBg="rgba(242,106,0,0.12)" />
        <StatCard icon={<UserCheck size={22} />}     value={stats?.active_employees || 0} label="Present Today"    color={BRAND_GREEN}  iconBg="rgba(34,197,94,0.12)" />
        <StatCard icon={<AlertTriangle size={22} />} value={stats?.late_today || 0}       label="On Leave / Late"   color={BRAND_LATE}   iconBg="rgba(245,158,11,0.12)" />
        <StatCard icon={<UserX size={22} />}         value={stats?.absent_today?.length || 0} label="Absent Today"     color={BRAND_ABSENT} iconBg="rgba(244,63,94,0.12)" />
        <StatCard icon={<FileText size={22} />}      value={stats?.pending_leaves || 0}   label="Pending Leaves"    color={BRAND_INFO}   iconBg="rgba(14,165,233,0.12)" />
      </Stack>

      {/* ── Row 2: Bar Chart + Recent Hires ── */}
      <Card className="hr-absent-card" sx={{ mb: 2, borderLeft: '4px solid var(--danger)' }}>
        <CardHeader
          title="Absent Today"
          action={
            <Box sx={{ color: 'var(--danger)', fontSize: 12, fontWeight: 700, px: 1.2, py: 0.35, borderRadius: 2, bgcolor: 'rgba(244,63,94,0.1)' }}>
              {stats?.absent_today?.length || 0} absent
            </Box>
          }
          sx={{ '& .MuiCardHeader-action': { alignSelf: 'center', mt: 0 }, '& .MuiCardHeader-title': { color: 'var(--text)', fontSize: '15px', fontWeight: '700' } }}
        />
        <CardContent sx={{ pt: '8px !important' }}>
          {stats?.absent_today?.length ? (
            <Stack className="hr-absent-list" direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {stats.absent_today.map(employee => (
                <Box className="hr-absent-person" key={employee.employee_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.8, px: 1.1, border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--bg-secondary)' }}>
                  <Avatar sx={{ width: 28, height: 28, bgcolor: 'rgba(244,63,94,0.14)', color: 'var(--danger)', fontSize: 12, fontWeight: 800 }}>
                    {employee.name?.charAt(0)?.toUpperCase() || '?'}
                  </Avatar>
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{employee.name}</Typography>
                    {(employee.employee_code || employee.department) && (
                      <Typography sx={{ fontSize: 11, color: 'var(--text-secondary)', mt: 0.2 }}>
                        {[employee.employee_code, employee.department].filter(Boolean).join(' · ')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography sx={{ color: 'var(--text-secondary)', fontSize: 13 }}>No employees are marked absent today.</Typography>
          )}
        </CardContent>
      </Card>

      <Stack className="hr-overview-row" direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 2, minWidth: 0 }}>
          <section className="glass-revenue-dashboard glass-attendance-chart">
            <div className="glass-chart-card">
              <div className="glass-chart-header">
                <div>
                <p className="glass-chart-kicker">Attendance Overview</p>
                  <h2>{attendanceRange === 'day' ? 'Today' : attendanceRange === 'week' ? 'This Week' : 'This Month'}</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label htmlFor="attendance-range" style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>View:</label>
                  <select
                    id="attendance-range"
                    className="form-input"
                    value={attendanceRange}
                    onChange={e => setAttendanceRange(e.target.value)}
                    style={{ minWidth: 130 }}
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
              </div>

              <div className="glass-chart-plot">
                <div className="glass-chart-axis">
                  {attendanceAxis.map(value => <span key={value}>{value}d</span>)}
                </div>
                <div
                  className="glass-chart-bars"
                  style={{ '--chart-columns': attendanceChartData.length }}
                >
                  <svg className="glass-line-overlay" viewBox="0 0 700 220" preserveAspectRatio="none" aria-hidden="true">
                    <polyline points={linePoints} />
                    {attendanceChartData.map((item, index) => {
                      const x = 54 + index * (592 / Math.max(1, attendanceChartData.length - 1))
                      const y = 188 - (item.total / attendanceMax) * 142
                      return <circle key={item.month} cx={x} cy={y} r="4" />
                    })}
                  </svg>
                  {attendanceChartData.map((item, index) => (
                    <div className="glass-bar-group" key={item.month}>
                      <div className="glass-bar-value">{item.value}d</div>
                      <div
                        className={`glass-bar ${index % 2 === 0 ? 'blue' : 'teal'}`}
                        style={{ height: `${Math.max(14, (item.value / attendanceMax) * 100)}%` }}
                      />
                      <span>{item.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </Box>

        <Card sx={{ flex: 1, minWidth: 260 }}>
          <CardHeader
            title="Recent Hires"
            action={<button className="btn btn-sm btn-primary" onClick={() => navigate('/employees')}>View All</button>}
            sx={{ '& .MuiCardHeader-action': { alignSelf: 'center', mt: 0 }, '& .MuiCardHeader-title': { color: 'var(--text)' } }}
          />
          <CardContent sx={{ pt: '8px !important' }}>
            {(!stats?.recent_hires || stats.recent_hires.length === 0) ? (
              <Box sx={{ textAlign: 'center', py: 3, color: 'var(--text-muted)' }}>No recent hires</Box>
            ) : stats.recent_hires.map((emp, idx) => (
              <Box key={emp.id}>
                <Stack direction="row" spacing={1.5} sx={{ py: 1, alignItems: 'center' }}>
                  <Avatar src={employeePhotoUrl(emp.profile_image)} sx={{ width: 36, height: 36, bgcolor: '#F26A00', fontSize: 14, fontWeight: 700 }}>
                    {emp.name?.charAt(0)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                      {emp.department || '-'} &middot; {emp.joining_date}
                    </Typography>
                  </Box>
                  <Box sx={{ fontSize: 10, fontWeight: 700, color: '#F26A00', bgcolor: 'rgba(242,106,0,0.12)', px: 1, py: 0.3, borderRadius: 1, flexShrink: 0 }}>
                    {emp.employee_code}
                  </Box>
                </Stack>
                {idx < stats.recent_hires.length - 1 && <Divider sx={{ borderColor: 'var(--border)' }} />}
              </Box>
            ))}
          </CardContent>
        </Card>
      </Stack>

      {/* ── Row 3: Leave Distribution ── */}
      <Card className="hr-leave-summary-card" ref={lazyLeaveChartRef} sx={{ mb: 2 }}>
        <CardHeader
          title={
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <span style={{ color: 'var(--text)' }}>Leave Summary</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', bgcolor: 'var(--bg-secondary)', px: 1.5, py: 0.4, borderRadius: 12, border: '1px solid var(--border)' }}>
                {getLeaveRangeLabel(leaveRange)} Data
              </span>
            </Stack>
          }
          action={
            <select
              value={leaveRange}
              onChange={e => {
                setActivityQueryEnabled(true)
                setLeaveRange(e.target.value)
              }}
              className="form-input"
              style={{
                height: 36,
                padding: '0 12px',
                minWidth: 130,
                borderRadius: 8,
                fontSize: 13,
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="all">All Time</option>
            </select>
          }
          sx={{ '& .MuiCardHeader-action': { alignSelf: 'center', mt: 0 } }}
        />
        <CardContent sx={{ position: 'relative' }}>
          {leaveChartLoading ? (
            <Box className="dashboard-skeleton-panel" sx={{ height: 260 }}>
              <div className="dashboard-skeleton dashboard-skeleton-chart" />
              <div className="dashboard-skeleton-row">
                <span className="dashboard-skeleton dashboard-skeleton-pill" />
                <span className="dashboard-skeleton dashboard-skeleton-pill" />
                <span className="dashboard-skeleton dashboard-skeleton-pill" />
              </div>
            </Box>
          ) : leaveTotal === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6, color: 'var(--text-muted)' }}>
              No leave data found for {getLeaveRangeLabel(leaveRange).toLowerCase()}
            </Box>
          ) : (
            <Box sx={{ width: '100%', overflowX: 'auto', display: 'flex', justifyContent: 'center' }}>
              <BarChart
                xAxis={[{
                  scaleType: 'band',
                  data: ['Leave Distribution'],
                }]}
                series={[
                  { data: [leavePending], label: 'Pending', color: '#F59E0B' },
                  { data: [leaveApproved], label: 'Approved', color: '#22C55E' },
                  { data: [leaveRejected], label: 'Rejected', color: '#EF4444' }
                ]}
                height={260}
                margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
                slotProps={{
                  legend: {
                    direction: 'row',
                    position: { vertical: 'bottom', horizontal: 'middle' },
                  },
                }}
                sx={{
                  width: '100%',
                  maxWidth: 600,
                  '& .MuiChartsAxis-bottom .MuiChartsAxis-line': { stroke: 'var(--border)' },
                  '& .MuiChartsAxis-left .MuiChartsAxis-line': { stroke: 'var(--border)' },
                  '& .MuiChartsAxis-bottom .MuiChartsAxis-tick': { stroke: 'var(--border)' },
                  '& .MuiChartsAxis-left .MuiChartsAxis-tick': { stroke: 'var(--border)' },
                  '& .MuiChartsAxis-bottom text': { fill: 'var(--text) !important', fontWeight: 600 },
                  '& .MuiChartsAxis-left text': { fill: 'var(--text) !important', fontWeight: 600 },
                  '& .MuiChartsLegend-root text': { fill: 'var(--text) !important', fontWeight: 600 },
                }}
              />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ── Row 4: Birthdays + Pending Requests ── */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <Card sx={{
          flex: 1,
          background: 'linear-gradient(135deg, rgba(232, 64, 144, 0.06) 0%, var(--bg-card) 100%)',
          borderColor: 'rgba(232, 64, 144, 0.15)',
        }}>
          <CardHeader
            title={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Cake size={16} style={{ color: '#000000ff' }} />
                <span>Upcoming Birthdays</span>
              </Stack>
            }
            sx={{ '& .MuiCardHeader-title': { color: 'var(--text)' } }}
          />
          <CardContent sx={{ pt: '8px !important' }}>
            {(!stats?.upcoming_birthdays || stats.upcoming_birthdays.length === 0) ? (
              <Box sx={{ textAlign: 'center', py: 3, color: 'var(--text-muted)' }}>No upcoming birthdays</Box>
            ) : stats.upcoming_birthdays.map((emp, idx) => (
              <Box key={emp.id}>
                <Stack direction="row" spacing={1.5} sx={{ py: 1, alignItems: 'center' }}>
                  <Avatar sx={{ width: 36, height: 36, bgcolor: '#e84090', fontSize: 14, fontWeight: 700 }}>
                    {emp.name?.charAt(0)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--text)' }}>{emp.name}</Typography>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>{emp.department || '-'}</Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: '#F26A00', fontWeight: 700, flexShrink: 0 }}>
                    {emp.date_of_birth}
                  </Typography>
                </Stack>
                {idx < stats.upcoming_birthdays.length - 1 && <Divider sx={{ borderColor: 'var(--border)' }} />}
              </Box>
            ))}
          </CardContent>
        </Card>

        {/* Pending Requests moved to top */}
      </Stack>

      {/* ── Active Break Monitoring Card ── */}
      <Card ref={lazyActivityRef} sx={{ mb: 2 }}>
        <CardHeader
          title={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Coffee size={16} style={{ color: BRAND_LATE }} />
              <span style={{ color: 'var(--text)' }}>Active Break Monitoring</span>
            </Stack>
          }
          sx={{ '& .MuiCardHeader-title': { color: 'var(--text)' } }}
        />
        <CardContent sx={{ pt: '8px !important' }}>
          {(!stats?.active_break_sessions || stats.active_break_sessions.length === 0) ? (
            <Box sx={{ textAlign: 'center', py: 3, color: 'var(--text-muted)' }}>No active breaks currently</Box>
          ) : (
            <div className="active-break-monitor-table" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>Employee</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>Break Type</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>Started At</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>Expected End</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>Extensions</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.active_break_sessions.map(sess => (
                    <tr key={sess.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {sess.employee_name} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>({sess.employee_code})</span>
                      </td>
                      <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{sess.break_type}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {new Date(sess.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {new Date(sess.expected_end_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {sess.extension_minutes > 0 ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>+{sess.extension_minutes}m</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            setSelectedBreakSess(sess)
                            setExtensionMinutes(10)
                            setExtendBreakModal(true)
                          }}
                        >
                          Extend Break
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Extend Break Modal ── */}
      {extendBreakModal && selectedBreakSess && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setExtendBreakModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: '440px', background: 'var(--bg-card)', color: 'var(--text)', borderRadius: '18px', boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ fontSize: 18, color: BRAND, display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <Coffee size={20} /> Extend Break
              </h2>
              <button className="modal-close" onClick={() => setExtendBreakModal(false)} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleExtendBreakSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p className="modal-description" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Extend the active <strong>{selectedBreakSess.break_type} break</strong> for <strong>{selectedBreakSess.employee_name}</strong>.
                </p>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Extension Duration:</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {BREAK_MINUTE_OPTIONS.map(min => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => setExtensionMinutes(min)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          fontSize: 12,
                          border: '1px solid var(--border)',
                          background: extensionMinutes === min ? BRAND : 'var(--bg-secondary)',
                          color: extensionMinutes === min ? '#fff' : 'var(--text-primary)',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        +{min === 60 ? '1 hour' : `${min}m`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Reason for Extension:</label>
                  <textarea
                    className="form-control"
                    placeholder="E.g. Urgent assignment, technical issue..."
                    value={extensionReason}
                    onChange={e => setExtensionReason(e.target.value)}
                    required
                    style={{ width: '100%', height: 80, borderRadius: 8, padding: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', resize: 'none' }}
                  />
                </div>
              </div>
              <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setExtendBreakModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Confirm Extension
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Activity Log ── */}
      <Card sx={{ mb: 2 }}>
        <CardHeader
          title={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Bell size={16} style={{ color: BRAND }} />
              <span style={{ color: 'var(--text)' }}>Activity Log</span>
              {alerts.length > 0 && (
                <Box sx={{ fontSize: 11, fontWeight: 700, bgcolor: 'rgba(242,106,0,0.12)', color: '#F26A00', px: 1, py: 0.2, borderRadius: 10 }}>
                  {alerts.length}
                </Box>
              )}
            </Stack>
          }
          action={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input type="date" className="form-input" value={alertDate}
                  onChange={e => applyDateFilter(e.target.value)}
                  style={{ paddingLeft: 32, maxWidth: 170, height: 36 }} />
              </div>
              {alertDate && (
                <button className="btn btn-sm btn-secondary" onClick={clearDateFilter} title="Clear filter">
                  <X size={13} /> Clear
                </button>
              )}
              <button className="btn btn-sm btn-secondary" onClick={handleReloadAlerts} title="Refresh">
                <RefreshCw size={13} className={alertsLoading ? 'animate-spin-slow' : ''} />
              </button>
            </Stack>
          }
          sx={{ '& .MuiCardHeader-action': { alignSelf: 'center', mt: 0 } }}
        />
        <CardContent>
          {alertDate && (
            <Box sx={{ fontSize: 12, color: 'var(--text-muted)', mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Calendar size={12} />
              &nbsp;Showing logs for&nbsp;
              <strong style={{ color: BRAND }}>
                {new Date(alertDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </strong>
              &nbsp;&middot;&nbsp;{alerts.length} {alerts.length === 1 ? 'entry' : 'entries'}
            </Box>
          )}

          {isActivityLoading ? (
            <div className="dashboard-skeleton-list">
              <div className="dashboard-skeleton dashboard-skeleton-line wide" />
              <div className="dashboard-skeleton dashboard-skeleton-line" />
              <div className="dashboard-skeleton dashboard-skeleton-line short" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="table-empty" style={{ padding: '36px 24px' }}>
              <Bell size={32} style={{ opacity: 0.25, marginBottom: 8 }} />
              <p>{alertDate ? 'No activity on this day.' : 'No recent alerts.'}</p>
            </div>
          ) : (
            <>
              {dayKeys.map(day => (
                <div key={day} className="alert-day-group">
                  <div className="alert-day-header">
                    <span className="alert-day-label">{fmtDateLabel(day + ' 00:00:00')}</span>
                    <span className="alert-day-count">{groupedAlerts[day].length} alerts</span>
                  </div>
                  <div className="alert-day-items">
                    {groupedAlerts[day].map(n => (
                      <div key={n.id} className={`alert-item alert-item-row type-${n.type || 'info'}`}>
                        <div className="alert-item-dot" />
                        <div className="alert-item-body">
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <div>
                              <div className="notif-title">{n.title}</div>
                              <div className="alert-message" style={{ marginTop: 3 }}>{alertMessage(n.message)}</div>
                            </div>
                            <span className="alert-time-badge">{fmtTime12(n.created_at)}</span>
                          </div>
                          {n.title === 'Late Check-In Approval' && (
                            <div className="alert-actions" style={{ marginTop: 8 }}>
                              {alertDecision(n.message) === 'approved' ? (
                                <span className="status-badge status-present">Approved</span>
                              ) : alertDecision(n.message) === 'rejected' ? (
                                <span className="status-badge status-absent">Rejected</span>
                              ) : (
                                <>
                                  <button className="btn btn-sm btn-success" disabled={actioningAlert === n.id} onClick={() => decideLateCheckin(n, 'approve')}>Approve</button>
                                  <button className="btn btn-sm btn-danger"  disabled={actioningAlert === n.id} onClick={() => decideLateCheckin(n, 'reject')}>Reject</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {totalAlertPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {visibleAlertStart}-{visibleAlertEnd} of {totalAlerts} alerts
                  </span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setAlertPage(1)} disabled={alertPage === 1} aria-label="First page">&laquo;</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setAlertPage(p => p - 1)} disabled={alertPage === 1} aria-label="Previous page">
                      <ChevronLeft size={13} />
                    </button>
                    {Array.from({ length: Math.min(totalAlertPages, 7) }, (_, i) => {
                      const half = 3; let start = Math.max(1, alertPage - half)
                      const end = Math.min(totalAlertPages, start + 6); start = Math.max(1, end - 6)
                      return start + i
                    }).filter(p => p <= totalAlertPages).map(p => (
                      <button key={p} className={`btn btn-sm ${alertPage === p ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setAlertPage(p)} style={{ minWidth: 32, padding: '4px 0' }}>{p}</button>
                    ))}
                    <button className="btn btn-sm btn-secondary" onClick={() => setAlertPage(p => p + 1)} disabled={alertPage >= totalAlertPages} aria-label="Next page">
                      <ChevronRight size={13} />
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setAlertPage(totalAlertPages)} disabled={alertPage >= totalAlertPages} aria-label="Last page">&raquo;</button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </ThemeProvider>
  )
}
