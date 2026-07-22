import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, useTheme } from '../App'
import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../services/api'
import logo from '../assets/logo.png'
import {
  useGetNotificationsQuery,
  useGetNotificationSummaryQuery,
  useReadNotificationMutation,
  useClearAllNotificationsMutation,
  useDeleteNotificationMutation,
  useLogoutMutation,
  useDecideLateCheckinMutation
} from '../store/apiSlice'
import { useVisibilityPolling } from '../hooks/useVisibilityPolling'
import {
  LayoutDashboard, Users, DollarSign, Clock, FileText,
  CalendarDays, Receipt, Bell, Sun, Moon, LogOut, Menu, X, ClipboardList, Search, MessageCircle, BookUser, Building2, Settings, Home
} from 'lucide-react'
import NotificationSettingsModal from './NotificationSettingsModal'
import { notificationService } from '../services/notificationService'
import { unlockAudio } from '../utils/audioHelper'

const hrNav = [
  { to: '/',            label: 'Dashboard',    Icon: LayoutDashboard, end: true },
  { to: '/employees',   label: 'Employees',    Icon: Users },
  { to: '/departments', label: 'Departments',  Icon: Building2 },
  { to: '/payroll',     label: 'Payroll',      Icon: DollarSign },
  { to: '/attendance',  label: 'Attendance',   Icon: Clock },
  { to: '/leaves',      label: 'Leaves',       Icon: FileText },
  { to: '/holidays',    label: 'Holidays',     Icon: CalendarDays },
  { to: '/team-chat',   label: 'Team Chat',    Icon: MessageCircle },
  { to: '/activity-logs', label: 'Activity Logs', Icon: ClipboardList },
]

const empNav = [
  { to: '/',           label: 'Dashboard',  Icon: LayoutDashboard, end: true },
  { to: '/attendance', label: 'Attendance', Icon: Clock },
  { to: '/attendance-sheet', label: 'Daily Work Update', Icon: FileText },
  { to: '/leaves',     label: 'Leaves',     Icon: FileText },
  { to: '/payslips',   label: 'Payslips',   Icon: Receipt },
  { to: '/holidays',   label: 'Holidays',   Icon: CalendarDays },
  { to: '/directory',  label: 'Directory',  Icon: BookUser },
  { to: '/team-chat',  label: 'Team Chat',  Icon: MessageCircle },
]

function notificationMessage(message) {
  if (!message) return ''
  // 1. Remove decision suffix if present
  let clean = message.replace(/;decision=[^;]+/, '')
  // 2. If it contains key-value pairs (like conversation_id=, employee_id=), extract the last part
  if (clean.includes('=')) {
    const parts = clean.split(';')
    const textPart = parts.find(p => !p.includes('='))
    if (textPart) return textPart.trim()
  }
  // 3. Otherwise, just strip leading/trailing semicolons
  return clean.replace(/^;+|;+$/g, '').trim()
}

function notificationDecision(message) {
  return message?.match(/;decision=([^;]+)/)?.[1] || ''
}

function assetUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
  // Legacy file path support
  const cleanPath = String(path).replace(/^\/+/, '')
  const cleanBase = String(api.defaults.baseURL || '').replace(/\/+$/, '')
  return `${cleanBase}/${cleanPath}`
}

function UserAvatar({ user, initials, className }) {
  const photo = assetUrl(user?.profile_image)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [photo])

  if (photo && !imageFailed) {
    return (
      <img
        className={`${className} user-avatar-img`}
        src={photo}
        alt={user?.name || 'User'}
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    )
  }
  return <div className={className}>{initials}</div>
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const [headerScrolled, setHeaderScrolled] = useState(false)
  
  const notifBellRef = useRef(null)
  const notifPanelRef = useRef(null)

  const isHr = user?.role === 'hr'
  const navItems = useMemo(() => isHr ? hrNav : empNav, [isHr])
  const searchTerm = searchVal.trim().toLowerCase()
  const searchMatches = useMemo(() => (
    searchTerm
      ? navItems.filter(item => item.label.toLowerCase().includes(searchTerm))
      : []
  ), [navItems, searchTerm])

  // ----- Polling control -----
  // Pause all polling when the browser tab is hidden.
  const notifSummaryInterval = useVisibilityPolling(3000)

  const [cursor, setCursor] = useState('')
  const lastUserRef = useRef(null)
  const lastProcessedCursor = useRef(null)

  // Reset cursor on user changes
  useEffect(() => {
    if (user?.id !== lastUserRef.current) {
      setCursor('')
      lastProcessedCursor.current = null
      lastUserRef.current = user?.id || null
    }
  }, [user])

  // ----- RTK Query Hooks -----
  // Badge count and event stream — lightweight, fast endpoint. Only runs when visible.
  const { data: notifSummaryData } = useGetNotificationSummaryQuery({ after: cursor }, {
    skip: !user,
    pollingInterval: notifSummaryInterval,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })

  // Global user interaction listener to unlock AudioContext autoplay block
  useEffect(() => {
    const resumeAudio = () => {
      unlockAudio().then((unlocked) => {
        if (!unlocked) return
        window.removeEventListener('click', resumeAudio)
        window.removeEventListener('keydown', resumeAudio)
        window.removeEventListener('pointerdown', resumeAudio)
        window.removeEventListener('touchstart', resumeAudio)
      }).catch(() => {})
    }
    window.addEventListener('click', resumeAudio)
    window.addEventListener('keydown', resumeAudio)
    window.addEventListener('pointerdown', resumeAudio)
    window.addEventListener('touchstart', resumeAudio)
    return () => {
      window.removeEventListener('click', resumeAudio)
      window.removeEventListener('keydown', resumeAudio)
      window.removeEventListener('pointerdown', resumeAudio)
      window.removeEventListener('touchstart', resumeAudio)
    }
  }, [])

  // Process new notifications received via summary event stream
  useEffect(() => {
    if (!notifSummaryData?.data) return

    const { latest_event_cursor, events } = notifSummaryData.data

    if (!cursor) {
      // First load: set the cursor so we don't speak historical notifications
      if (latest_event_cursor) {
        setCursor(latest_event_cursor)
        lastProcessedCursor.current = latest_event_cursor
      }
      return
    }

    if (latest_event_cursor && latest_event_cursor !== lastProcessedCursor.current) {
      if (events && events.length > 0) {
        events.forEach((event) => {
          notificationService.notify({
            type: event.type || 'info',
            message: notificationMessage(event.message),
            speakText: event.speak_text || notificationMessage(event.message),
            eventId: event.event_id || event.id,
            speak: true,
            sound: true,
            toast: true,
            forceSpeak: true,
            title: event.title || '',
          })
        })
      }

      if (latest_event_cursor !== cursor) {
        setCursor(latest_event_cursor)
      }
      lastProcessedCursor.current = latest_event_cursor
    }
  }, [notifSummaryData, cursor])

  // Full notification list — fetched only when the panel is open
  const { data: notifData } = useGetNotificationsQuery(undefined, {
    skip: !user || !showNotifs,
    refetchOnMountOrArgChange: true,
  })

  const [readNotif] = useReadNotificationMutation()
  const [clearAllNotifs] = useClearAllNotificationsMutation()
  const [deleteNotif] = useDeleteNotificationMutation()
  const [decideLateCheckin] = useDecideLateCheckinMutation()
  const [logoutApi] = useLogoutMutation()

  const displayUser = user
  const initials = useMemo(() => (
    displayUser?.name
      ? displayUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      : 'HR'
  ), [displayUser?.name])

  // Extract Notifications list and count
  // Use full notifData when panel is open, fall back to summary count for badge
  const notifications = useMemo(() => notifData?.data?.notifications || notifData?.data || [], [notifData])
  const notifCount = useMemo(
    () => {
      // When panel is open use full data; otherwise use lightweight summary
      if (showNotifs && notifData?.data?.unread_count !== undefined) return notifData.data.unread_count
      return notifSummaryData?.data?.unread_count ?? notifData?.data?.unread_count ?? notifications.filter(n => !n.is_read).length
    },
    [showNotifs, notifData, notifSummaryData, notifications]
  )

  useEffect(() => {
    const handleScroll = () => setHeaderScrolled(window.scrollY > 8)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!showNotifs) return

    const closeOnOutsideClick = (event) => {
      if (
        notifPanelRef.current?.contains(event.target) ||
        notifBellRef.current?.contains(event.target)
      ) return
      setShowNotifs(false)
    }

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setShowNotifs(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showNotifs])

  const handleMarkRead = async (notif) => {
    if (notif.is_read) return
    try { await readNotif(notif.id).unwrap() } catch {}
  }

  const handleClearNotifications = async () => {
    try { await clearAllNotifs().unwrap() } catch {}
  }

  const handleDeleteNotification = async (e, id) => {
    e.stopPropagation()
    try { await deleteNotif(id).unwrap() } catch {}
  }

  const handleApproveLateCheckin = async (e, notif) => {
    e.stopPropagation()
    try {
      await decideLateCheckin({ action: 'approve', notificationId: notif.id }).unwrap()
    } catch {}
  }

  const handleRejectLateCheckin = async (e, notif) => {
    e.stopPropagation()
    try {
      await decideLateCheckin({ action: 'reject', notificationId: notif.id }).unwrap()
    } catch {}
  }

  const handleLogout = async () => {
    try { await logoutApi().unwrap() } catch {}
    logout()
    notificationService.notifySuccess('Logout successful.', {
      eventId: `auth:logout:${Date.now()}`,
      forceSpeak: true,
    })
    navigate('/login')
  }
  
  const getTitle = () => {
    const match = navItems.find(n => n.end ? location.pathname === '/' : location.pathname.startsWith(n.to) && n.to !== '/')
    return match?.label || 'Dashboard'
  }

  const goToSearchMatch = (item) => {
    if (!item) return
    navigate(item.to)
    setSearchVal('')
    setSidebarOpen(false)
  }

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div className="modal-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>

        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo-wrap">
            <img src={logo} alt="HRMS" className="sidebar-logo-img" decoding="async" />
          </div>
          <div>
            <h2>HRMS</h2>
            <span>{isHr ? 'Human Resource' : 'Employee Portal'}</span>
          </div>
        </div>

        {/* Main menu label */}
        <div className="sidebar-section-label">Main Menu</div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) => isActive ? 'active' : ''}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon"><Icon size={16} strokeWidth={2} /></span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info">
            <UserAvatar user={displayUser} initials={initials} className="avatar" />
            <div>
              <div className="user-name">{displayUser?.name || 'User'}</div>
              <div className="user-role">{isHr ? 'HR Admin' : 'Employee'}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">

        {/* Header */}
        <header className={`main-header ${headerScrolled ? 'scrolled' : ''}`}>
          <div className="header-title-group">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <img src={logo} alt="WOREXA Technologies" className="header-logo-img" decoding="async" />
            <h1>{getTitle()}</h1>
          </div>

          {/* Search bar */}
          <div className="header-search-wrap">
            <Search size={14} className="search-icon" />
            <input
              className="header-search-input"
              placeholder="Search menu..."
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') goToSearchMatch(searchMatches[0])
                if (e.key === 'Escape') setSearchVal('')
              }}
            />
            {searchVal && (
              <button className="header-search-clear" type="button" onClick={() => setSearchVal('')} title="Clear search" aria-label="Clear search">
                <X size={13} />
              </button>
            )}
            {searchTerm && (
              <div className="header-search-results">
                {searchMatches.length === 0 ? (
                  <div className="header-search-empty">No matching pages</div>
                ) : searchMatches.map(({ to, label, Icon }) => (
                  <button key={to} type="button" onMouseDown={() => goToSearchMatch({ to })}>
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="header-actions">
            {/* Bell */}
            <button
              ref={notifBellRef}
              className="notif-bell"
              onClick={() => { setShowNotifs(v => !v); notificationService.requestNativePermission() }}
              aria-label="Notifications"
              aria-expanded={showNotifs}
            >
              <Bell size={18} strokeWidth={2} />
              {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
            </button>

            {/* Notification Settings button */}
            <button
              className="notif-bell"
              onClick={() => setShowSettingsModal(true)}
              title="Notification Settings"
              aria-label="Notification Settings"
              style={{ marginRight: 10, height: '28px', width: '28px' }}
            >
              <Settings size={14} strokeWidth={2.4} />
            </button>

            {/* Theme toggle */}
            <button
              className={`theme-toggle ${theme === 'dark' ? 'dark' : ''}`}
              onClick={() => setTheme()}
              title="Toggle theme"
            >
              <span className="ti sun"><Sun size={10} /></span>
              <span className="ti moon"><Moon size={10} /></span>
              <span className="theme-toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>

            {/* User chip */}
            <div className="header-user-chip">
              <UserAvatar user={displayUser} initials={initials} className="chip-avatar" />
              <div className="chip-info">
                <div className="chip-name">{displayUser?.name?.split(' ')[0] || 'User'}</div>
                <div className="chip-role">{isHr ? 'HR Admin' : 'Employee'}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Notification dropdown */}
        {showNotifs && (
          <div className="notif-dropdown" ref={notifPanelRef}>
            <div className="notif-dropdown-header">
              <strong>Notifications</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                {notifications.length > 0 && <button className="btn btn-sm btn-secondary" onClick={handleClearNotifications}>Dismiss All</button>}
                <button className="btn btn-sm btn-secondary" onClick={() => setShowNotifs(false)}>Close</button>
              </div>
            </div>
            {notifications.length === 0 ? (
              <div className="notif-empty">No notifications</div>
            ) : notifications.map(n => {
              const decision = notificationDecision(n.message)
              const isDecided = decision === 'approved' || decision === 'rejected'

              return (
                <div key={n.id} className={`notif-item ${!n.is_read ? 'unread' : ''}`} onClick={() => handleMarkRead(n)} style={{ position: 'relative', paddingRight: '36px' }}>
                  <button
                    onClick={(e) => handleDeleteNotification(e, n.id)}
                    style={{
                      position: 'absolute', top: '10px', right: '12px',
                      background: 'none', border: 'none', color: 'var(--text-secondary)',
                      cursor: 'pointer', fontSize: '16px', padding: '4px', lineHeight: 1, opacity: 0.5
                    }}
                    title="Dismiss notification"
                    aria-label="Dismiss notification"
                  >
                    <X size={14} strokeWidth={2.4} />
                  </button>
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-message">{notificationMessage(n.message)}</div>
                  <div className="notif-time">{typeof n.created_at === 'string' ? n.created_at : ''}</div>
                  {isHr && n.title === 'Late Check-In Approval' && (
                    <div className="notif-action-row">
                      <button className="btn btn-sm btn-success" disabled={isDecided} onClick={e => handleApproveLateCheckin(e, n)}>Approve</button>
                      <button className="btn btn-sm btn-danger" disabled={isDecided} onClick={e => handleRejectLateCheckin(e, n)}>Reject</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="main-body">
          {children || <Outlet />}
        </div>
      </main>
      <NotificationSettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
    </div>
  )
}
