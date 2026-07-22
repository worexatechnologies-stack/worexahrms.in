import { useState, useEffect } from 'react'

/**
 * Returns a polling interval of 0 (paused) when the browser tab is hidden,
 * and the requested interval when the tab is visible.
 *
 * Usage: const interval = useVisibilityPolling(60000)
 * Pass the returned value as `pollingInterval` to an RTK Query hook.
 */
export function useVisibilityPolling(interval) {
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

  return isVisible ? interval : 0
}
