import { useState, useEffect } from 'react'

/**
 * Returns a polling interval of `hiddenInterval` (default 0 = paused) when the
 * browser tab is hidden, and `interval` when the tab is visible.
 *
 * Passing a small non-zero `hiddenInterval` (e.g. 30000) lets real-time
 * features like the notification badge keep updating in the background so the
 * user sees a fresh badge/tab indicator when they glance at the tab or other
 * tabs. Browsers still throttle timers in hidden tabs (~1/min), which is fine.
 *
 * Usage: const interval = useVisibilityPolling(3000, 30000)
 * Pass the returned value as `pollingInterval` to an RTK Query hook.
 */
export function useVisibilityPolling(interval, hiddenInterval = 0) {
  const [isVisible, setIsVisible] = useState(!document.hidden)

  useEffect(() => {
    const handleVisibility = () => {
      setIsVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return isVisible ? interval : hiddenInterval
}
