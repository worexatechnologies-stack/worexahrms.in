import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast, useSound } from '../../App'
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling'
import { useTabLock } from '../../hooks/useTabLock'
import BreakActionCard from '../../components/BreakActionCard'
import { playWelcomeSound, playLunchSound } from '../../utils/audioHelper'
import {
  useGetDashboardQuery,
  useCheckinMutation,
  useCheckoutMutation,
  useEndBreakMutation,
  useRequestBreakMutation,
  useRequestMeetingMutation,
  useRequestCheckoutUndoMutation,
  useUpdateDailyTaskMutation,
  usePauseResumeTimerMutation,
  useStartMeetingMutation,
  useEndMeetingMutation,
  useStartBreakMutation,
  useGetEmployeeQuery,
  useGetAttendanceQuery
} from '../../store/apiSlice'
import { Coffee, LogIn, LogOut, Clock, CalendarOff, AlarmClock, Timer, Sunset, RefreshCw, MapPin, Calendar, FileText, PauseCircle, User } from 'lucide-react'
import { nowIST, timeToSecs, secsToHHMM, secsToWorked, displayWorkedHours, fmtTime, DEFAULT_CFG } from '../../utils/attendanceHelpers'
import useAttendanceTimer, { parseServerDate } from '../../hooks/useAttendanceTimer'

const BREAK_MINUTE_OPTIONS = [10, 20, 30, 45, 50, 60]

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton-page">
      <div className="dashboard-skeleton-stats">
        <div className="dashboard-skeleton-card">
          <span className="dashboard-skeleton dashboard-skeleton-title" />
          <span className="dashboard-skeleton dashboard-skeleton-value" />
        </div>
        <div className="dashboard-skeleton-card">
          <span className="dashboard-skeleton dashboard-skeleton-title" />
          <span className="dashboard-skeleton dashboard-skeleton-value" />
        </div>
      </div>
      <div className="dashboard-skeleton-card">
        <span className="dashboard-skeleton dashboard-skeleton-title" />
        <div className="dashboard-skeleton dashboard-skeleton-chart" />
      </div>
      <div className="dashboard-skeleton-card">
        <span className="dashboard-skeleton dashboard-skeleton-line wide" />
        <span className="dashboard-skeleton dashboard-skeleton-line" />
        <span className="dashboard-skeleton dashboard-skeleton-line short" />
      </div>
    </div>
  )
}


export default function EmpDashboard() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { soundEnabled } = useSound()
  const navigate = useNavigate()
  
  const [clock, setClock] = useState(nowIST())
  const [taskUpdate, setTaskUpdate] = useState('')
  const [checking, setChecking] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [checkoutReasonModal, setCheckoutReasonModal] = useState(false)
  const [checkoutReason, setCheckoutReason] = useState('')
  const [breakRequestModal, setBreakRequestModal] = useState(false)
  const [breakRequestType, setBreakRequestType] = useState('manual')
  const [breakRequestReason, setBreakRequestReason] = useState('')
  const [breakRequestMinutes, setBreakRequestMinutes] = useState(10)

  const alarmFired = useRef(false)
  const lunchAlarmFired = useRef(false)
  const isPollLeader = useTabLock(user?.id)
  const dashboardPollingInterval = useVisibilityPolling(isPollLeader ? 60000 : 0)

  // ----- RTK Query Hooks -----
  const { data: dashboardRes, isLoading: loading, refetch: load } = useGetDashboardQuery(undefined, {
    pollingInterval: dashboardPollingInterval,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })
  const data = dashboardRes?.data

  const { data: myEmployeeDetails } = useGetEmployeeQuery(user?.id, { skip: !user?.id })
  const { data: myAttendanceHistory } = useGetAttendanceQuery({ per_page: 200 }, { skip: !user?.id })

  const getEmployeeObject = () => {
    if (!myEmployeeDetails) return null
    const rawData = myEmployeeDetails.data || myEmployeeDetails
    if (Array.isArray(rawData)) {
      return rawData[0] || null
    }
    return rawData
  }
  const myData = getEmployeeObject()
  const myRecords = myAttendanceHistory?.data?.records || myAttendanceHistory?.data || []

  const [statsRange, setStatsRange] = useState('30') // '7', '30', '90', 'custom', 'all'
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  const filteredRecords = useMemo(() => {
    if (!myRecords) return []
    return myRecords.filter(rec => {
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
  }, [myRecords, statsRange, customStartDate, customEndDate])

  const myStats = useMemo(() => {
    const stats = {
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
      if (rec.status === 'present') stats.present++
      else if (rec.status === 'absent') stats.absent++
      else if (rec.status === 'late') {
        stats.present++
        stats.late++
      }
      else if (rec.status === 'half_day') stats.halfDay++
      else if (rec.status === 'early_checkout') {
        stats.present++
        stats.earlyCheckout++
      }

      if (rec.mode === 'wfh' || rec.work_mode === 'wfh') stats.wfhDays++
      else if (rec.mode === 'office' || rec.work_mode === 'office') stats.officeDays++
    })
    return stats
  }, [filteredRecords])

  const [checkinApi] = useCheckinMutation()
  const [checkoutApi] = useCheckoutMutation()
  const [endBreakApi] = useEndBreakMutation()
  const [requestBreakApi, { isLoading: requestingBreak }] = useRequestBreakMutation()
  const [requestMeetingApi, { isLoading: requestingMeeting }] = useRequestMeetingMutation()
  const [requestCheckoutUndoApi] = useRequestCheckoutUndoMutation()
  const [updateDailyTaskApi, { isLoading: savingTask }] = useUpdateDailyTaskMutation()
  const [togglePause] = usePauseResumeTimerMutation()
  const [startMeetingApi] = useStartMeetingMutation()
  const [endMeetingApi] = useEndMeetingMutation()
  const [startBreak] = useStartBreakMutation()

  const cfg = data?.attendance_settings 
    ? { ...DEFAULT_CFG, ...data.attendance_settings } 
    : DEFAULT_CFG

  // ── Live attendance timer (must be before any early return — Rules of Hooks) ────────
  // Passing today_attendance here; hook gracefully returns zeros when null.
  const liveTimers = useAttendanceTimer(data?.today_attendance ?? null)
  const workdaySecs = 8 * 60 * 60
  const timerProgress = Math.min(100, Math.round((liveTimers.productive / workdaySecs) * 100))

  useEffect(() => {
    if (data?.today_attendance?.daily_task_update) {
      setTaskUpdate(data.today_attendance.daily_task_update)
    }
  }, [data])

  useEffect(() => {
    const clockInterval = window.setInterval(() => {
      setClock(nowIST())
    }, 1000)
    return () => window.clearInterval(clockInterval)
  }, [])

  useEffect(() => {
    if (!sessionStorage.getItem('emp_welcome_played')) {
      sessionStorage.setItem('emp_welcome_played', 'true')
      setShowWelcome(true)
      const welcomeTimer = window.setTimeout(() => {
        if (soundEnabled) playWelcomeSound()
      }, 300)
      return () => window.clearTimeout(welcomeTimer)
    }
  }, [soundEnabled])

  useEffect(() => {
    const today = data?.today_attendance
    if (!today?.check_in || today?.check_out || data?.active_break_session) return

    const nowSeconds = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
    const lunchStartSecs = timeToSecs(cfg.lunch_start)

    if (nowSeconds >= lunchStartSecs && nowSeconds < lunchStartSecs + 5 && !lunchAlarmFired.current) {
      lunchAlarmFired.current = true
      if (soundEnabled) playLunchSound()
      toast(`It's lunch time!`, 'success')
    }

    if (nowSeconds < lunchStartSecs) {
      lunchAlarmFired.current = false
    }
  }, [clock, cfg.lunch_start, data, toast])

  // Auto break sync is managed via mutations tag invalidation.
  // Countdowns and status labels run on client clock ticks.

  /* warn 10 min before check-in window closes */
  useEffect(() => {
    if (!data || data?.today_attendance) return
    const nowSecs   = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
    const closeSecs = timeToSecs(cfg.checkin_close)
    const warnSecs  = closeSecs - 10 * 60
    if (nowSecs >= warnSecs && nowSecs < closeSecs && !alarmFired.current) {
      alarmFired.current = true
      toast(`Check-in closes at ${fmtTime(cfg.checkin_close)} IST! Check in now.`, 'error')
    }
  }, [clock, cfg, data, toast])

  const handleCheckin = async (mode = 'office') => {
    setChecking(true)
    let payload = {
      work_mode: mode,
      device: navigator.userAgent || '',
      user_agent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    }
    if ("geolocation" in navigator) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0,
          })
        })
        payload.lat = pos.coords.latitude
        payload.lng = pos.coords.longitude
        payload.accuracy = pos.coords.accuracy
      } catch (err) {
        toast('Location access denied or failed. Checking in without location.', 'warning')
      }
    }
    try {
      const r = await checkinApi(payload).unwrap()
      if (r.status === 202 || r.success === false || r.data?.pending_approval) {
        toast(r.message || 'Check-in request sent to HR for approval.', 'warning')
        return
      }
      toast(r.message || 'Checked in!', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    }
    catch (e) {
      toast(e.data?.message || e.message || 'Check-in failed', 'error')
    } finally {
      setChecking(false)
    }
  }

  const handleCheckoutSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!checkoutReason.trim()) {
      toast('Early checkout reason is required.', 'error')
      return
    }
    setCheckoutReasonModal(false)
    setChecking(true)
    try {
      const r = await checkoutApi({ reason: checkoutReason }).unwrap()
      toast(r.message || 'Checked out early!', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    } catch (e) {
      toast(e.data?.message || e.message || 'Check-out failed', 'error')
    } finally {
      setChecking(false)
      setCheckoutReason('')
    }
  }

  const handleCheckout = async () => {
    if (activeBreakSession) {
      toast('Cannot check out while a break is active. Please end your break first.', 'error')
      return
    }

    const nowSecs = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
    const isEarly = nowSecs < checkoutOpen

    if (isEarly) {
      setCheckoutReasonModal(true)
      return
    }

    if (!window.confirm('Are you sure you want to check out now?')) return
    setChecking(true)
    try {
      const r = await checkoutApi().unwrap()
      toast(r.message || 'Checked out!', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    }
    catch (e) {
      toast(e.data?.message || e.message || 'Check-out failed', 'error')
    } finally {
      setChecking(false)
    }
  }

  const handleSaveTaskUpdate = async () => {
    const nextTaskUpdate = taskUpdate.trim()
    if (!nextTaskUpdate) {
      toast('Add your daily task update first.', 'error')
      return
    }
    try {
      const res = await updateDailyTaskApi({ daily_task_update: nextTaskUpdate }).unwrap()
      setTaskUpdate(nextTaskUpdate)
      await load()
      toast(res.message || 'Daily task update saved.', 'success')
    } catch (e) {
      toast(e.data?.message || e.message || 'Failed to save task update', 'error')
    }
  }

  const openBreakRequest = (type = 'manual') => {
    setBreakRequestType(type)
    setBreakRequestMinutes(10)
    setBreakRequestReason('')
    setBreakRequestModal(true)
  }

  const handleBreakRequestSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!breakRequestReason.trim()) {
      toast('Break reason is required.', 'error')
      return
    }
    try {
      const res = await requestBreakApi({
        break_type: breakRequestType,
        requested_minutes: Number(breakRequestMinutes),
        reason: breakRequestReason.trim()
      }).unwrap()
      toast(res.message || 'Break request sent to HR.', 'success')
      setBreakRequestModal(false)
      await load()
    } catch (e) {
      toast(e.data?.message || e.message || 'Failed to send break request', 'error')
    }
  }

  if (loading) return <DashboardSkeleton />

  const today           = data?.today_attendance
  const isCheckedIn     = !!(today?.check_in && !today?.check_out)
  const isCheckedOut    = !!today?.check_out
  const isAbsent        = today?.status === 'absent'
  const canRequestCheckin = isAbsent && today?.source === 'automatic' && !today?.check_in
  // Use active_activity_type as canonical state (not legacy is_paused/pause_reason fields)
  const _activeAct      = today?.active_activity_type || 'working'
  const onBreak         = isCheckedIn && (_activeAct === 'break' || _activeAct === 'lunch')
  const inMeeting       = isCheckedIn && _activeAct === 'meeting'
  const hasPendingBreak = !!data?.pending_break_request
  const todayBreakRequests = data?.today_break_requests || []
  
  // Advanced break state details
  const activeBreakSession = data?.active_break_session || null
  const todayBreakSessions = data?.today_break_sessions || []
  const hasCompletedLunch = todayBreakSessions.some(s => s.break_type === 'lunch' && s.status === 'completed')
  const hasCompletedEvening = todayBreakSessions.some(s => s.break_type === 'evening' && s.status === 'completed')
  
  const extendMinutes = activeBreakSession?.extension_minutes || 0

  const nowSecs        = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
  const openSecs       = timeToSecs(cfg.checkin_open)
  const lateSecs       = timeToSecs(cfg.late_after)
  const closeSecs      = timeToSecs(cfg.checkin_close)
  const checkoutOpen   = timeToSecs(cfg.checkout_open)
  const checkoutClose  = timeToSecs(cfg.checkout_close)
  const taskUpdateClose = timeToSecs('21:30')
  const canEditTaskUpdate = nowSecs <= taskUpdateClose
  const lunchStart     = timeToSecs(cfg.lunch_start)
  const lunchEnd       = timeToSecs(cfg.lunch_end) + (extendMinutes * 60)
  const eveStart       = timeToSecs(cfg.evening_start)
  const eveEnd         = timeToSecs(cfg.evening_end)

  const inCheckinWindow  = nowSecs >= openSecs && nowSecs <= closeSecs
  const inLateCheckinWindow = !today && nowSecs > lateSecs && nowSecs <= closeSecs
  const inLunch          = nowSecs >= lunchStart && nowSecs <= lunchEnd
  const inEvening        = nowSecs >= eveStart   && nowSecs <= eveEnd
  const inCheckoutWindow = nowSecs >= checkoutOpen && nowSecs <= checkoutClose
  const windowClosed     = !today && nowSecs > closeSecs
  /* Countdown — priority: break > check-in > lunch > evening > checkout */
  let countdownLabel = ''
  let countdownSecs = 0
  let breakOverdueSecs = 0
  if (activeBreakSession?.expected_end_at) {
    const breakEnd = parseServerDate(activeBreakSession.expected_end_at)
    const breakEndSecs = breakEnd
      ? breakEnd.getHours() * 3600 + breakEnd.getMinutes() * 60 + breakEnd.getSeconds()
      : 0
    if (breakEndSecs > nowSecs) {
      countdownLabel = `${activeBreakSession.break_type === 'manual' ? 'Manual break' : activeBreakSession.break_type} ends in`
      countdownSecs = breakEndSecs - nowSecs
    } else if (breakEndSecs > 0) {
      breakOverdueSecs = nowSecs - breakEndSecs
    }
  } else if (!today && !windowClosed) {
    if (nowSecs < openSecs)  { countdownLabel = 'Check-in opens in';  countdownSecs = openSecs  - nowSecs }
    else                     { countdownLabel = 'Check-in closes in'; countdownSecs = closeSecs - nowSecs }
  } else if (isCheckedIn) {
    if (inLunch)             { countdownLabel = 'Lunch window ends in';    countdownSecs = lunchEnd  - nowSecs }
    else if (inEvening)      { countdownLabel = 'Evening window ends in';  countdownSecs = eveEnd    - nowSecs }
    else if (nowSecs < lunchStart)   { countdownLabel = 'Lunch window in';     countdownSecs = lunchStart - nowSecs }
    else if (nowSecs < eveStart)     { countdownLabel = 'Evening window in';   countdownSecs = eveStart   - nowSecs }
    else if (nowSecs < checkoutOpen) { countdownLabel = 'Checkout opens in';  countdownSecs = checkoutOpen - nowSecs }
  }

  let activeStateLabel = 'Not Checked In'
  let statusMessage = "Click Clock In (Office) to start your work day."
  if (isCheckedOut) {
    activeStateLabel = 'Checked Out'
    statusMessage = "You have checked out for today."
  } else if (isAbsent) {
    activeStateLabel = 'Absent'
    statusMessage = canRequestCheckin
      ? 'The check-in window has closed. Request HR approval to check in.'
      : 'You are marked absent for today.'
  } else if (isCheckedIn) {
    const act = today?.active_activity_type || 'working'
    if (act === 'working') {
      activeStateLabel = (today?.work_mode || today?.mode) === 'wfh' ? 'Working' : 'Working (Office)'
      statusMessage = "Start working — your work timer is running."
    } else if (act === 'meeting') {
      activeStateLabel = 'In Meeting'
      statusMessage = "Meeting in progress. Work timer is paused."
    } else if (act === 'lunch') {
      activeStateLabel = 'Lunch Break Active'
      statusMessage = "Lunch break in progress. Work timer is paused."
    } else if (act === 'break') {
      const activeType = activeBreakSession?.break_type || 'Evening'
      activeStateLabel = `${activeType.charAt(0).toUpperCase() + activeType.slice(1)} Break Active`
      statusMessage = `${activeType.charAt(0).toUpperCase() + activeType.slice(1)} break in progress. Work timer is paused.`
    }
  }

  const secsToHHMMSS = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const secs = totalSeconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }


  const timeStr = clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = clock.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' })
  const hour = clock.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night'
  const windowProgress = inCheckinWindow ? Math.min(100, Math.round(((nowSecs - openSecs) / (closeSecs - openSecs)) * 100)) : 0

  const role = String(myData?.designation || user?.role || 'team player').toLowerCase()
  const motivationLines = role.includes('developer') || role.includes('engineer')
    ? ['Ship small, dream big—and remember: it is not a bug if you call it a feature.', 'Your code is compiling, your coffee is not. Keep going!', 'Today’s goal: fewer bugs than yesterday, more snacks than necessary.']
    : role.includes('hr') || role.includes('human')
      ? ['You manage people, paperwork, and workplace plot twists. Legendary!', 'Today’s superpower: turning “quick question” into an actual solution.', 'Keep the team happy—your spreadsheet already has enough drama.']
      : role.includes('sales') || role.includes('business')
        ? ['Every “no” is just a “not yet” wearing a tiny disguise.', 'Go make connections—and maybe a quota nervous.', 'Your pipeline called. It wants to become a revenue river.']
        : role.includes('finance') || role.includes('account')
          ? ['Balance the books, then balance your coffee. Both are important.', 'Numbers love you because you give them meaning.', 'Today’s forecast: 100% chance of smart decisions.']
          : ['You bring the energy; the to-do list brings the challenge. Fair trade!', 'One focused hour at a time—your future self is taking notes.', 'You are doing great. Even the loading spinner believes in you.']
  const dailyMotivation = motivationLines[(clock.getDate() + clock.getMonth() + (user?.id?.length || 0)) % motivationLines.length]

  /* Actions */
  const handleRequestMeeting = async () => {
    setChecking(true)
    try {
      const res = await requestMeetingApi().unwrap()
      toast(res.message || 'Meeting request sent to HR.', 'success')
      await load()
    } catch (e) {
      toast(e.data?.message || e.message || 'Failed to request meeting', 'error')
    } finally {
      setChecking(false)
    }
  }
  const handleEndBreak = async () => {
    setChecking(true)
    try {
      const r = await endBreakApi().unwrap()
      toast(r.message || 'Break ended', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    }
    catch (e) {
      toast(e.data?.message || e.message || 'Failed to end break', 'error')
    } finally {
      setChecking(false)
    }
  }
  const handleRequestCheckoutUndo = async () => {
    setChecking(true)
    try {
      const r = await requestCheckoutUndoApi().unwrap()
      toast(r.message || 'Check-out undo request sent to HR.', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    } catch (e) {
      toast(e.data?.message || e.message || 'Request failed', 'error')
    } finally {
      setChecking(false)
    }
  }

  /* Circle button state / Replaced checkin controls */
  let btnLabel = <><LogIn size={18} /><span>Check In</span></>
  let btnClass = 'checkin-circle-btn'
  let btnOnClick = undefined

  if (!today && windowClosed) {
    btnLabel = <><LogIn size={18} /><span>Request Approval</span></>
    btnClass = 'checkin-circle-btn'
    btnOnClick = () => handleCheckin('office')
  } else if (!today) {
    btnLabel = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <button className="btn btn-primary" onClick={() => handleCheckin('office')} disabled={checking} style={{ width: '100%', fontSize: 13, padding: '8px 12px', justifyContent: 'center' }}>
          <LogIn size={14} /> {checking ? 'Checking in…' : 'Check In (Office)'}
        </button>
      </div>
    )
    btnClass = 'checkin-circle-btn-container-replaced'
    btnOnClick = undefined
  } else if (isCheckedIn) {
    const act = today?.active_activity_type || 'working'
    if (act === 'meeting') {
      btnLabel = <><Timer size={18} /><span>End Meeting</span></>
      btnClass = 'checkin-circle-btn break-mode'
      btnOnClick = async () => {
        setChecking(true)
        try {
          await endMeetingApi().unwrap()
          toast('Meeting ended', 'success')
          window.dispatchEvent(new Event('attendance-changed'))
        } catch (e) {
          toast(e.data?.message || e.message || 'Failed to end meeting', 'error')
        } finally {
          setChecking(false)
        }
      }
    } else if (act === 'lunch' || act === 'break') {
      let lbl = 'End Break'
      if (act === 'lunch') {
        lbl = 'End Lunch'
      }
      btnLabel = <><Timer size={18} /><span>{lbl}</span></>
      btnClass = 'checkin-circle-btn break-mode'
      btnOnClick = handleEndBreak
    } else {
      btnLabel = <><LogOut size={18} /><span>Check Out</span></>
      btnClass = 'checkin-circle-btn checked-out'
      btnOnClick = handleCheckout
    }
  } else if (isCheckedOut) {
    btnLabel = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <button className="btn btn-primary" onClick={() => handleCheckin('office')} disabled={checking} style={{ width: '100%', fontSize: 13, padding: '8px 12px', justifyContent: 'center' }}>
          <LogIn size={14} /> {checking ? 'Checking in…' : 'Check In (Office)'}
        </button>
      </div>
    )
    btnClass = 'checkin-circle-btn-container-replaced'
    btnOnClick = undefined
  } else if (isAbsent) {
    btnLabel = canRequestCheckin ? <><LogIn size={18} /><span>Request Approval</span></> : <span>Absent</span>
    btnClass = 'checkin-circle-btn'
    btnOnClick = canRequestCheckin ? () => handleCheckin('office') : undefined
  }

  return (
    <div className="employee-dashboard">
      <section className="dashboard-command-header employee-command-header">
        <div>
          <span className="dashboard-eyebrow">My workday</span>
          <h2>{greeting}, {user?.name?.split(' ')[0] || 'Employee'}.</h2>
          <p>Your attendance, task update and work progress are all here.</p>
        </div>
        <div className="dashboard-command-date"><Calendar size={18} /><span>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
      </section>
      {showWelcome && (
        <div className="welcome-hero welcome-fade-in">
          <div className="welcome-hero-content">
            <h1 className="welcome-hero-title">Welcome back, {user?.name?.split(' ')[0] || 'Employee'}!</h1>
            <p className="welcome-hero-subtitle">Ready to make today productive?</p>
          </div>
          <div className="welcome-hero-date">
            <div className="welcome-hero-date-icon">
              <Calendar size={18} strokeWidth={2.5} color="#fff" />
            </div>
            <div className="welcome-hero-date-text">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Requests (Pinned Top) ── */}
      {data?.pending_break_request || (todayBreakRequests && todayBreakRequests.some(r => r.status === 'pending')) ? (
        <div className="card pending-requests-banner" style={{
            background: 'var(--surface)',
            border: '1px solid var(--warning)',
            borderLeft: '4px solid var(--warning)',
            borderRadius: '16px',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '16px'
        }}>
            <div style={{
                background: 'var(--warning-soft)',
                color: 'var(--warning)',
                padding: '10px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <Coffee size={20} />
            </div>
            <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)' }}>Pending Requests</h3>
                <div className="break-request-status-list" style={{ marginTop: 0, border: 'none', background: 'transparent', padding: 0 }}>
                  {todayBreakRequests
                    .filter(req => req.status === 'pending' && (['break', 'lunch_break', 'evening_break', 'meeting'].includes(req.request_type) || req.break_type))
                    .map(req => (
                      <div key={req.id || req.created_at} className="break-request-status-row" style={{ padding: '6px 0' }}>
                        <span>{req.break_type || (req.request_type === 'break' ? 'manual' : req.request_type?.replace('_break', ''))} request pending HR approval</span>
                        <strong className="status-badge status-pending">Pending</strong>
                      </div>
                    ))}
                </div>
            </div>
        </div>
      ) : null}

      {/* ── Early Checkout Reason Modal ── */}
      {checkoutReasonModal && (
        <div className="modal-overlay" onClick={() => setCheckoutReasonModal(false)}>
          <div className="modal early-checkout-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 24 }}>
            <h2 className="modal-title" style={{ fontSize: 18, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px' }}>
              <LogOut size={20} /> Early Checkout
            </h2>
            <p className="modal-description" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.4 }}>
              You are checking out before the normal time (6:30 PM). Please enter an early checkout reason:
            </p>
            <form onSubmit={handleCheckoutSubmit}>
              <textarea
                className="form-control"
                placeholder="E.g., Medical appointment, completed tasks..."
                value={checkoutReason}
                onChange={e => setCheckoutReason(e.target.value)}
                required
                style={{ width: '100%', height: 80, marginBottom: 16, borderRadius: 8, padding: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'none' }}
              />
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCheckoutReasonModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={checking}>
                  {checking ? 'Submitting...' : 'Confirm Checkout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {breakRequestModal && (
        <div className="modal-overlay" onClick={() => setBreakRequestModal(false)}>
          <div className="modal break-request-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 430, padding: 24 }}>
            <h2 className="modal-title" style={{ fontSize: 18, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px' }}>
              <Coffee size={20} />
              {breakRequestType === 'manual' ? 'Request Break to HR' : `Request Extra ${breakRequestType === 'lunch' ? 'Lunch' : 'Evening'} Time`}
            </h2>
            <form onSubmit={handleBreakRequestSubmit}>
              <label className="form-label">Duration</label>
              <div className="break-timer-presets" style={{ marginBottom: 14 }}>
                {BREAK_MINUTE_OPTIONS.map(min => (
                  <button
                    key={min}
                    type="button"
                    className={`break-preset-btn${breakRequestMinutes === min ? ' active' : ''}`}
                    onClick={() => setBreakRequestMinutes(min)}
                    disabled={requestingBreak}
                  >
                    {min === 60 ? '1 hour' : `${min}m`}
                  </button>
                ))}
              </div>
              <label className="form-label">Reason</label>
              <textarea
                className="form-control"
                placeholder="Enter reason for HR approval..."
                value={breakRequestReason}
                onChange={e => setBreakRequestReason(e.target.value)}
                required
                style={{ width: '100%', height: 92, marginBottom: 16, borderRadius: 8, padding: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'none' }}
              />
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setBreakRequestModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={requestingBreak}>
                  {requestingBreak ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Check-out undo request banner */}
      {data?.pending_break_request?.request_type === 'checkout_undo' && (
        <div className="undo-checkout-banner" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} className="animate-spin-slow" />
            <span>Check-out undo request is pending HR approval.</span>
          </div>
        </div>
      )}

      {/* Post-checkout summary banner */}
      {isCheckedOut && (
        <div className="card checkout-summary-banner" style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(59, 130, 246, 0.08))',
          border: '1px solid var(--success)',
          borderRadius: 12,
          padding: '20px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            🎉 Day Completed!
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
            Required working time: <strong>08:00:00</strong>. Completed productive working time: <strong>{secsToHHMMSS(liveTimers.productive)}</strong>.
            Office time: <strong>{secsToHHMMSS(liveTimers.office)}</strong>. WFH time: <strong>{secsToHHMMSS(liveTimers.wfh)}</strong>.
          </p>
          {liveTimers.productive >= 28800 ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
              Net Overtime: +{secsToHHMMSS(liveTimers.productive - 28800)}
            </span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>
              Net Shortage: -{secsToHHMMSS(28800 - liveTimers.productive)}
            </span>
          )}
        </div>
      )}

      <div className="emp-dash-grid">
        {/* ── Left Column: Action Panels ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Check-in card */}
          <div className="card checkin-card" style={{ flex: 'none' }}>
            <div className="ist-badge"><Clock size={12} /> India Standard Time</div>
            <div className="checkin-date">{dateStr}</div>
            <div className="checkin-clock">{timeStr}</div>
            
            <div className="status-message-container" style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '12px 16px',
                margin: '12px 0 20px',
                textAlign: 'center',
                fontWeight: 600,
                fontSize: 14,
                color: isCheckedIn ? 'var(--primary)' : 'var(--text-secondary)'
            }}>
              {statusMessage}
            </div>

            {activeBreakSession && (
              <div className="active-break-details-card" style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontWeight: 600, fontSize: 13 }}>
                  <Coffee size={14} />
                  <span>{activeBreakSession.break_type === 'lunch' ? 'Lunch' : activeBreakSession.break_type === 'evening' ? 'Evening' : 'Manual'} Break Active</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Started: <strong>{new Date(activeBreakSession.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</strong>
                </div>
                {activeBreakSession.expected_end_at && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Expected Return: <strong>{new Date(activeBreakSession.expected_end_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</strong>
                  </div>
                )}
                {activeBreakSession.extension_minutes > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Extension: <strong style={{ color: 'var(--success)' }}>+{activeBreakSession.extension_minutes} min</strong>
                    </div>
                    {activeBreakSession.extension_reason && (
                      <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                        Reason: {activeBreakSession.extension_reason}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {today?.check_in && (
              <div className="att-time-badge att-time-in" style={{ marginBottom: 10 }}>
                <LogIn size={12} /> Checked in at {fmtTime(today.check_in.slice(0, 5))}
                {!isCheckedOut && <span className="hours-tag">{secsToHHMMSS(liveTimers.productive)} worked today</span>}
              </div>
            )}

            {today?.check_in && (
              <div className="att-banner att-banner-checkout" style={{ marginBottom: 12 }}>
                <AlarmClock size={14} /> Checkout time: {fmtTime(cfg.checkout_open)} – {fmtTime(cfg.checkout_close)}
              </div>
            )}

            {today?.check_in && (
              <div className={`employee-live-timer ${_activeAct === 'working' ? 'running' : 'paused'}`}>
                <div className="employee-live-timer-head">
                  <div>
                    <span className="employee-live-timer-kicker"><i /> Live work timer</span>
                    <strong>{_activeAct === 'meeting' ? 'Meeting in progress' :
                      _activeAct === 'lunch' ? 'Lunch break' :
                      _activeAct === 'break' ? 'Break in progress' :
                      (today.work_mode === 'wfh' || today.mode === 'wfh') ? 'Working from home' : 'Working from office'}</strong>
                  </div>
                  <span className="employee-live-timer-status">{_activeAct === 'working' ? 'Running' : 'Paused'}</span>
                </div>
                <div className="employee-live-timer-value">{secsToHHMM(liveTimers.productive)}</div>
                <div className="employee-live-timer-caption">Productive time today</div>
                <div className="employee-live-timer-bar" aria-label={`${timerProgress}% of daily target completed`}>
                  <span style={{ width: `${timerProgress}%` }} />
                </div>
                <div className="employee-live-timer-footer">
                  <span><b>{timerProgress}%</b> of 08:00:00 target</span>
                  <span>{liveTimers.productive >= workdaySecs ? `Overtime +${secsToHHMM(liveTimers.productive - workdaySecs)}` : `${secsToHHMM(workdaySecs - liveTimers.productive)} remaining`}</span>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--primary-light)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.4 }}>
              <strong>Daily boost for {myData?.designation || 'you'}:</strong> {dailyMotivation}
            </div>

            {/* Active break banners */}
            {hasPendingBreak && (
              <div className="att-banner" style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                <Coffee size={14} /> Break request pending HR approval.
              </div>
            )}
            {onBreak && (
              <div className="att-banner att-banner-break" style={{ background: 'var(--warning-light)', color: 'var(--warning)', borderColor: 'var(--warning)' }}>
                <Coffee size={14} /> You are currently on a break. Timer paused.
              </div>
            )}
            {today?.is_paused && !inMeeting && today?.pause_reason !== 'Auto-Paused: System Sleep / Inactivity' && (
              <div className="att-banner att-banner-paused" style={{ background: 'var(--warning-light)', color: 'var(--warning)', borderColor: 'var(--warning)', padding: '16px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '16px' }}>
                  <PauseCircle size={20} /> {(today.pause_reason === 'Sleep Mode Requested' || (today.pause_reason && today.pause_reason.startsWith('Sleep Mode Requested'))) ? 'Sleep Mode' : 'System Paused by HR'}
                </div>
                <div style={{ fontSize: '14px' }}>
                  <strong>Paused since:</strong> {today.paused_at ? String(today.paused_at).slice(11, 16) : today.break_start_time ? today.break_start_time.slice(0, 5) : ''}
                </div>
                {today.pause_reason && (
                  <div style={{ fontSize: '14px', fontStyle: 'italic' }}>
                    <strong>Reason:</strong> {today.pause_reason}
                  </div>
                )}
                {user?.role === 'hr' && (
                  <button
                    className="btn btn-sm btn-success"
                    style={{ alignSelf: 'flex-start', marginTop: '8px' }}
                    onClick={async () => {
                      try {
                        await togglePause({
                          action: 'hr_resume_timer',
                          body: { employee_id: today.employee_id }
                        }).unwrap()
                        toast('Employee timer resumed.', 'success')
                        load()
                        window.dispatchEvent(new Event('attendance-changed'))
                      } catch (err) {
                        toast(err.data?.message || err.message || 'Failed to resume timer.', 'error')
                      }
                    }}
                  >
                    Resume Timer
                  </button>
                )}
              </div>
            )}
            {inCheckoutWindow && isCheckedIn && !onBreak && (
              <div className="att-banner att-banner-checkout">
                <AlarmClock size={14} /> Checkout window open: {fmtTime(cfg.checkout_open)} – {fmtTime(cfg.checkout_close)}
              </div>
            )}
            {windowClosed && !today && (
              <div className="att-banner att-banner-absent">
                <CalendarOff size={14} /> Check-in window closed. You can request HR approval.
              </div>
            )}
            {inLateCheckinWindow && (
              <div className="att-banner att-banner-break">
                <AlarmClock size={14} /> Late check-in: you will be marked late after {fmtTime(cfg.late_after)}.
              </div>
            )}

            {/* Pinned requests moved to top */}

            {/* Countdown */}
            {countdownSecs > 0 && countdownLabel && (
              <div className="att-countdown">
                <Timer size={13} /><span>{countdownLabel}</span>
                <strong>{secsToHHMM(countdownSecs)}</strong>
              </div>
            )}
            {breakOverdueSecs > 0 && (
              <div className="att-countdown att-countdown-overdue">
                <Timer size={13} /><span>Break return overdue</span>
                <strong>{secsToHHMM(breakOverdueSecs)}</strong>
              </div>
            )}

            {/* Progress bar during check-in window */}
            {inCheckinWindow && !today && (
              <div className="checkin-progress-wrap">
                <div className="checkin-progress-bar" style={{ width: windowProgress + '%' }} />
                <span className="checkin-progress-label">{fmtTime(cfg.checkin_open)} — {fmtTime(cfg.checkin_close)}</span>
              </div>
            )}

            {/* Buttons */}
            <div className="checkin-btn-container" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', margin: '24px 0', width: '100%' }}>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                {btnClass === 'checkin-circle-btn-container-replaced' ? (
                  btnLabel
                ) : (
                  <button
                    className={btnClass}
                    onClick={btnOnClick}
                    disabled={isCheckedOut || (isAbsent && !canRequestCheckin) || checking}
                  >
                    {checking ? <span className="btn-spinner" /> : btnLabel}
                  </button>
                )}
              </div>

              {isCheckedIn && !isCheckedOut && (
                <div className="break-controls-panel" style={{
                    width: '100%',
                    borderTop: '1px solid var(--border)',
                    marginTop: 20,
                    paddingTop: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16
                }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Coffee size={16} /> Activity Controls
                    </h4>
                    
                    {today?.active_activity_type === 'working' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, width: '100%' }}>
                        <button
                          type="button"
                          className="btn btn-warning"
                          onClick={async () => {
                            setChecking(true)
                            try {
                              await startBreak({ break_type: 'manual' }).unwrap()
                              toast('Break started and HR notified', 'success')
                              window.dispatchEvent(new Event('attendance-changed'))
                            } catch (e) {
                              toast(e.data?.message || e.message || 'Failed to start break', 'error')
                            } finally {
                              setChecking(false)
                            }
                          }}
                          disabled={checking}
                          style={{ justifyContent: 'center' }}
                        >
                          <Coffee size={14} /> Take Break
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={async () => {
                            setChecking(true)
                            try {
                              await startMeetingApi().unwrap()
                              toast('Meeting started', 'success')
                              window.dispatchEvent(new Event('attendance-changed'))
                            } catch (e) {
                              toast(e.data?.message || e.message || 'Failed to start meeting', 'error')
                            } finally {
                              setChecking(false)
                            }
                          }}
                          disabled={checking}
                          style={{ justifyContent: 'center' }}
                        >
                          <Clock size={14} /> Start Meeting
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={async () => {
                            // Check if lunch start is valid (after 1:30 PM IST)
                            const nowSeconds = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
                            const lunchStartTs = timeToSecs('13:30')
                            if (nowSeconds < lunchStartTs) {
                              toast('Lunch break cannot be started before 1:30 PM IST.', 'error')
                              return
                            }
                            setChecking(true)
                            try {
                              await startBreak({ break_type: 'lunch' }).unwrap()
                              toast('Lunch break started', 'success')
                              window.dispatchEvent(new Event('attendance-changed'))
                            } catch (e) {
                              toast(e.data?.message || e.message || 'Failed to start lunch break', 'error')
                            } finally {
                              setChecking(false)
                            }
                          }}
                          disabled={checking || hasCompletedLunch}
                          style={{ justifyContent: 'center' }}
                        >
                          <Coffee size={14} /> Start Lunch
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openBreakRequest('manual')}
                          disabled={checking}
                          style={{ justifyContent: 'center' }}
                        >
                          <Coffee size={14} /> Request Extra
                        </button>
                      </div>
                    ) : today?.active_activity_type === 'meeting' ? (
                      <button
                        type="button"
                        className="btn btn-warning"
                        onClick={async () => {
                          setChecking(true)
                          try {
                            await endMeetingApi().unwrap()
                            toast('Meeting ended', 'success')
                            window.dispatchEvent(new Event('attendance-changed'))
                          } catch (e) {
                            toast(e.data?.message || e.message || 'Failed to end meeting', 'error')
                          } finally {
                            setChecking(false)
                          }
                        }}
                        disabled={checking}
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        <Timer size={14} /> End Meeting
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-warning"
                        onClick={handleEndBreak}
                        disabled={checking}
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        <Timer size={14} /> End Break / Lunch
                      </button>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, width: '100%' }}>
                        <BreakActionCard
                            title="Lunch Break (1:30 - 2:30)"
                            isActive={activeBreakSession?.break_type === 'lunch'}
                            isCompleted={hasCompletedLunch}
                            onAction={handleEndBreak}
                            actionLabel="End Break"
                            disabled={checking}
                        />
                        <BreakActionCard
                            title="Evening Break (4:30 - 5:00)"
                            isActive={activeBreakSession?.break_type === 'evening'}
                            isCompleted={hasCompletedEvening}
                            onAction={handleEndBreak}
                            actionLabel="End Break"
                            disabled={checking}
                        />
                    </div>
                </div>
              )}

              {isCheckedOut && data?.pending_break_request?.request_type !== 'checkout_undo' && (
                <button
                  className="btn btn-secondary"
                  onClick={handleRequestCheckoutUndo}
                  disabled={checking}
                  style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={14} /> Request Check-out Undo (Re-login)
                </button>
              )}
            </div>

            {/* In / Out time badges */}
            {today?.check_in && (
              <div className="att-time-row" style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div className="att-time-badge att-time-in">
                  <LogIn size={12} /> In: {fmtTime(today.check_in.slice(0,5))}
                  {today.checkin_lat && today.checkin_lng && (
                    <a href={`https://maps.google.com/?q=${today.checkin_lat},${today.checkin_lng}`} target="_blank" rel="noreferrer" title="View Location" aria-label="View location on Google Maps" style={{ marginLeft: 4, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                      <MapPin size={12} style={{ color: 'var(--primary)' }} />
                    </a>
                  )}
                  {today.status === 'late' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, alignItems: 'flex-start' }}>
                      {(today.late_minutes - (today.lunch_late_minutes || 0) - (today.evening_late_minutes || 0)) > 0 && (
                        <span className="late-tag">
                          {(today.late_minutes - (today.lunch_late_minutes || 0) - (today.evening_late_minutes || 0))}m check-in late
                        </span>
                      )}
                      {today.lunch_late_minutes > 0 && (
                        <span className="late-tag" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                          {today.lunch_late_minutes}m lunch late
                        </span>
                      )}
                      {today.evening_late_minutes > 0 && (
                        <span className="late-tag" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                          {today.evening_late_minutes}m evening late
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {today.check_out && (
                  <div className="att-time-badge att-time-out">
                    <LogOut size={12} /> Out: {fmtTime(today.check_out.slice(0,5))}
                    <span className="hours-tag">{displayWorkedHours(today)} net</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* My Profile & Attendance Analytics Card */}
          {myData && (
            <div className="card" style={{ padding: '24px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '18px' }}>
                <User size={16} style={{ color: 'var(--primary)' }} /> My Profile & Analytics
              </h3>
              
              {/* Profile Bio Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                {myData.profile_image ? (
                  <img src={myData.profile_image.startsWith('data:') ? myData.profile_image : `/api/${myData.profile_image}`} alt={myData.name} style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }} />
                ) : (
                  <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>
                    {(myData.name?.charAt(0) || '?').toUpperCase()}
                  </div>
                )}
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{myData.name}</h4>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{myData.employee_code} &middot; {myData.designation || 'Employee'}</div>
                </div>
              </div>

              {/* Biodata list */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                <div><strong>Dept:</strong> {myData.department || '—'}</div>
                <div><strong>Branch:</strong> {myData.branch || '—'}</div>
                <div><strong>Email:</strong> <span style={{ wordBreak: 'break-all' }}>{myData.email}</span></div>
                <div><strong>Phone:</strong> {myData.phone || '—'}</div>
                <div><strong>Joined:</strong> {myData.joining_date || '—'}</div>
                <div><strong>Type:</strong> <span style={{ textTransform: 'capitalize' }}>{myData.employment_type?.replace('_', ' ')}</span></div>
              </div>

              {/* Stats Analytics */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Attendance Analytics</h4>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', borderRadius: 8, padding: '8px 4px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>{myStats.present}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Present</div>
                  </div>
                  <div style={{ background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8, padding: '8px 4px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>{myStats.absent}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Absent</div>
                  </div>
                  <div style={{ background: 'rgba(245, 158, 11, 0.08)', borderRadius: 8, padding: '8px 4px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--warning)' }}>{myStats.late}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Late</div>
                  </div>
                  <div style={{ background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, padding: '8px 4px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>{myStats.halfDay}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Half</div>
                  </div>
                </div>

                {myStats.totalDays > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Attendance Rate ({myStats.present}/{myStats.totalDays} days)</span>
                      <strong>{Math.round((myStats.present / myStats.totalDays) * 100)}%</strong>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--success)', width: `${Math.round((myStats.present / myStats.totalDays) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick stats card */}
          <div className="card" style={{ padding: '20px' }}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>My Summary</h3>
            <div className="checkin-stats" style={{ marginTop: 0 }}>
              <div className="checkin-stat-item">
                <span className="label">Pending Leaves</span>
                <span className="value">{data?.pending_leaves || 0}</span>
              </div>
              <div className="checkin-stat-item">
                <span className="label">Upcoming Holidays</span>
                <span className="value">{data?.upcoming_holidays?.length || 0}</span>
              </div>
            </div>
          </div>

        </div>

        {/* ── Right Column: Info & Reporting Panels ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Daily Task Card - Only visible when checked in */}
          {today?.check_in && (
            <div className="card" style={{ padding: '24px' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '16px' }}>
                <FileText size={15} style={{ color: 'var(--primary)' }} /> Daily Task Update
              </h3>
              <div className="daily-task-box" style={{ marginTop: 0 }}>
                <textarea
                  className="form-input"
                  rows={4}
                  value={taskUpdate}
                  onChange={e => setTaskUpdate(e.target.value)}
                  placeholder="Tell us what you worked on today..."
                  maxLength={2000}
                  disabled={!canEditTaskUpdate}
                  style={{ marginBottom: '12px', minHeight: '110px' }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveTaskUpdate} disabled={savingTask || !canEditTaskUpdate}>
                  {savingTask ? 'Saving...' : 'Save Update'}
                </button>
                <span className="form-hint" style={{ display: 'block', marginTop: 8 }}>
                  {canEditTaskUpdate ? 'Editable until 9:30 PM IST.' : 'Daily task update editing closed at 9:30 PM IST.'}
                </span>
              </div>
            </div>
          )}

          {/* Daily Attendance Summary Card */}
          {today?.check_in && (
            <div className="card" style={{ padding: '24px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '18px' }}>
                <Clock size={16} style={{ color: 'var(--primary)' }} /> Daily Attendance Summary
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Clock-In Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtTime(today.check_in.slice(0,5))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Current Status</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: today.active_activity_type === 'working' ? 'var(--success)' : 'var(--warning)' }}>
                    {today.active_activity_type ? today.active_activity_type.charAt(0).toUpperCase() + today.active_activity_type.slice(1) : 'Working'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total Elapsed Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.totalSession)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Active Working Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.work)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Meeting Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.meeting)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lunch Break Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.lunch)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Other Break Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.otherBreak)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Extended Break Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{secsToHHMMSS(liveTimers.extendedBreak)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Office Working Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.office)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>WFH Working Time</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{secsToHHMMSS(liveTimers.wfh)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--border)', paddingBottom: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--primary)' }}>Productive Working Time</span>
                  <span style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--primary)' }}>{secsToHHMMSS(liveTimers.productive)} / 08:00:00</span>
                </div>
                {liveTimers.productive > 28800 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)', fontWeight: 600 }}>
                    <span style={{ fontSize: 13 }}>Overtime</span>
                    <span style={{ fontSize: 13 }}>+{secsToHHMMSS(liveTimers.productive - 28800)}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--danger)', fontWeight: 600 }}>
                    <span style={{ fontSize: 13 }}>Shortage</span>
                    <span style={{ fontSize: 13 }}>-{secsToHHMMSS(28800 - liveTimers.productive)}</span>
                  </div>
                )}
                {today.check_out && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Clock-Out Time</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtTime(today.check_out.slice(0,5))}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Schedule card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title" style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Clock size={15} style={{ color:'var(--primary)' }} /> Today's Schedule
              </h3>
              <span className="ist-badge-sm" style={{ padding: '2px 8px', fontSize: '10px', borderRadius: '4px', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>IST</span>
            </div>
            <div className="att-schedule-grid">
              <div className="att-sch-item">
                <span className="att-sch-label">Check-in Window</span>
                <span className="att-sch-value">{fmtTime(cfg.checkin_open)} – {fmtTime(cfg.checkin_close)}</span>
                <span className="att-sch-note">Late after {fmtTime(cfg.late_after)}</span>
              </div>
              <div className="att-sch-item">
                <span className="att-sch-label"><Coffee size={11} /> Lunch Break</span>
                <span className="att-sch-value">{fmtTime(cfg.lunch_start)} – {fmtTime(cfg.lunch_end)}</span>
                <span className="att-sch-note">{cfg.lunch_duration_min} min limit</span>
              </div>
              <div className="att-sch-item">
                <span className="att-sch-label"><Sunset size={11} /> Evening Break</span>
                <span className="att-sch-value">{fmtTime(cfg.evening_start)} – {fmtTime(cfg.evening_end)}</span>
                <span className="att-sch-note">{cfg.evening_duration_min} min limit</span>
              </div>
              <div className="att-sch-item">
                <span className="att-sch-label">Checkout Window</span>
                <span className="att-sch-value">{fmtTime(cfg.checkout_open)} – {fmtTime(cfg.checkout_close)}</span>
                <span className="att-sch-note">Early before {fmtTime(cfg.checkout_open)}</span>
              </div>
            </div>
          </div>

          {/* Recent Attendance */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Attendance</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => navigate('/attendance')}>View All</button>
            </div>
            <div className="table-container">
              <table>
                <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Net Hrs</th><th>Status</th></tr></thead>
                <tbody>
                  {(!data?.recent_attendance || data.recent_attendance.length === 0) ? (
                    <tr><td colSpan={5} className="table-empty" style={{ padding: 20 }}>No records</td></tr>
                  ) : data.recent_attendance.slice(0, 5).map(r => (
                    <tr key={r.id || r.date}>
                      <td>{r.date}</td>
                      <td>{fmtTime(r.check_in?.slice(0,5))}</td>
                      <td>{fmtTime(r.check_out?.slice(0,5))}</td>
                      <td>{displayWorkedHours(r)}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                          <span className={`status-badge status-${r.status === 'late' ? 'present' : r.status}`}>{r.status === 'late' ? 'present' : r.status.replace('_',' ')}</span>
                          {(r.status === 'present' || r.status === 'late') && r.late_minutes > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, fontWeight: '500' }}>
                              They were late by {r.late_minutes} mins
                            </span>
                          )}
                          {(r.lunch_late_minutes > 0 || r.evening_late_minutes > 0) && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                              {r.lunch_late_minutes > 0 && <span className="late-tag" style={{ fontSize: 9, padding: '1.5px 5px', background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', border: 'none' }}>{r.lunch_late_minutes}m lunch</span>}
                              {r.evening_late_minutes > 0 && <span className="late-tag" style={{ fontSize: 9, padding: '1.5px 5px', background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', border: 'none' }}>{r.evening_late_minutes}m evening</span>}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      <div className="emp-dashboard-lower-grid">
        <div className="card emp-quick-card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div className="emp-quick-grid">
            <button type="button" className="emp-quick-action" onClick={() => navigate('/attendance')}>
              <Clock size={16} />
              <span>Attendance</span>
            </button>
            <button type="button" className="emp-quick-action" onClick={() => navigate('/leaves')}>
              <CalendarOff size={16} />
              <span>Apply Leave</span>
            </button>
            <button type="button" className="emp-quick-action" onClick={() => navigate('/payslips')}>
              <FileText size={16} />
              <span>Payslips</span>
            </button>
            <button type="button" className="emp-quick-action" onClick={() => navigate('/directory')}>
              <MapPin size={16} />
              <span>Directory</span>
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Upcoming Holidays</h3>
            <button className="btn btn-sm btn-secondary" onClick={() => navigate('/holidays')}>View All</button>
          </div>
          {(!data?.upcoming_holidays || data.upcoming_holidays.length === 0) ? (
            <div className="table-empty"><p>No upcoming holidays</p></div>
          ) : data.upcoming_holidays.map(h => (
            <div key={h.id || h.date || h.title} className="holiday-item">
              <div className="holiday-date">{h.date}</div>
              <div><div className="holiday-title">{h.title}</div>
                {h.description && <div className="holiday-desc">{h.description}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
