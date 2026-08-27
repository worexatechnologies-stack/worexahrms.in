import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '../../App'
import {
  useCheckinMutation, useCheckoutMutation, useEndBreakMutation,
  useGetDashboardQuery, useRequestBreakMutation, useStartBreakMutation,
  useUpdateDailyTaskMutation,
} from '../../store/apiSlice'
import { ArrowRight, CalendarDays, ClipboardCheck, Clock3, FileText, Home, Ticket, UserRound, WalletCards, X, MapPin, Coffee } from 'lucide-react'
import useAttendanceTimer from '../../hooks/useAttendanceTimer'
import WelcomeTour from '../../components/WelcomeTour'

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
  const { data: response, refetch: refreshDashboard } = useGetDashboardQuery(undefined, { refetchOnFocus: true })
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

  const data = response?.data || {}
  const today = data.today_attendance || data.today || data.attendance || {}
  const liveTimer = useAttendanceTimer(today.check_in ? today : null)
  const workingHours = today.check_in ? formatTimer(liveTimer.productive) : '00:00:00'
  const activeBreak = today.active_activity_type === 'break' || today.active_activity_type === 'lunch'
  const isWfh = (today.work_mode === 'wfh') || (String(user?.work_mode || '').toLowerCase() === 'wfh')
  
  // Time-based greeting (Morning / Afternoon / Evening / Night)
  const hour = new Date().getHours()
  const greeting = hour >= 4 && hour < 12 
    ? 'Good morning' 
    : hour >= 12 && hour < 17 
      ? 'Good afternoon' 
      : hour >= 17 && hour < 21 
        ? 'Good evening' 
        : 'Good night'

  // Daily personalized motivation that rotates every day for each employee
  const motivation = useMemo(() => {
    const MOTIVATION_QUOTES = [
      "Every small milestone you achieve today builds the foundation for tomorrow's breakthrough.",
      "Focus on continuous progress, maintain high standards, and inspire everyone around you.",
      "Your creative problem-solving and dedication are the driving engine of our team's success.",
      "Bring your best energy today — great accomplishments start with focused attention.",
      "Small daily improvements over time lead to stunning, world-class results.",
      "Approach every challenge with curiosity, resolve, and bold confidence.",
      "Excellence is not an act, but a habit. Make today another masterpiece.",
      "Your discipline and consistent effort make a lasting difference every single day.",
      "Keep pushing boundaries, mastering your craft, and raising the bar for the team.",
      "Turn complex ideas into elegant solutions — you have the power to create real impact today.",
      "Focus on the solutions, trust your capabilities, and make today count!",
      "Great work is done by people who genuinely care about the quality of their craft.",
      "Innovation happens when you stay curious, test new ideas, and execute with precision.",
      "Stay energized, stay focused, and celebrate the small wins along your workday.",
      "The energy you bring today sets the rhythm for our entire team’s momentum.",
      "Quality is never an accident; it is always the result of intelligent effort and care.",
      "Own your goals today, take decisive actions, and enjoy the satisfaction of getting things done.",
      "Your unique perspectives and dedication make our workplace vibrant and productive.",
      "Be proud of the progress you have made, and step boldly into today's possibilities.",
      "Mastery is built one day at a time. Keep learning, creating, and evolving.",
      "Consistency is the superpower that turns ambitious visions into reality.",
      "Bring passion to your work, clarity to your communication, and kindness to your team.",
      "Your work matters and shapes the future of our company. Keep shining bright!",
      "Start strong, stay steady through the day, and finish with pride in what you achieved.",
      "Believe in your potential, embrace new challenges, and create something extraordinary today."
    ]

    const todayStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    const seed = `${user?.id || user?.name || 'emp'}_${todayStr}`
    let hash = 0
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i)
      hash |= 0
    }
    const idx = Math.abs(hash) % MOTIVATION_QUOTES.length
    return MOTIVATION_QUOTES[idx]
  }, [user?.id, user?.name])

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
    try { await checkout({ reason: 'End of workday' }).unwrap(); toast('Checked out successfully.', 'success'); setShowCheckoutModal(false); await refreshDashboard() }
    catch (error) { toast(error.data?.message || 'Unable to check out.', 'error') }
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

  const actions = [
    [CalendarDays, 'Apply leave', '/leaves'], [Clock3, 'Mark attendance'],
    [WalletCards, 'Download payslip', '/payslips'], [Ticket, 'Raise ticket', '/team-chat?group=it'],
    [Home, 'Request WFH', '/wfh'], [UserRound, 'Update profile', '/directory'],
  ]

  return (
    <main className="self-dashboard" style={{ width: '100%', maxWidth: 1400, margin: '0 auto' }}>
      <WelcomeTour />
      
      <div className="self-shell" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* Welcome Hero */}
        <section
          className="self-welcome"
          style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
            color: '#ffffff',
            padding: '24px 28px',
            borderRadius: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            boxShadow: '0 16px 36px rgba(15, 23, 42, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a5b4fc', display: 'block', marginBottom: 4 }}>
              Employee Workspace
            </span>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>
              {greeting}, {user?.name?.split(' ')[0] || 'there'}!
            </h1>
            <p style={{ fontSize: '13.5px', color: '#cbd5e1', margin: '4px 0 0 0' }}>
              {motivation}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255, 255, 255, 0.1)',
              padding: '8px 16px',
              borderRadius: '12px',
              fontSize: '13.5px',
              fontWeight: 700,
              color: '#ffffff',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          >
            <CalendarDays size={18} />
            <span>{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          </div>
        </section>

        {/* 2-Column Grid: Today's Work & Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'stretch' }}>
          
          {/* Today's Work Card */}
          <section
            style={{
              background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
              color: '#ffffff',
              padding: '28px',
              borderRadius: '22px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 12px 30px rgba(30, 27, 75, 0.25)',
              minHeight: '220px',
              gap: '16px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#818cf8' }}>
                  Today's Work
                </span>
                {isWfh && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      padding: '2px 8px',
                      borderRadius: '99px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    <Home size={12} /> Working from home
                  </span>
                )}
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
                {today.check_in ? (isWfh ? 'Working from home' : 'You are checked in') : 'No attendance recorded yet'}
              </h2>
              <p style={{ fontSize: '13.5px', color: '#c7d2fe', margin: 0 }}>
                {today.check_in
                  ? (isWfh
                    ? `Checked in at ${String(today.check_in).slice(0, 5)} · ${workingHours} worked today (WFH)`
                    : `Checked in at ${String(today.check_in).slice(0, 5)} · ${workingHours} worked today`)
                  : 'Mark your attendance to begin tracking your workday.'}
              </p>
            </div>

            <button
              type="button"
              className="btn"
              onClick={today.check_in ? () => navigate('/attendance') : prepareCheckin}
              disabled={checkingIn}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#ffffff',
                color: '#1e1b4b',
                fontWeight: 800,
                fontSize: '14px',
                padding: '11px 20px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                alignSelf: 'flex-start',
                transition: 'all 0.15s ease',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
              }}
            >
              <span>{today.check_in ? 'View attendance' : checkingIn ? 'Marking...' : 'Mark attendance'}</span>
              <ArrowRight size={16} />
            </button>
          </section>

          {/* Metrics Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'space-between' }}>
            <article
              className="card"
              style={{
                padding: '16px 20px',
                borderRadius: '18px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CalendarDays size={18} />
              </span>
              <div>
                <b style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                  {data.pending_leaves || 0}
                </b>
                <small style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Pending leaves
                </small>
              </div>
            </article>

            <article
              className="card"
              style={{
                padding: '16px 20px',
                borderRadius: '18px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Clock3 size={18} />
              </span>
              <div>
                <b style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                  {workingHours}
                </b>
                <small style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Worked today
                </small>
              </div>
            </article>

            <article
              className="card"
              style={{
                padding: '16px 20px',
                borderRadius: '18px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  background: 'rgba(236, 72, 153, 0.12)',
                  color: '#ec4899',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FileText size={18} />
              </span>
              <div>
                <b style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                  {data.upcoming_holidays?.length || 0}
                </b>
                <small style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Upcoming holidays
                </small>
              </div>
            </article>
          </div>
        </div>

        {/* Breaks & Lunch Section */}
        <section
          className="card"
          style={{
            padding: '24px 26px',
            borderRadius: '22px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
              Attendance Controls
            </span>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
              Breaks & Lunch
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {activeBreak ? (
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => endBreak().then(() => refreshDashboard())}
                disabled={endingBreak}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: '12px', fontWeight: 700 }}
              >
                <Clock3 size={17} />
                <span>{endingBreak ? 'Ending...' : 'End Break Manually'}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setBreakMinutes(15)
                  setBreakReason('')
                  setShowBreakModal(true)
                }}
                disabled={!today.check_in || requestingBreak}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: '12px', fontWeight: 700 }}
              >
                <Coffee size={17} />
                <span>Request Break</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setShowCheckoutModal(true)}
            disabled={!today.check_in || !!today.check_out || activeBreak || checkingOut}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              alignSelf: 'flex-start',
              padding: '11px 22px',
              borderRadius: '12px',
              fontWeight: 800,
            }}
          >
            <ArrowRight size={17} />
            <span>{checkingOut ? 'Checking out...' : 'Check out'}</span>
          </button>
        </section>

        {/* Daily Work Update */}
        <section
          className="card"
          style={{
            padding: '24px 26px',
            borderRadius: '22px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                Daily Reporting
              </span>
              <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
                Today's Work Update
              </h2>
            </div>
            <small style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Visible to HR</small>
          </div>

          <textarea
            value={taskUpdate}
            onChange={event => setTaskUpdate(event.target.value)}
            placeholder="Describe what you worked on today..."
            maxLength={2000}
            disabled={!today.check_in || savingTask}
            style={{
              width: '100%',
              borderRadius: '14px',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              padding: '14px 16px',
              fontSize: '14px',
              minHeight: '100px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--text-muted)' }}>
            <span>{today.check_in ? 'Editable until 9:30 PM IST.' : 'Check in before submitting your update.'}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveTaskUpdate}
              disabled={!today.check_in || !taskUpdate.trim() || savingTask}
              style={{ borderRadius: '10px', padding: '8px 18px', fontWeight: 700 }}
            >
              {savingTask ? 'Saving...' : 'Save update'}
            </button>
          </div>
        </section>

        {/* Shortcuts Panel */}
        <section
          className="card"
          style={{
            padding: '24px 26px',
            borderRadius: '22px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
              Shortcuts
            </span>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
              Quick Actions
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {actions.map(([Icon, label, path]) => (
              <button
                key={label}
                type="button"
                onClick={path ? () => navigate(path) : prepareCheckin}
                disabled={!path && checkingIn}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '16px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 10,
                  color: 'var(--text)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--primary)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.transform = ''
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    background: 'var(--primary-soft)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={19} />
                </span>
                <b style={{ fontSize: '13.5px', fontWeight: 700, marginTop: 4, display: 'block' }}>
                  {!path && checkingIn ? 'Marking attendance...' : label}
                </b>
                <ArrowRight size={15} style={{ color: 'var(--text-muted)' }} />
              </button>
            ))}
          </div>
        </section>

        {/* 2 Bottom Columns: Upcoming Holidays & Work Tools */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          
          <section
            className="card"
            style={{
              padding: '24px 26px',
              borderRadius: '22px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
                Upcoming Holidays
              </h2>
              <button
                type="button"
                onClick={() => navigate('/holidays')}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span>View all</span>
                <ArrowRight size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(data.upcoming_holidays || []).slice(0, 4).map((holiday, index) => (
                <div
                  key={holiday.id || index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    background: 'var(--surface-2)',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '8px',
                      background: 'rgba(236, 72, 153, 0.12)',
                      color: '#ec4899',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CalendarDays size={16} />
                  </span>
                  <div>
                    <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
                      {holiday.title || holiday.name}
                    </b>
                    <small style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{holiday.date}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            className="card"
            style={{
              padding: '24px 26px',
              borderRadius: '22px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
              My Work Tools
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={() => navigate('/attendance-sheet')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text)',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClipboardCheck size={17} style={{ color: 'var(--primary)' }} />
                  <span>Daily work update</span>
                </div>
                <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
              </button>

              <button
                type="button"
                onClick={() => navigate('/directory')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text)',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserRound size={17} style={{ color: '#06b6d4' }} />
                  <span>Employee directory</span>
                </div>
                <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
              </button>

              <button
                type="button"
                onClick={() => navigate('/payslips')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text)',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <WalletCards size={17} style={{ color: '#8b5cf6' }} />
                  <span>Payslips & documents</span>
                </div>
                <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Break Request Modal */}
      {showBreakModal && typeof document !== 'undefined' && createPortal(
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
            overflowY: 'auto'
          }}
          onClick={() => !requestingBreak && setShowBreakModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '430px',
              background: 'var(--bg-card)',
              color: 'var(--text)',
              borderRadius: '20px',
              boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              maxHeight: 'calc(100vh - 40px)'
            }}
          >
            <div className="modal-header" style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)' }}>
                <Coffee size={20} /> Request Break
              </h2>
              <button
                className="modal-close"
                onClick={() => !requestingBreak && setShowBreakModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendBreakRequest} style={{ padding: '20px 24px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
                Break Duration
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                {[10, 15, 20, 30, 45, 60].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    className={`btn btn-sm ${breakMinutes === mins ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setBreakMinutes(mins)}
                    disabled={requestingBreak}
                    style={{
                      borderRadius: 10,
                      padding: '8px 14px',
                      fontWeight: 700,
                      fontSize: '13px',
                    }}
                  >
                    {mins === 60 ? '1 Hour' : `${mins}m`}
                  </button>
                ))}
              </div>

              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
                Reason for HR Approval
              </label>
              <textarea
                value={breakReason}
                onChange={e => setBreakReason(e.target.value)}
                placeholder="E.g., Tea break, personal call, short rest..."
                required
                style={{
                  width: '100%',
                  height: 90,
                  borderRadius: 12,
                  padding: '12px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: '13.5px',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: 20,
                  fontFamily: 'inherit'
                }}
              />

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, borderRadius: 12, padding: '11px', fontWeight: 700 }}
                  onClick={() => setShowBreakModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, borderRadius: 12, padding: '11px', fontWeight: 700 }}
                  disabled={requestingBreak}
                >
                  {requestingBreak ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Check In Modal */}
      {showCheckinModal && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !checkingIn && setShowCheckinModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'400px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.4)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',maxHeight:'calc(100vh - 40px)' }}>
            <div className="modal-header">
              <h2>Confirm Check In</h2>
              <button className="modal-close" onClick={() => !checkingIn && setShowCheckinModal(false)}><X size={18}/></button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ margin: '0 0 16px 0', fontSize: 14 }}>Ready to start your workday?</p>
              {checkinLocation && <p style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}><MapPin size={14}/> Location tracked successfully.</p>}
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowCheckinModal(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmCheckin} disabled={checkingIn}>{checkingIn ? 'Checking in...' : 'Yes, Check In'}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Check Out Modal */}
      {showCheckoutModal && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !checkingOut && setShowCheckoutModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'400px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.4)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',maxHeight:'calc(100vh - 40px)' }}>
            <div className="modal-header">
              <h2>Confirm Check Out</h2>
              <button className="modal-close" onClick={() => !checkingOut && setShowCheckoutModal(false)}><X size={18}/></button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ margin: '0 0 16px 0', fontSize: 14 }}>Are you sure you want to end your workday? Your total worked hours are <strong>{workingHours}</strong>.</p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowCheckoutModal(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmCheckout} disabled={checkingOut}>{checkingOut ? 'Checking out...' : 'Yes, Check Out'}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </main>
  )
}
