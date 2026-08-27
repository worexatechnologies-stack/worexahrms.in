import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '../../App'
import {
  useCheckinMutation, useCheckoutMutation, useEndBreakMutation,
  useGetDashboardQuery, useRequestBreakMutation, useStartBreakMutation,
  useUpdateDailyTaskMutation,
} from '../../store/apiSlice'
import { ArrowRight, CalendarDays, ClipboardCheck, Clock3, FileText, Home, Ticket, UserRound, WalletCards, X, MapPin } from 'lucide-react'
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

  const data = response?.data || {}
  const today = data.today_attendance || data.today || data.attendance || {}
  const liveTimer = useAttendanceTimer(today.check_in ? today : null)
  const workingHours = today.check_in ? formatTimer(liveTimer.productive) : '00:00:00'
  const activeBreak = today.active_activity_type === 'break' || today.active_activity_type === 'lunch'
  const isWfh = (today.work_mode === 'wfh') || (String(user?.work_mode || '').toLowerCase() === 'wfh')
  const role = String(user?.designation || user?.department || user?.role || 'team member').toLowerCase()
  const motivation = role.includes('developer') || role.includes('engineer') || role.includes('tech')
    ? 'Build boldly, solve thoughtfully, and keep raising the quality bar.'
    : 'Your consistent effort makes our team stronger every day.'

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

  const startManualBreak = async () => {
    try { await startBreak({ break_type: 'manual' }).unwrap(); toast('Break timer started.', 'success') }
    catch (error) { toast(error.data?.message || 'Unable to start break.', 'error') }
  }
  const startLunchBreak = async () => {
    try { await startBreak({ break_type: 'lunch' }).unwrap(); toast('Lunch timer started.', 'success') }
    catch (error) { toast(error.data?.message || 'Unable to start lunch break.', 'error') }
  }
  const confirmCheckout = async () => {
    try { await checkout({ reason: 'End of workday' }).unwrap(); toast('Checked out successfully.', 'success'); setShowCheckoutModal(false); await refreshDashboard() }
    catch (error) { toast(error.data?.message || 'Unable to check out.', 'error') }
  }
  const sendBreakRequest = async () => {
    try { await requestBreak({ break_type: 'manual', requested_minutes: 30, reason: 'Employee requested a break.' }).unwrap(); toast('Break request sent to HR.', 'success') }
    catch (error) { toast(error.data?.message || 'Unable to send break request.', 'error') }
  }

  const actions = [
    [CalendarDays, 'Apply leave', '/leaves'], [Clock3, 'Mark attendance'],
    [WalletCards, 'Download payslip', '/payslips'], [Ticket, 'Raise ticket', '/team-chat?group=it'],
    [Home, 'Request WFH', '/wfh'], [UserRound, 'Update profile', '/directory'],
  ]

  return (
    <main className="self-dashboard">
      <WelcomeTour />
      <div className="self-shell">
        <section className="self-welcome"><div><span className="exec-kicker">Employee workspace</span><h1>Welcome, {user?.name?.split(' ')[0] || 'there'}!</h1><p>{motivation}</p></div><div className="self-date"><CalendarDays size={18} />{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}</div></section>
        <div className="self-grid"><section className="self-attendance"><div className="office-scene" aria-hidden="true"><div className="office-window" /><div className="office-plant" /><div className="office-desk" /><div className="office-monitor"><span /></div><div className="office-person" /></div><div><span className="exec-kicker">Today's work</span>{isWfh && <span className="self-wfh-badge"><Home size={13} /> Working from home</span>}<h2>{today.check_in ? (isWfh ? 'Working from home' : 'You are checked in') : 'No attendance recorded yet'}</h2><p>{today.check_in ? (isWfh ? `Checked in at ${String(today.check_in).slice(0, 5)} · ${workingHours} worked today (WFH)` : `Checked in at ${String(today.check_in).slice(0, 5)} · ${workingHours} worked today`) : 'Mark your attendance to begin tracking your workday.'}</p></div><button className="self-action" onClick={today.check_in ? () => navigate('/attendance') : prepareCheckin} disabled={checkingIn}>{today.check_in ? 'View attendance' : checkingIn ? 'Marking...' : 'Mark attendance'} <ArrowRight size={16} /></button></section><div className="self-metrics"><article><span><CalendarDays size={17} /></span><b>{data.pending_leaves || 0}</b><small>Pending leaves</small></article><article><span><Clock3 size={17} /></span><b>{workingHours}</b><small>Worked today</small></article><article><span><FileText size={17} /></span><b>{data.upcoming_holidays?.length || 0}</b><small>Upcoming holidays</small></article></div></div>
        <section className="self-panel self-break-panel"><div className="exec-panel-head"><div><span className="exec-kicker">Attendance controls</span><h2>Breaks & lunch</h2></div></div><div className="self-break-actions">{activeBreak ? <button className="self-break-end" onClick={() => endBreak().then(() => refreshDashboard())} disabled={endingBreak}><Clock3 size={17} /> {endingBreak ? 'Ending...' : 'End break manually'}</button> : <><button onClick={startManualBreak} disabled={!today.check_in || startingBreak}><Clock3 size={17} /> Start break timer</button><button onClick={startLunchBreak} disabled={!today.check_in || startingBreak}><CalendarDays size={17} /> Start lunch timer</button><button onClick={sendBreakRequest} disabled={!today.check_in || requestingBreak}><Ticket size={17} /> Request HR approval</button></>}</div><button className="self-checkout-button" onClick={() => setShowCheckoutModal(true)} disabled={!today.check_in || !!today.check_out || activeBreak || checkingOut}><ArrowRight size={17} /> {checkingOut ? 'Checking out...' : 'Check out'}</button></section>
        <section className="self-panel self-work-update"><div className="exec-panel-head"><div><span className="exec-kicker">Daily reporting</span><h2>Today's work update</h2></div><small>Visible to HR</small></div><textarea value={taskUpdate} onChange={event => setTaskUpdate(event.target.value)} placeholder="Describe what you worked on today..." maxLength={2000} disabled={!today.check_in || savingTask} /><div className="self-update-footer"><span>{today.check_in ? 'Editable until 9:30 PM IST.' : 'Check in before submitting your update.'}</span><button className="exec-primary" onClick={saveTaskUpdate} disabled={!today.check_in || !taskUpdate.trim() || savingTask}>{savingTask ? 'Saving...' : 'Save update'}</button></div></section>
        <section className="self-panel"><div className="exec-panel-head"><div><span className="exec-kicker">Shortcuts</span><h2>Quick actions</h2></div></div><div className="self-actions">{actions.map(([Icon, label, path]) => <button key={label} onClick={path ? () => navigate(path) : prepareCheckin} disabled={!path && checkingIn}><span><Icon size={19} /></span><b>{!path && checkingIn ? 'Marking attendance...' : label}</b><ArrowRight size={15} /></button>)}</div></section>
        <div className="self-columns"><section className="self-panel"><div className="exec-panel-head"><h2>Upcoming holidays</h2><button className="exec-link" onClick={() => navigate('/holidays')}>View all <ArrowRight size={14} /></button></div>{(data.upcoming_holidays || []).slice(0, 4).map((holiday, index) => <div className="self-list" key={holiday.id || index}><span className="self-list-icon"><CalendarDays size={16} /></span><div><b>{holiday.title || holiday.name}</b><small>{holiday.date}</small></div></div>)}</section><section className="self-panel"><div className="exec-panel-head"><h2>My work tools</h2></div><div className="self-tool-list"><button onClick={() => navigate('/attendance-sheet')}><ClipboardCheck size={17} /> Daily work update <ArrowRight size={14} /></button><button onClick={() => navigate('/directory')}><UserRound size={17} /> Employee directory <ArrowRight size={14} /></button><button onClick={() => navigate('/payslips')}><WalletCards size={17} /> Payslips & documents <ArrowRight size={14} /></button></div></section></div>

      {showCheckinModal && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !checkingIn && setShowCheckinModal(false)}>
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

      {showCheckoutModal && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !checkingOut && setShowCheckoutModal(false)}>
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
  </div>
  </main>
  )
}
