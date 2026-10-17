/**
 * useAttendanceTimer.js
 *
 * Shared hook used by Dashboard.jsx AND WFH.jsx.
 * Computes live timer values purely from server-provided session fields.
 * The timer is NEVER reset on re-render or refetch — it always computes
 * elapsed time as (Date.now() - lastResumedAt) + accumulated_*_seconds.
 *
 * Returns an object with:
 *   work         : number  (seconds of pure work)
 *   meeting      : number  (seconds of meeting — counts as productive)
 *   lunch        : number  (seconds of lunch break)
 *   otherBreak   : number  (seconds of non-lunch break)
 *   productive   : number  (work + meeting — the main "time worked" figure)
 *   wfh          : number  (seconds in WFH location bucket)
 *   office       : number  (seconds in Office location bucket)
 *   totalSession : number  (productive + lunch + otherBreak)
 *   extendedBreak: number  (always 0 — placeholder for future use)
 *   state        : string  ('working' | 'meeting' | 'break' | 'lunch' | 'CHECKED_OUT')
 *   isCheckedOut : boolean
 */

import { useState, useEffect, useRef } from 'react'

// Parse a date string that may contain a space instead of 'T' (PHP date format)
export function parseServerDate(value) {
  if (!value) return null
  const raw = String(value).trim()

  // PHP stores session timestamps as IST without an offset (for example
  // "2026-07-29 09:00:00").  `new Date()` treats that as the browser's local
  // zone, which differs on macOS/other time zones and can make the timer look
  // stopped or reset. Interpret offset-less PHP timestamps explicitly as IST.
  const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (parts) {
    const [, year, month, day, hour, minute, second = '0'] = parts
    const utcMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) - (5.5 * 60 * 60 * 1000)
    const d = new Date(utcMs)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

// Older active records can contain a session timestamp written in the wrong
// timezone while their visible `check_in` remains correct.  Until an activity
// change occurs, every accumulated bucket is zero, so the check-in is the only
// trustworthy start time.  Do not apply this to sessions that have already
// accumulated time: for those, last_resumed_at is required after a break.
function liveTimerBase(session) {
  const sessionBase = session.last_resumed_at || session.clock_in_at
  const checkInBase = session.date && session.check_in
    ? `${session.date} ${session.check_in}`
    : null
  const sessionDate = parseServerDate(sessionBase)
  const checkInDate = parseServerDate(checkInBase)
  const accumulated = [
    session.accumulated_work_seconds,
    session.accumulated_meeting_seconds,
    session.accumulated_lunch_seconds,
    session.accumulated_break_seconds,
    session.accumulated_extended_break_seconds,
  ].reduce((total, value) => total + (Number(value) || 0), 0)

  if (accumulated === 0 && sessionDate && checkInDate && sessionDate > checkInDate) {
    return checkInBase
  }

  return sessionBase || checkInBase
}

/**
 * Compute all timer values from an attendance session record.
 * Uses Date.now() for the live delta — safe on any tick.
 */
export function computeTimers(session, options = {}) {
  if (!session) {
    return {
      work: 0, meeting: 0, lunch: 0, otherBreak: 0,
      productive: 0, wfh: 0, office: 0, totalSession: 0,
      extendedBreak: 0,
      state: 'not_checked_in', isCheckedOut: false,
    }
  }

  const isViyana = Boolean(options.isViyana || session.company_slug === 'viyana')
  const isCheckedOut = !!(session.is_checked_out || session.check_out)

  if (isViyana) {
    // Viyana has no breaks, pauses, or timers ending.
    // Time worked is purely elapsed seconds from check-in to now (or to check-out).
    const checkInStr = (session.date && session.check_in)
      ? `${session.date} ${session.check_in}`
      : (session.clock_in_at || session.created_at)
    const checkInDate = parseServerDate(checkInStr)

    let elapsed = 0
    if (checkInDate) {
      if (isCheckedOut) {
        const checkOutStr = (session.date && session.check_out)
          ? `${session.date} ${session.check_out}`
          : (session.checkout_at || session.updated_at)
        const checkOutDate = parseServerDate(checkOutStr)
        elapsed = checkOutDate
          ? Math.max(0, Math.floor((checkOutDate.getTime() - checkInDate.getTime()) / 1000))
          : Math.max(0, Number(session.worked_seconds) || 0)
      } else {
        elapsed = Math.max(0, Math.floor((Date.now() - checkInDate.getTime()) / 1000))
      }
    }

    const isWfh = (session.work_mode === 'wfh')
    return {
      work: elapsed,
      meeting: 0,
      lunch: 0,
      otherBreak: 0,
      productive: elapsed,
      wfh: isWfh ? elapsed : 0,
      office: isWfh ? 0 : elapsed,
      totalSession: elapsed,
      extendedBreak: 0,
      state: isCheckedOut ? 'CHECKED_OUT' : 'working',
      isCheckedOut,
    }
  }

  const activeType = session.active_activity_type || (isCheckedOut ? 'CHECKED_OUT' : 'working')
  // break_start_time is overloaded: it is set for real breaks (with an active
  // activity of 'lunch'/'break') AND for HR / manual pause (on a 'working'
  // session). A real break must accrue into the lunch/otherBreak bucket while
  // keeping productive time frozen; a pause freezes every bucket instead.
  const isOnBreak = !!(session.break_start_time && (activeType === 'lunch' || activeType === 'break'))
  const isPaused = !!(session.is_paused || session.hr_timer_paused || (session.break_start_time && !isOnBreak))
  let state = isPaused ? 'pause' : activeType

  // Base accumulated values from the server
  let work       = Number(session.accumulated_work_seconds    ?? 0)
  let meeting    = Number(session.accumulated_meeting_seconds ?? 0)
  let lunch      = Number(session.accumulated_lunch_seconds   ?? 0)
  let otherBreak = Number(session.accumulated_break_seconds   ?? 0)
  let wfh        = Number(session.wfh_working_seconds         ?? 0)
  let office     = Number(session.office_working_seconds      ?? 0)

  const mode = session.work_mode || session.mode || 'office'

  if (!isCheckedOut) {
    // Compute live delta: how many seconds have elapsed since the last state transition
    // Fallback chain: last_resumed_at -> clock_in_at -> date + check_in
    const baseDate = liveTimerBase(session)
    const lastResumedDate = parseServerDate(baseDate)
    const delta = lastResumedDate
      ? Math.max(0, Math.floor((Date.now() - lastResumedDate.getTime()) / 1000))
      : 0

    if (state === 'working') {
      work += delta
      if (mode === 'wfh') wfh += delta
      else office += delta
    } else if (state === 'meeting') {
      meeting += delta
      if (mode === 'wfh') wfh += delta
      else office += delta
    } else if (state === 'lunch') {
      lunch += delta
    } else if (state === 'break') {
      otherBreak += delta
    }

    // Gap repair is only valid while time is actually being tracked as work. A
    // session is continuous from check-in, so for legacy timezone-shifted
    // records the untracked interval is work done before the current activity.
    // But when the employee is on a live break or paused, the "gap" is exactly
    // the ongoing break/pause interval — it must NOT be counted as work.
    if (!isPaused && !isOnBreak && (state === 'working' || state === 'meeting')) {
      const checkInDate = parseServerDate(session.date && session.check_in ? `${session.date} ${session.check_in}` : null)
      const elapsedSinceCheckIn = checkInDate
        ? Math.max(0, Math.floor((Date.now() - checkInDate.getTime()) / 1000))
        : 0
      const trackedSession = work + meeting + lunch + otherBreak
      const missingWork = elapsedSinceCheckIn - trackedSession
      if (missingWork > 60) {
        work += missingWork
        if (mode === 'wfh') wfh += missingWork
        else office += missingWork
      }
    }
  }

  const productive   = work + meeting
  const totalSession = productive + lunch + otherBreak

  return { work, meeting, lunch, otherBreak, productive, wfh, office, totalSession, extendedBreak: 0, state, isCheckedOut }
}

/**
 * useAttendanceTimer(session)
 *
 * Accepts the `today_attendance` object from either the dashboard or attendance endpoints.
 * Returns live timer values that update every second.
 * Stable on re-renders: no timer reset when `session` prop changes.
 */
export default function useAttendanceTimer(session, options = {}) {
  const [tick, setTick] = useState(0)
  const timerRef = useRef(null)
  const sessionIdRef = useRef(null)

  const isCheckedOut = !!(session?.is_checked_out || session?.check_out)
  // Use session id or check_in as a stable identity key
  const sessionKey = session?.id || session?.check_in || null

  useEffect(() => {
    // Clear existing timer first
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Don't tick after checkout or if no session
    if (isCheckedOut || !session) {
      return
    }

    // Start a new 1-second interval.  The elapsed value is derived from
    // Date.now(), so this ticker only exists to make React render the latest
    // value; it must remain independent of refetches of the attendance row.
    timerRef.current = setInterval(() => {
      setTick(t => t + 1)
    }, 1000)

    // Browsers throttle timers in background tabs.  Re-render immediately on
    // return so the live timer catches up without waiting for the next tick.
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') setTick(t => t + 1)
    }
    document.addEventListener('visibilitychange', refreshOnVisible)

    sessionIdRef.current = sessionKey

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  // Re-run when session appears/disappears, checkout state changes, or session id changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckedOut, sessionKey])

  // Keep the ticker as an explicit dependency of the calculation.  This also
  // documents why the state exists and prevents future memoization/compiler
  // optimizations from treating it as an unused update.
  void tick
  return computeTimers(session, options)
}
