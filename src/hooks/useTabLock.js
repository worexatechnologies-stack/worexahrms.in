import { useState, useEffect, useRef } from 'react'

const LEADER_KEY = 'hrms_poll_leader_ts'
const HEARTBEAT_INTERVAL = 20_000   // write heartbeat every 20s
const LEADER_TIMEOUT    = 28_000   // claim leadership if key is stale > 28s

/**
 * Returns whether this tab is the designated "poll leader".
 * Only the leader tab should run background API polling.
 *
 * Algorithm:
 *  - Each tab writes its own random ID + timestamp to localStorage every 20s.
 *  - On startup and on `storage` events, each tab checks if the key is stale.
 *  - If stale, the tab claims leadership and starts writing its own heartbeat.
 *  - When a tab closes/navigates away, the key becomes stale and another tab claims it.
 */
export function useTabLock(userId = '') {
  const tabId = useRef(`tab_${Math.random().toString(36).slice(2)}`)
  const [isLeader, setIsLeader] = useState(false)
  const heartbeatRef = useRef(null)

  const leaderKey = `hrms_poll_leader_ts_${userId}`

  const writeHeartbeat = () => {
    try {
      localStorage.setItem(leaderKey, JSON.stringify({ id: tabId.current, ts: Date.now() }))
    } catch {}
  }

  const checkLeadership = () => {
    try {
      const raw = localStorage.getItem(leaderKey)
      if (!raw) {
        // No leader — claim it
        writeHeartbeat()
        setIsLeader(true)
        return
      }
      const { id, ts } = JSON.parse(raw)
      const stale = Date.now() - ts > LEADER_TIMEOUT

      if (id === tabId.current) {
        // We are already the leader
        setIsLeader(true)
        writeHeartbeat()
      } else if (stale) {
        // Previous leader is dead — claim leadership
        writeHeartbeat()
        setIsLeader(true)
      } else {
        // Someone else is an active leader
        setIsLeader(false)
      }
    } catch {
      setIsLeader(true) // localStorage unavailable — just poll
    }
  }

  useEffect(() => {
    checkLeadership()

    // Heartbeat keeps leadership alive and detects if another tab died
    heartbeatRef.current = setInterval(checkLeadership, HEARTBEAT_INTERVAL)

    // React to other tabs writing their heartbeat
    const handleStorage = (e) => {
      if (e.key === leaderKey) checkLeadership()
    }
    window.addEventListener('storage', handleStorage)

    // Release leadership on unload
    const handleUnload = () => {
      if (isLeader) {
        try { localStorage.removeItem(leaderKey) } catch {}
      }
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      clearInterval(heartbeatRef.current)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('beforeunload', handleUnload)
      // If we were leader, release so another tab can claim quickly
      try {
        const raw = localStorage.getItem(leaderKey)
        if (raw) {
          const { id } = JSON.parse(raw)
          if (id === tabId.current) localStorage.removeItem(leaderKey)
        }
      } catch {}
    }
  }, [userId, leaderKey])

  return isLeader
}
