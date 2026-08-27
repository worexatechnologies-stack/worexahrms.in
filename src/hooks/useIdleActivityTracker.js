import { useCallback, useEffect, useRef, useState } from 'react'

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
const TICK_MS = 15000
const SLEEP_GAP_MS = 90000

function timeToMinutes(value) {
  if (!value) return 0
  const [hours = 0, minutes = 0] = String(value).split(':').map(Number)
  return (hours * 60) + minutes
}

function isInExemptWindow(windows, date = new Date()) {
  if (!Array.isArray(windows) || windows.length === 0) return false

  const nowMinutes = (date.getHours() * 60) + date.getMinutes()
  return windows.some((window) => {
    const start = timeToMinutes(window?.start)
    const end = timeToMinutes(window?.end)
    if (start === end) return false

    if (start < end) {
      return nowMinutes >= start && nowMinutes < end
    }

    return nowMinutes >= start || nowMinutes < end
  })
}

export default function useIdleActivityTracker({
  enabled,
  idleTimeoutMs = 600000,
  exemptWindows = []
} = {}) {
  const [isIdle, setIsIdle] = useState(false)
  const [isAsleep, setIsAsleep] = useState(false)
  const [secondsSinceActivity, setSecondsSinceActivity] = useState(0)

  const lastActivityRef = useRef(Date.now())
  const lastTickRef = useRef(Date.now())
  const hiddenSinceRef = useRef(null)
  const idleRef = useRef(false)
  const asleepRef = useRef(false)
  const exemptWindowsRef = useRef(exemptWindows)
  const scheduleRef = useRef(() => {})

  exemptWindowsRef.current = exemptWindows

  const reset = useCallback(() => {
    const now = Date.now()
    lastActivityRef.current = now
    hiddenSinceRef.current = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? now : null
    idleRef.current = false
    asleepRef.current = false
    setIsIdle(false)
    setIsAsleep(false)
    setSecondsSinceActivity(0)
    scheduleRef.current()
  }, [])

  useEffect(() => {
    if (!enabled) {
      lastActivityRef.current = Date.now()
      lastTickRef.current = Date.now()
      hiddenSinceRef.current = null
      idleRef.current = false
      asleepRef.current = false
      setIsIdle(false)
      setIsAsleep(false)
      setSecondsSinceActivity(0)
      scheduleRef.current = () => {}
      return undefined
    }

    let idleTimer = null
    let tickTimer = null
    let secondsTimer = null

    const clearIdleTimer = () => {
      if (idleTimer) {
        window.clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const markIdle = (asleep = false) => {
      if (isInExemptWindow(exemptWindowsRef.current)) {
        lastActivityRef.current = Date.now()
        hiddenSinceRef.current = document.visibilityState === 'hidden' ? Date.now() : null
        idleRef.current = false
        setIsIdle(false)
        scheduleIdleCheck()
        return
      }

      idleRef.current = true
      setIsIdle(true)
      if (asleep) {
        asleepRef.current = true
        setIsAsleep(true)
      }
    }

    const scheduleIdleCheck = () => {
      clearIdleTimer()

      const now = Date.now()
      if (isInExemptWindow(exemptWindowsRef.current, new Date(now))) {
        lastActivityRef.current = now
        idleTimer = window.setTimeout(scheduleIdleCheck, Math.min(idleTimeoutMs, 30000))
        return
      }

      const hiddenElapsed = hiddenSinceRef.current ? now - hiddenSinceRef.current : 0
      const activeElapsed = now - lastActivityRef.current
      const elapsed = hiddenSinceRef.current ? hiddenElapsed : activeElapsed
      const remaining = idleTimeoutMs - elapsed

      if (remaining <= 0) {
        markIdle(false)
        return
      }

      idleTimer = window.setTimeout(() => markIdle(false), remaining)
    }

    scheduleRef.current = scheduleIdleCheck

    const noteActivity = () => {
      lastActivityRef.current = Date.now()
      if (document.visibilityState === 'visible') {
        hiddenSinceRef.current = null
      }
      setSecondsSinceActivity(0)

      if (idleRef.current) {
        idleRef.current = false
        setIsIdle(false)
      }

      scheduleIdleCheck()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now()
        scheduleIdleCheck()
        return
      }

      noteActivity()
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, noteActivity, { passive: true })
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    lastActivityRef.current = Date.now()
    lastTickRef.current = Date.now()
    hiddenSinceRef.current = document.visibilityState === 'hidden' ? Date.now() : null
    scheduleIdleCheck()

    tickTimer = window.setInterval(() => {
      const now = Date.now()
      const gap = now - lastTickRef.current
      lastTickRef.current = now

      if (gap > SLEEP_GAP_MS) {
        markIdle(true)
      }
    }, TICK_MS)

    secondsTimer = window.setInterval(() => {
      setSecondsSinceActivity(Math.max(0, Math.floor((Date.now() - lastActivityRef.current) / 1000)))
      if (isInExemptWindow(exemptWindowsRef.current)) {
        lastActivityRef.current = Date.now()
      }
    }, 1000)

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, noteActivity)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearIdleTimer()
      if (tickTimer) window.clearInterval(tickTimer)
      if (secondsTimer) window.clearInterval(secondsTimer)
      scheduleRef.current = () => {}
    }
  }, [enabled, idleTimeoutMs])

  return { isIdle, isAsleep, secondsSinceActivity, reset }
}
