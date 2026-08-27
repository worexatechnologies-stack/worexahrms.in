import { useState, useEffect } from 'react'
import { LogIn, LogOut, Timer, Coffee, AlarmClock, CalendarOff, Clock } from 'lucide-react'
import {
  useGetDashboardQuery,
  useCheckinMutation,
  useCheckoutMutation,
  useEndBreakMutation,
  useRequestBreakMutation
} from '../store/apiSlice'
import { nowIST, timeToSecs, secsToHHMM, secsToWorked, displayWorkedHours, fmtTime, DEFAULT_CFG } from '../utils/attendanceHelpers'
import BreakActionCard from './BreakActionCard'
import { useToast } from '../App'

export default function WFHAttendancePanel() {
  const { toast } = useToast()
  const [clock, setClock] = useState(nowIST())
  const [checking, setChecking] = useState(false)

  const { data: dashboardRes, refetch: load } = useGetDashboardQuery(undefined, {
    refetchOnFocus: true
  })
  
  const [checkinApi] = useCheckinMutation()
  const [checkoutApi] = useCheckoutMutation()
  const [endBreakApi] = useEndBreakMutation()
  const [requestBreakApi, { isLoading: requestingBreak }] = useRequestBreakMutation()

  useEffect(() => {
    const clockInterval = window.setInterval(() => {
      setClock(nowIST())
    }, 1000)
    return () => window.clearInterval(clockInterval)
  }, [])
  const data = dashboardRes?.data
  const today = data?.today_attendance
  const activeBreakSession = data?.active_break_session
  
  const cfg = data?.attendance_settings 
    ? { ...DEFAULT_CFG, ...data.attendance_settings } 
    : DEFAULT_CFG

  const nowSecs        = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds()
  const openSecs       = timeToSecs(cfg.checkin_open)
  const closeSecs      = timeToSecs(cfg.checkin_close)
  const checkoutOpen   = timeToSecs(cfg.checkout_open)
  const checkoutClose  = timeToSecs(cfg.checkout_close)

  const isCheckedIn = !!today?.check_in
  const isCheckedOut = !!today?.check_out
  const isAbsent = today?.status === 'absent' || today?.status === 'leave' || today?.status === 'holiday'
  const canRequestCheckin = today?.status === 'absent' && today?.source === 'automatic' && !today?.check_in
  const canResumeCheckin = isCheckedOut && nowSecs <= closeSecs
  // The active session is the source of truth.  Legacy break_start_time can
  // be absent for a valid active session, which previously hid the End Break state.
  const onBreak = !!activeBreakSession

  const inCheckinWindow  = nowSecs >= openSecs && nowSecs <= closeSecs
  const windowClosed     = !today && nowSecs > closeSecs
  const timeStr = clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = clock.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' })

  const handleCheckin = async () => {
    setChecking(true)
    let payload = {
      work_mode: 'wfh',
      device: navigator.userAgent || 'WFH Web',
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
        toast('Location access denied. Checking in without location.', 'warning')
      }
    }
    try {
      const r = await checkinApi(payload).unwrap()
      toast(r.message || 'Checked in!', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    }
    catch (e) {
      toast(e.data?.message || e.message || 'Check-in failed', 'error')
    } finally {
      setChecking(false)
    }
  }

  const handleCheckout = async () => {
    if (activeBreakSession) {
      toast('Cannot check out while a break is active. Please end your break first.', 'error')
      return
    }
    if (!window.confirm('Are you sure you want to check out now?')) return
    setChecking(true)
    try {
      const r = await checkoutApi({ reason: 'WFH End' }).unwrap()
      toast(r.message || 'Checked out!', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    }
    catch (e) {
      toast(e.data?.message || e.message || 'Check-out failed', 'error')
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

  const handleBreakRequest = async (type) => {
    if (!window.confirm(`Take ${type} break?`)) return
    try {
      const r = await requestBreakApi({ request_type: type, reason: 'WFH Break' }).unwrap()
      toast(r.message || 'Break started', 'success')
      window.dispatchEvent(new Event('attendance-changed'))
    } catch (e) {
      toast(e.data?.message || 'Break request failed', 'error')
    }
  }

  let activeStateLabel = 'Not Checked In'
  if (isCheckedOut) activeStateLabel = 'Checked Out'
  else if (isAbsent) activeStateLabel = 'Absent'
  else if (isCheckedIn) {
    if (activeBreakSession?.break_type === 'lunch') activeStateLabel = 'Lunch Break Active'
    else if (activeBreakSession?.break_type === 'evening') activeStateLabel = 'Evening Break Active'
    else if (activeBreakSession?.break_type === 'manual') activeStateLabel = 'Manual Break Active'
    else activeStateLabel = 'Working'
  }

  let btnLabel = <><LogIn size={18} /><span>Check In</span></>
  let btnClass = 'checkin-circle-btn'
  if (!today && windowClosed)       { btnLabel = <><LogIn size={18} /><span>Request{'\n'}Approval</span></>; btnClass = 'checkin-circle-btn' }
  else if (isCheckedIn && onBreak) {
    btnLabel = <><Timer size={18} /><span>End{'\n'}Break</span></>
    btnClass = 'checkin-circle-btn break-mode'
  }
  else if (isCheckedIn)             { btnLabel = <><LogOut size={18} /><span>Check{'\n'}Out</span></>; btnClass = 'checkin-circle-btn checked-out' }
  else if (isAbsent) { btnLabel = canRequestCheckin ? <span>Request Approval</span> : <span>Done</span>; btnClass = 'checkin-circle-btn' }
  else if (isCheckedOut) { btnLabel = canResumeCheckin ? <><LogIn size={18} /><span>Check In Again</span></> : <span>Done</span>; btnClass = 'checkin-circle-btn' }

  return (
    <div className="card" style={{ marginBottom: 20, borderRadius: '20px', padding: '24px', border: '1px solid var(--border)', background: 'var(--surface-1, var(--bg-card))', boxShadow: 'var(--shadow-sm)' }}>
      
      {/* Top Header info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '4px 10px', borderRadius: '99px', border: '1px solid var(--border)' }}>
          <Clock size={12} style={{ color: 'var(--primary)' }} /> India Standard Time (IST)
        </div>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>{dateStr}</span>
      </div>

      {/* Center Digital Clock & Status Badge */}
      <div style={{ textAlign: 'center', margin: '10px 0 20px' }}>
        <div style={{ fontSize: '38px', fontWeight: 900, fontFamily: 'Outfit, sans-serif', color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>
          {timeStr}
        </div>
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 14px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: isCheckedOut ? 'rgba(239, 68, 68, 0.12)' : isCheckedIn ? 'rgba(16, 185, 129, 0.12)' : 'rgba(107, 114, 128, 0.12)', color: isCheckedOut ? 'var(--danger)' : isCheckedIn ? 'var(--success)' : 'var(--text-secondary)', border: `1px solid ${isCheckedOut ? 'rgba(239, 68, 68, 0.3)' : isCheckedIn ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)'}` }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isCheckedOut ? 'var(--danger)' : isCheckedIn ? 'var(--success)' : 'var(--text-secondary)', display: 'inline-block' }} />
          {activeStateLabel}
        </div>
      </div>

      {/* Main Punch Action Button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
        {onBreak ? (
          <button
            type="button"
            className="btn btn-warning"
            style={{ minWidth: 200, padding: '12px 28px', fontSize: '15px', fontWeight: 800, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 16px rgba(245, 158, 11, 0.3)' }}
            onClick={handleEndBreak}
            disabled={checking}
          >
            <Timer size={18} /> {checking ? 'Ending Break...' : 'End Current Break'}
          </button>
        ) : isCheckedIn && !isCheckedOut ? (
          <button
            type="button"
            className="btn btn-danger"
            style={{ minWidth: 200, padding: '12px 28px', fontSize: '15px', fontWeight: 800, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 16px rgba(239, 68, 68, 0.3)' }}
            onClick={handleCheckout}
            disabled={checking}
          >
            <LogOut size={18} /> {checking ? 'Checking Out...' : 'Check Out (End Shift)'}
          </button>
        ) : isCheckedOut ? (
          canResumeCheckin ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minWidth: 200, padding: '12px 28px', fontSize: '15px', fontWeight: 800, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              onClick={handleCheckin}
              disabled={checking}
            >
              <LogIn size={18} /> {checking ? 'Processing...' : 'Resume Shift (Check In)'}
            </button>
          ) : (
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '10px 20px', borderRadius: '12px' }}>
              Shift Ended for Today
            </div>
          )
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            style={{ minWidth: 220, padding: '12px 30px', fontSize: '15px', fontWeight: 800, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)', border: 'none' }}
            onClick={handleCheckin}
            disabled={checking || (isAbsent && !canRequestCheckin)}
          >
            <LogIn size={18} /> {checking ? 'Checking in...' : 'Check In for WFH'}
          </button>
        )}
      </div>

      {/* Break Controls if Checked In */}
      {isCheckedIn && !isCheckedOut && !onBreak && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18, marginTop: 10 }}>
          <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Coffee size={15} style={{ color: 'var(--primary)' }} /> Break Management
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <BreakActionCard
              title="Lunch Break"
              isActive={false}
              isCompleted={false}
              onAction={() => handleBreakRequest('lunch')}
              actionLabel="Take Lunch"
              autoStartText="Available"
              disabled={checking || requestingBreak}
            />
            <BreakActionCard
              title="Short Break"
              isActive={false}
              isCompleted={false}
              onAction={() => handleBreakRequest('manual')}
              actionLabel="Take Break"
              autoStartText="Available"
              disabled={checking || requestingBreak}
            />
          </div>
        </div>
      )}
    </div>
  )
}
