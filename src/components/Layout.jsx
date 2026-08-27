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
  useDecideLateCheckinMutation,
  useMarkRequestTypeViewedMutation
} from '../store/apiSlice'
import { useVisibilityPolling } from '../hooks/useVisibilityPolling'
import {
  LayoutDashboard, Users, DollarSign, Clock, FileText,
  CalendarDays, Receipt, Bell, Sun, Moon, LogOut, Menu, X,
  ClipboardList, Search, MessageCircle, BookUser, Building2,
  Settings, Home, ChevronRight, CheckCircle2, XCircle, Info, Clock3, AlertTriangle
} from 'lucide-react'
import NotificationSettingsModal from './NotificationSettingsModal'
import { notificationService } from '../services/notificationService'
import { unlockAudio } from '../utils/audioHelper'

const hrNav = [
  { to: '/',              label: 'Dashboard',    Icon: LayoutDashboard, end: true },
  { to: '/employees',     label: 'Employees',    Icon: Users },
  { to: '/departments',   label: 'Organization', Icon: Building2 },
  { to: '/payroll',       label: 'Payroll',      Icon: DollarSign },
  { to: '/attendance',    label: 'Attendance',   Icon: Clock },
  { to: '/leaves',        label: 'Leave Management', Icon: FileText },
  { to: '/wfh',           label: 'WFH Requests', Icon: Home },
  { to: '/holidays',      label: 'Holidays',     Icon: CalendarDays },
  { to: '/team-chat',     label: 'Team Chat',    Icon: MessageCircle },
  { to: '/activity-logs', label: 'Reports & Audit', Icon: ClipboardList },
]

const empNav = [
  { to: '/',                 label: 'Dashboard',       Icon: LayoutDashboard, end: true },
  { to: '/attendance',       label: 'Attendance',      Icon: Clock },
  { to: '/attendance-sheet', label: 'Daily Work Update', Icon: FileText },
  { to: '/leaves',           label: 'Leaves',          Icon: FileText },
  { to: '/wfh',              label: 'Work From Home',  Icon: Home },
  { to: '/payslips',         label: 'Payslips',        Icon: Receipt },
  { to: '/holidays',         label: 'Holidays',        Icon: CalendarDays },
  { to: '/directory',        label: 'Directory',       Icon: BookUser },
  { to: '/team-chat',        label: 'Team Chat',       Icon: MessageCircle },
]

function notificationMessage(message) {
  if (!message) return ''
  let clean = message.replace(/;decision=[^;]+/, '')
  if (clean.includes('=')) {
    const parts = clean.split(';')
    const textPart = parts.find(p => !p.includes('='))
    if (textPart) return textPart.trim()
  }
  return clean.replace(/^;+|;+$/g, '').trim()
}

function notificationDecision(message) {
  return message?.match(/;decision=([^;]+)/)?.[1] || ''
}

function notifTypeIcon(type) {
  if (type === 'success') return <CheckCircle2 size={15} />
  if (type === 'error') return <XCircle size={15} />
  if (type === 'warning') return <AlertTriangle size={15} />
  return <Info size={15} />
}

function formatNotifTime(value) {
  if (!value) return ''
  const ms = Date.parse(String(value).replace(' ', 'T'))
  if (isNaN(ms)) return String(value)
  const d = new Date(ms)
  const now = Date.now()
  const secs = Math.floor((now - ms) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`
}

function NotificationIcon({ type }) {
  return (
    <span className={`notif-icon notif-icon-${type || 'info'}`}>
      {notifTypeIcon(type)}
    </span>
  )
}

function assetUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
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
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  const notifSummaryInterval = useVisibilityPolling(3000)

  const [cursor, setCursor] = useState('')
  const lastUserRef = useRef(null)
  const lastProcessedCursor = useRef(null)

  useEffect(() => {
    if (user?.id !== lastUserRef.current) {
      setCursor('')
      lastProcessedCursor.current = null
      lastUserRef.current = user?.id || null
    }
  }, [user])

  const { data: notifSummaryData } = useGetNotificationSummaryQuery({ after: cursor }, {
    skip: !user,
    pollingInterval: notifSummaryInterval,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })

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

  useEffect(() => {
    if (!notifSummaryData?.data) return

    const { latest_event_cursor, events } = notifSummaryData.data

    if (!cursor) {
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

  const { data: notifData } = useGetNotificationsQuery(undefined, {
    skip: !user || !showNotifs,
    refetchOnMountOrArgChange: true,
  })

  // Pending counts for sidebar badges (Leave & WFH) — derived from the
  // existing notification read-status so badges persist per HR user and a new
  // request that arrives after viewing creates a fresh badge automatically.
  const leaveUnreadCount = notifSummaryData?.data?.leave_unread ?? 0
  const wfhUnreadCount = notifSummaryData?.data?.wfh_unread ?? 0
  const badgeLabel = n => n === 0 ? null : String(n)
  const [markRequestTypeViewed] = useMarkRequestTypeViewedMutation()
  const handleMarkTypeViewed = (type) => { markRequestTypeViewed(type).catch(() => {}) }

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

  const notifications = useMemo(() => notifData?.data?.notifications || notifData?.data || [], [notifData])
  const notifCount = useMemo(
    () => {
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
    <div className={`app-layout ${isHr ? 'role-hr' : 'role-employee'}`}>
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div className="mobile-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── SIDEBAR ─── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>

        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-emblem">
            <img src={logo} alt="Worexa" className="sidebar-brand-icon-img" decoding="async" />
          </div>
          <div className="sidebar-brand-info">
            <div className="sidebar-brand-title">WOREXA</div>
            <div className="sidebar-brand-tag">
              <span className="brand-dot" />
              <span>{isHr ? 'HR & PEOPLE' : 'EMPLOYEE PORTAL'}</span>
            </div>
          </div>
        </div>

        {/* Main menu label */}
        <div className="sidebar-section-label">Main Menu</div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map(({ to, label, Icon, end }) => {
            let badge = null
            if (isHr) {
              if (to === '/leaves') badge = badgeLabel(leaveUnreadCount)
              if (to === '/wfh') badge = badgeLabel(wfhUnreadCount)
            }
            return (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={() => {
                  setSidebarOpen(false)
                  // Clicking a request page marks ONLY that type as viewed (persists via backend)
                  if (to === '/leaves') handleMarkTypeViewed('leave')
                  if (to === '/wfh') handleMarkTypeViewed('wfh')
                }}
              >
                <span className="nav-icon"><Icon size={16} strokeWidth={1.8} /></span>
                <span className="nav-label">{label}</span>
                {badge ? <span className="nav-badge">{badge}</span> : (location.pathname === to || (!end && location.pathname.startsWith(to) && to !== '/') ? null : (
                  <ChevronRight size={13} style={{ opacity: 0.3, flexShrink: 0 }} />
                ))}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info">
            <UserAvatar user={displayUser} initials={initials} className="avatar" />
            <div style={{ minWidth: 0 }}>
              <div className="user-name">{displayUser?.name || 'User'}</div>
              <div className="user-role">{isHr ? 'HR Admin' : 'Employee'}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main className="main-content">

        {/* Header */}
        <header className={`main-header ${headerScrolled ? 'scrolled' : ''}`}>
          <div className="header-title-group">
            {isMobile && (
              <button
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(v => !v)}
                aria-label="Toggle sidebar"
              >
                {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            )}
            <h1>{getTitle()}</h1>
          </div>

          {/* Search bar */}
          <div className="header-search-wrap">
            <Search size={14} className="search-icon" />
            <input
              className="header-search-input"
              placeholder={isHr ? 'Search Employee, ID, Leave, etc...' : 'Search attendance, leaves, payslips...'}
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') goToSearchMatch(searchMatches[0])
                if (e.key === 'Escape') setSearchVal('')
              }}
            />
            {searchVal && (
              <button
                className="header-search-clear"
                type="button"
                onClick={() => setSearchVal('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={12} />
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
              <Bell size={17} strokeWidth={2} />
              {notifCount > 0 && <span className="notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>}
            </button>

            {/* Notification Settings */}
            <button
              className="notif-bell"
              onClick={() => setShowSettingsModal(true)}
              title="Notification Settings"
              aria-label="Notification Settings"
            >
              <Settings size={15} strokeWidth={2} />
            </button>

            {/* Theme toggle */}
            <button
              className={`theme-toggle ${theme === 'dark' ? 'dark' : ''}`}
              onClick={() => setTheme()}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label="Toggle theme"
            >
              <span className="ti sun"><Sun size={10} /></span>
              <span className="ti moon"><Moon size={10} /></span>
              <span className="theme-toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>

            {/* User chip */}
            <div className="header-user-chip">
              <UserAvatar user={displayUser} initials={initials} className="chip-avatar" />
              <div>
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
              <div className="notif-header-title-group">
                <strong className="notif-header-title">Notifications</strong>
                {notifCount > 0 && <span className="notif-header-count">{notifCount}</span>}
              </div>
              <div className="notif-header-actions">
                {notifications.length > 0 && (
                  <button className="btn btn-sm btn-secondary notif-dismiss-all-btn" onClick={handleClearNotifications}>
                    Dismiss All
                  </button>
                )}
                <button className="btn btn-sm btn-secondary notif-close-btn" onClick={() => setShowNotifs(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="notif-dropdown-content">
              {notifications.length === 0 ? (
                <div className="notif-empty">
                  <div className="notif-empty-icon-wrap">
                    <Bell size={22} />
                  </div>
                  <div className="notif-empty-title">No notifications yet</div>
                  <div className="notif-empty-desc">You're all caught up with your updates.</div>
                </div>
              ) : notifications.map(n => {
                const decision = notificationDecision(n.message)
                const isDecided = decision === 'approved' || decision === 'rejected'
                const unread = !n.is_read

                return (
                  <div
                    key={n.id}
                    className={`notif-item ${unread ? 'unread' : ''}`}
                    onClick={() => handleMarkRead(n)}
                  >
                    {unread && <span className="notif-unread-dot" aria-hidden="true" />}
                    <button
                      onClick={(e) => handleDeleteNotification(e, n.id)}
                      className="notif-dismiss"
                      title="Dismiss"
                      aria-label="Dismiss notification"
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                    <div className="notif-item-main">
                      <NotificationIcon type={n.type} />
                      <div className="notif-item-body">
                        <div className="notif-title">
                          <span>{n.title}</span>
                          {unread && <span className="notif-unread-tag">New</span>}
                        </div>
                        <div className="notif-message">{notificationMessage(n.message)}</div>
                        <div className="notif-time">{formatNotifTime(n.created_at)}</div>
                      </div>
                    </div>
                    {isHr && n.title === 'Late Check-In Approval' && (
                      <div className="notif-action-row">
                        <button
                          className="btn btn-sm btn-success"
                          disabled={isDecided}
                          onClick={e => handleApproveLateCheckin(e, n)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={isDecided}
                          onClick={e => handleRejectLateCheckin(e, n)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
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
