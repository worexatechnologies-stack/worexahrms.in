import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '../../App'
import {
  useCheckinMutation, useCheckoutMutation, useEndBreakMutation,
  useGetDashboardQuery, useRequestBreakMutation, useStartBreakMutation,
  useUpdateDailyTaskMutation, useGetAttendanceSettingsQuery,
} from '../../store/apiSlice'
import {
  ArrowRight, ArrowUpRight, CalendarDays, Clock3, FileText, Home, UserRound,
  WalletCards, X, MapPin, Coffee, CheckCircle2,
  AlertCircle, ChevronRight, Play, Check, TrendingUp, Calendar,
  Sun, Moon, Sunrise, Sunset, Radio, Zap
} from 'lucide-react'
import useAttendanceTimer from '../../hooks/useAttendanceTimer'
import WelcomeTour from '../../components/WelcomeTour'
import AttendanceShiftHub from '../../components/AttendanceShiftHub'
import { fmtTime } from '../../utils/attendanceHelpers'

function formatTimer(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, '0')).join(':')
}

export default function SelfServiceDashboard() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { data: response, refetch: refreshDashboard } = useGetDashboardQuery(undefined, { refetchOnFocus: true, refetchOnReconnect: true, pollingInterval: 30000 })
  const { data: attSettings } = useGetAttendanceSettingsQuery(undefined, { pollingInterval: 60000, refetchOnFocus: true })
  const [updateDailyTask, { isLoading: savingTask }] = useUpdateDailyTaskMutation()
  const [startBreak, { isLoading: startingBreak }] = useStartBreakMutation()
  const [endBreak, { isLoading: endingBreak }] = useEndBreakMutation()
  const [requestBreak, { isLoading: requestingBreak }] = useRequestBreakMutation()
  const [checkout, { isLoading: checkingOut }] = useCheckoutMutation()
  const [checkin, { isLoading: checkingIn }] = useCheckinMutation()
  const [taskUpdate, setTaskUpdate] = useState('')
  const [showCheckinModal, setShowCheckinModal] = useState(false)
  const [showCheckoutModal, setShowCheckoutModal] = useState(false)
  const [checkinLocation, setCheckinLocation] = useState(null)
  const [showBreakModal, setShowBreakModal] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState(15)
  const [breakReason, setBreakReason] = useState('')

  // Live ticking IST clock
  const [liveClock, setLiveClock] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setLiveClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isViyana = user?.company_slug === 'viyana'
  
  // Instant Millisecond Hydration from Local Storage Cache
  const cacheKey = user?.id ? `hrms_dashboard_cache_${user.id}` : 'hrms_dashboard_cache_default'
  const [cachedData, setCachedData] = useState(() => {
    try {
      const raw = localStorage.getItem(cacheKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (response?.data) {
      setCachedData(response.data)
      try {
        localStorage.setItem(cacheKey, JSON.stringify(response.data))
      } catch {}
    }
  }, [response?.data, cacheKey])

  const data = response?.data || cachedData || {}
  const today = data.today_attendance || data.today || data.attendance || {}
  const liveTimer = useAttendanceTimer(today.check_in ? today : null, { isViyana })
  
  const isCheckedOut = !!(today.is_checked_out || today.check_out)
  const isManualSnapshot = !isViyana && Array.isArray(today.breaks) && today.breaks.length > 0 && isCheckedOut
  const manualBreakSecs = isManualSnapshot ? (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      }).formatToParts(new Date())
      const h = Number(parts.find(p => p.type === 'hour')?.value || 0)
      const m = Number(parts.find(p => p.type === 'minute')?.value || 0)
      const s = Number(parts.find(p => p.type === 'second')?.value || 0)
      const nowSec = h * 3600 + m * 60 + s
      let total = 0
      for (const b of today.breaks) {
        const sp = String(b.started_at || '').split(':').map(Number)
        const ep = String(b.ended_at || '').split(':').map(Number)
        if (sp.length < 2 || ep.length < 2) continue
        const sSec = sp[0] * 3600 + sp[1] * 60
        const eSec = ep[0] * 3600 + ep[1] * 60
        let start = sSec
        let end = eSec
        if (end < start) end += 86400
        if (nowSec <= start) continue
        const nowAdj = nowSec < start ? nowSec + 86400 : nowSec
        total += Math.max(0, Math.min(nowAdj, end) - start)
      }
      return total
    } catch {
      return 0
    }
  })() : 0

  const storedNet = today.working_hours || today.net_working_hours
  const liveNetSecs = Math.max(0, liveTimer.productive - (isViyana ? 0 : manualBreakSecs))
  const workingHours = today.check_in
    ? (!isViyana && isManualSnapshot && storedNet ? storedNet : formatTimer(liveNetSecs))
    : '00:00:00'

  const activeBreak = !isViyana && Boolean(
    data.active_break_session ||
    today.active_activity_type === 'break' ||
    today.active_activity_type === 'lunch'
  )
  const timerPaused = !isViyana && Boolean(today.is_paused || today.hr_timer_paused || today.active_activity_type === 'pause')
  const isWfh = (today.work_mode === 'wfh') || (String(user?.work_mode || '').toLowerCase() === 'wfh')

  const hour = liveClock.getHours()
  const greeting = hour >= 4 && hour < 12 
    ? 'Good morning' 
    : hour >= 12 && hour < 17 
      ? 'Good afternoon' 
      : hour >= 17 && hour < 21 
        ? 'Good evening' 
        : 'Good night'

  const GreetingIcon = hour >= 5 && hour < 12
    ? Sunrise
    : hour >= 12 && hour < 18
      ? Sun
      : hour >= 18 && hour < 21
        ? Sunset
        : Moon

  // Load existing daily task update if available
  useEffect(() => {
    if (today?.daily_task_update && !taskUpdate) {
      setTaskUpdate(today.daily_task_update)
    }
  }, [today?.daily_task_update])

  const prepareCheckin = async () => {
    setShowCheckinModal(true)
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCheckinLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCheckinLocation(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      )
    }
  }

  const confirmCheckin = async () => {
    const payload = {
      work_mode: 'office',
      device: navigator.userAgent || '',
      user_agent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    }
    if (checkinLocation) {
      payload.lat = checkinLocation.lat
      payload.lng = checkinLocation.lng
      payload.accuracy = 10
    }

    try {
      const result = await checkin(payload).unwrap()
      toast(result.message || 'Attendance marked. Timer started.', 'success')
      setShowCheckinModal(false)
      window.dispatchEvent(new Event('attendance-changed'))
      await refreshDashboard()
    } catch (error) {
      toast(error?.data?.message || error?.message || 'Unable to mark attendance.', 'error')
    }
  }

  const saveTaskUpdate = async () => {
    if (!taskUpdate.trim()) return
    try {
      await updateDailyTask({ daily_task_update: taskUpdate.trim() }).unwrap()
      toast('Work update saved.', 'success')
    } catch (error) {
      toast(error?.data?.message || 'Unable to save work update.', 'error')
    }
  }

  const confirmCheckout = async () => {
    try {
      await checkout({ reason: 'End of workday' }).unwrap()
      toast('Checked out successfully.', 'success')
      setShowCheckoutModal(false)
      await refreshDashboard()
    } catch (error) {
      toast(error?.data?.message || 'Unable to check out.', 'error')
    }
  }

  const handleSendBreakRequest = async (e) => {
    if (e) e.preventDefault()
    if (!breakReason.trim()) {
      toast('Please enter a reason for the break.', 'error')
      return
    }
    try {
      await requestBreak({
        break_type: 'manual',
        requested_minutes: Number(breakMinutes),
        reason: breakReason.trim()
      }).unwrap()
      toast('Break request sent to HR.', 'success')
      setShowBreakModal(false)
      setBreakReason('')
      await refreshDashboard()
    } catch (error) {
      toast(error?.data?.message || 'Unable to send break request.', 'error')
    }
  }

  const shiftTargetSecs = 7.5 * 3600
  const shiftProgressPercent = Math.min(100, Math.round((liveNetSecs / shiftTargetSecs) * 100))

  // Estimate expected departure (check-in + 7h 30m)
  const estCheckoutTime = useMemo(() => {
    if (!today?.check_in) return null
    try {
      const str = String(today.check_in).trim()
      const part = str.includes(' ') ? str.split(' ')[1] : str
      const [h, m] = part.split(':').map(Number)
      if (isNaN(h) || isNaN(m)) return null
      const totalMinutes = h * 60 + m + (7 * 60 + 30)
      const outH = Math.floor(totalMinutes / 60) % 24
      const outM = totalMinutes % 60
      const ampm = outH >= 12 ? 'PM' : 'AM'
      const displayH = (outH % 12) || 12
      return `${displayH}:${String(outM).padStart(2, '0')} ${ampm}`
    } catch {
      return null
    }
  }, [today?.check_in])

  const firstName = user?.name ? user.name.split(' ')[0] : 'there'
  // Clean capitalization (e.g. "SACHIN" -> "Sachin")
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()

  const liveTimeString = liveClock.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const actions = [
    {
      label: 'Apply Leave',
      desc: 'Request time off & permissions',
      path: '/leaves',
      icon: CalendarDays,
      badgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200/70 dark:bg-indigo-500/15 dark:text-indigo-400 dark:border-indigo-500/25',
    },
    {
      label: 'View Attendance',
      desc: 'Timesheet, punches & logs',
      path: '/attendance',
      icon: Clock3,
      badgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25',
    },
    {
      label: 'Download Payslip',
      desc: 'Monthly salary & tax statements',
      path: '/payslips',
      icon: WalletCards,
      badgeColor: 'bg-amber-50 text-amber-600 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/25',
    },
    {
      label: 'Company Holidays',
      desc: 'Calendar & scheduled days off',
      path: '/holidays',
      icon: Calendar,
      badgeColor: 'bg-rose-50 text-rose-600 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/25',
    },
    {
      label: 'Request WFH',
      desc: 'Remote work application',
      path: '/wfh',
      icon: Home,
      badgeColor: 'bg-sky-50 text-sky-600 border-sky-200/70 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/25',
    },
    {
      label: 'Team Directory',
      desc: 'Colleague phone & email contacts',
      path: '/directory',
      icon: UserRound,
      badgeColor: 'bg-purple-50 text-purple-600 border-purple-200/70 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/25',
    },
  ]

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-12 self-dashboard">
      <WelcomeTour />

      {/* ─── MODERN WORKSPACE HERO & COMMAND BAR ─── */}
      <section className="rounded-2xl bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs relative transition-all self-card-surface">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          
          {/* Left: Persona, Greeting & Status */}
          <div className="space-y-2.5 max-w-2xl">
            {/* Top Workspace Metadata */}
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span className={`w-2 h-2 rounded-full inline-block ${today.check_in ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              <span>EMPLOYEE WORKSPACE</span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span className="text-slate-600 dark:text-slate-300 font-bold">{user?.company_name?.toUpperCase() || 'WOREXA'}</span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span>GENERAL SHIFT (09:30 AM – 06:00 PM)</span>
            </div>

            {/* Clean Sans Display Title */}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              {greeting?.trim()}, {displayName?.trim()}
            </h1>

            {/* Status Information Row */}
            <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
              {today.check_in ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-bold text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  CLOCKED IN
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-bold text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  OFFLINE
                </span>
              )}

              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {today.check_in
                  ? `Clocked in at ${fmtTime(today.check_in)} · ${isWfh ? 'Remote WFH' : 'Office Premises'} · Standard 7.5h Goal`
                  : 'Shift ready · Clock in to start recording productive workday hours'}
              </span>
            </div>
          </div>

          {/* Right: Live Digital Clock & Shift Departure Tile */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 self-stretch lg:self-center lg:min-w-[260px]">
            
            {/* Live Clock Tile */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Live IST Clock</span>
                </div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-slate-900 dark:text-white tracking-tight tabular-nums">
                  {liveTimeString}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {liveClock.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>

              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 border border-blue-200/60 dark:border-blue-500/20">
                <CalendarDays size={18} />
              </div>
            </div>

            {/* Estimated Shift Wrap Target */}
            {today.check_in && !today.check_out && (
              <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-medium">
                  <Zap size={13} className="text-amber-500 flex-shrink-0" />
                  <span>Shift Goal Target</span>
                </div>
                <span className="font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-[11px]">
                  {estCheckoutTime ? `Est. ${estCheckoutTime}` : '7.5 Hours'}
                </span>
              </div>
            )}

          </div>

        </div>
      </section>

      {/* ─── UNIFIED ATTENDANCE & SHIFT COMMAND CENTER ─── */}
      <AttendanceShiftHub
        today={today}
        fmtTime={fmtTime}
        isWfh={isWfh}
        isViyana={isViyana}
        workingHours={workingHours}
        liveNetSecs={liveNetSecs}
        shiftProgressPercent={shiftProgressPercent}
        shiftTargetSecs={shiftTargetSecs}
        estCheckoutTime={estCheckoutTime}
        activeBreak={activeBreak}
        timerPaused={timerPaused}
        manualBreakSecs={manualBreakSecs}
        pendingLeaves={data.pending_leaves || 0}
        upcomingHolidays={data.upcoming_holidays || []}
        recentAttendance={data.recent_attendance || []}
        prepareCheckin={prepareCheckin}
        checkingIn={checkingIn}
        setShowCheckoutModal={setShowCheckoutModal}
        checkingOut={checkingOut}
        setShowBreakModal={setShowBreakModal}
        setBreakMinutes={setBreakMinutes}
        setBreakReason={setBreakReason}
        requestingBreak={requestingBreak}
        onEndBreak={() => endBreak().then(() => refreshDashboard())}
        endingBreak={endingBreak}
        navigate={navigate}
      />

      {/* ─── TODAY'S BREAK LOGS (If breaks taken today) ─── */}
      {!isViyana && ((Array.isArray(today.breaks) && today.breaks.length > 0) || (Array.isArray(response?.today_break_sessions) && response.today_break_sessions.length > 0)) && (
        <section className="bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3 self-card-surface">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Today's Break Sessions
            </h3>
            <span className="text-xs text-slate-400">
              {(response?.today_break_sessions?.length || today.breaks?.length || 0)} sessions logged
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {(response?.today_break_sessions?.length ? response.today_break_sessions : (today.breaks || [])).map((b, idx) => {
              const type = (b.break_type || 'break').toLowerCase()
              const label = type === 'lunch' ? 'Lunch Break' : type === 'evening' ? 'Evening Break' : 'Short Break'
              const sTime = fmtTime(b.started_at)
              const eTime = b.ended_at ? fmtTime(b.ended_at) : (b.status === 'active' ? 'Ongoing' : '')
              return (
                <div key={idx} className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 flex items-center justify-between self-item-row">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">{label}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{sTime} {eTime ? `– ${eTime}` : ''}</span>
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${b.ended_at ? 'bg-slate-200/60 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'}`}>
                    {b.ended_at ? 'Completed' : 'Active'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── DAILY REPORTING & WORK UPDATE ─── */}
      <section className="bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 self-card-surface">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Daily Work Summary
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Record your tasks, achievements, and milestones for today. Visible to HR & your manager.
            </p>
          </div>
          <span className="text-xs text-slate-400 hidden sm:inline-block">
            {today.check_in ? 'Editable until 9:30 PM' : 'Check-in required'}
          </span>
        </div>

        <textarea
          value={taskUpdate}
          onChange={event => setTaskUpdate(event.target.value)}
          placeholder="What key tasks or milestones did you complete today?..."
          maxLength={2000}
          disabled={!today.check_in || savingTask}
          rows={3}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 p-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y disabled:opacity-50 disabled:cursor-not-allowed self-textarea"
        />

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{taskUpdate.length} / 2000 characters</span>
          <button
            type="button"
            onClick={saveTaskUpdate}
            disabled={!today.check_in || !taskUpdate.trim() || savingTask}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm px-4 py-2 rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Check size={14} />
            <span>{savingTask ? 'Saving update...' : 'Save Work Update'}</span>
          </button>
        </div>
      </section>

      {/* ─── QUICK SHORTCUTS GRID ─── */}
      <section className="bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 self-card-surface">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Quick Actions &amp; Tools
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block">
              Frequently used employee tools, requests, and shortcuts
            </p>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-medium sm:hidden">
            Shortcuts
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {actions.map(({ label, desc, path, icon: Icon, badgeColor }) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              className="bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800/80 rounded-xl p-3.5 sm:p-4 flex items-center gap-3.5 text-left shadow-2xs hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150 cursor-pointer group self-quick-action"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-150 group-hover:scale-105 border ${badgeColor}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors title">
                  {label}
                </span>
                <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 block truncate mt-0.5 desc">
                  {desc}
                </span>
              </div>
              <ArrowUpRight size={15} className="text-slate-400 dark:text-slate-500 group-hover:text-slate-800 dark:group-hover:text-slate-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-150 flex-shrink-0" />
            </button>
          ))}
        </div>
      </section>

      {/* ─── BOTTOM TWO COLUMNS: HOLIDAYS & OFFICE SCHEDULE ─── */}
      {!isViyana && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          
          {/* Upcoming Holidays Card */}
          <section className="bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 self-card-surface">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                  Upcoming Holidays
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Scheduled days off this year</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/holidays')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View all</span>
                <ChevronRight size={13} />
              </button>
            </div>

            <div className="space-y-2">
              {(data.upcoming_holidays || []).slice(0, 4).map((holiday, idx) => (
                <div
                  key={holiday.id || idx}
                  className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 flex items-center justify-between self-item-row"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center font-bold text-xs">
                      <CalendarDays size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                        {holiday.title || holiday.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {holiday.date}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 bg-slate-200/60 dark:bg-slate-800 px-2 py-0.5 rounded-md self-tag-dayoff">
                    Day Off
                  </span>
                </div>
              ))}

              {(!data.upcoming_holidays || data.upcoming_holidays.length === 0) && (
                <p className="text-xs text-slate-400 text-center py-4">No upcoming holidays scheduled.</p>
              )}
            </div>
          </section>

          {/* Office Schedule Card */}
          {(() => {
            const cfg = data.attendance_settings || attSettings?.data || attSettings || {}
            const fmt = t => {
              if (t === null || t === undefined || t === '') return '—'
              const str = String(t).trim()
              if (!str || str === '—') return '—'
              if (!str.includes(':')) return str
              const parts = str.split(':')
              const h = Number(parts[0])
              const m = Number(parts[1])
              if (isNaN(h) || isNaN(m)) return str
              const ampm = h >= 12 ? 'PM' : 'AM'
              const hour = h % 12 || 12
              return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
            }

            const scheduleItems = [
              { label: 'Check-In Window', time: `${fmt(cfg.checkin_open)} – ${fmt(cfg.checkin_close)}`, hint: 'Late after ' + fmt(cfg.late_after) },
              { label: 'Lunch Break', time: `${fmt(cfg.lunch_start)} – ${fmt(cfg.lunch_end)}`, hint: (cfg.lunch_duration_min || 45) + ' mins allotted' },
              { label: 'Checkout Window', time: `From ${fmt(cfg.checkout_open)}`, hint: 'Regular shifts end' },
            ]

            return (
              <section className="bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 self-card-surface">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                    Standard Office Timings
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Company policy & attendance rules</p>
                </div>

                <div className="space-y-2">
                  {scheduleItems.map((item, i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 flex items-center justify-between self-item-row">
                      <div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                          {item.label}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {item.hint}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-lg self-timing-badge">
                        {item.time}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )
          })()}

        </div>
      )}

      {/* ─── MODALS ─── */}
      {/* Break Request Modal */}
      {!isViyana && showBreakModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => !requestingBreak && setShowBreakModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-[#0e1422] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Coffee size={18} className="text-blue-500" />
                <span>Request a Break</span>
              </h2>
              <button
                type="button"
                onClick={() => !requestingBreak && setShowBreakModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendBreakRequest} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-2">
                  Select Duration
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[10, 15, 20, 30, 45, 60].map(mins => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setBreakMinutes(mins)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        breakMinutes === mins
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {mins === 60 ? '1 Hour' : `${mins} mins`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-2">
                  Reason (Required for HR)
                </label>
                <textarea
                  value={breakReason}
                  onChange={e => setBreakReason(e.target.value)}
                  placeholder="e.g. Tea break, quick rest, client call..."
                  required
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBreakModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={requestingBreak || !breakReason.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm shadow-xs transition-all cursor-pointer"
                >
                  {requestingBreak ? 'Submitting...' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Check In Modal */}
      {showCheckinModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => !checkingIn && setShowCheckinModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-[#0e1422] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Confirm Clock-In
              </h2>
              <button
                type="button"
                onClick={() => !checkingIn && setShowCheckinModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ready to begin your workday? Your start time and device will be recorded.
            </p>

            {checkinLocation && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
                <MapPin size={14} />
                <span>Location captured successfully</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCheckinModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCheckin}
                disabled={checkingIn}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm shadow-xs cursor-pointer"
              >
                {checkingIn ? 'Clocking in...' : 'Yes, Clock In'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Check Out Modal */}
      {showCheckoutModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => !checkingOut && setShowCheckoutModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-[#0e1422] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Confirm Check Out
              </h2>
              <button
                type="button"
                onClick={() => !checkingOut && setShowCheckoutModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300">
              Are you sure you want to end your workday? Total hours logged today: <strong className="font-mono text-slate-900 dark:text-white font-bold">{workingHours}</strong>.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCheckoutModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCheckout}
                disabled={checkingOut}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm shadow-xs cursor-pointer"
              >
                {checkingOut ? 'Checking out...' : 'Yes, Check Out'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
