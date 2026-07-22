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
  const onBreak = !!today?.break_start_time

  const inCheckinWindow  = nowSecs >= openSecs && nowSecs <= closeSecs
  const windowClosed     = !today && nowSecs > closeSecs
  const timeStr = clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = clock.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' })

  const handleCheckin = async () => {
    setChecking(true)
    let payload = {
      device: navigator.userAgent || 'WFH Web',
      user_agent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    }
    if ("geolocation" in navigator) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
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
  else if (isCheckedOut || isAbsent){ btnLabel = <span>Done</span>; btnClass = 'checkin-circle-btn' }

  return (
    <div className="card checkin-card" style={{ marginBottom: 20 }}>
      <div className="ist-badge"><Clock size={12} /> India Standard Time</div>
      <div className="checkin-date">{dateStr}</div>
      <div className="checkin-clock">{timeStr}</div>
      
      <div className="status-badge-container" style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 16px' }}>
          <span className="status-badge" style={{
              background: isCheckedOut ? 'rgba(239, 68, 68, 0.12)' : isCheckedIn ? 'rgba(16, 185, 129, 0.12)' : 'rgba(107, 114, 128, 0.12)',
              color: isCheckedOut ? 'var(--danger)' : isCheckedIn ? 'var(--success)' : 'var(--text-secondary)',
              border: '1px solid currentColor',
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 600
          }}>{activeStateLabel}</span>
      </div>

      <div className="checkin-btn-container" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', margin: '24px 0' }}>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
          <button
            className={btnClass}
            onClick={
              activeBreakSession ? handleEndBreak
              : isCheckedIn ? handleCheckout
              : (!today && !isAbsent) ? handleCheckin
              : undefined
            }
            disabled={isCheckedOut || isAbsent || checking}
          >
            {checking ? <span className="btn-spinner" /> : btnLabel}
          </button>
        </div>

        {isCheckedIn && !isCheckedOut && !onBreak && (
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
                  <Coffee size={16} /> Break Management
              </h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, width: '100%' }}>
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
    </div>
  )
}
