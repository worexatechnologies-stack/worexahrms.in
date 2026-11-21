import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, useToast, useTheme } from '../App'
import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../services/api'
import logo from '../assets/logo.png'
import logoIcon from '../assets/logo-icon.png'
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
  CalendarDays, Receipt, Bell, LogOut, Menu, X,
  ClipboardList, Search, BookUser, Building2,
  Settings, Home, ChevronRight, CheckCircle2, XCircle, Info, Clock3, AlertTriangle,
  Sun, Moon, Target, BriefcaseBusiness, Headset
} from 'lucide-react'
import NotificationSettingsModal from './NotificationSettingsModal'
import { notificationService } from '../services/notificationService'
import { unlockAudio } from '../utils/audioHelper'

const hrNavGroups = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Overview Dashboard', Icon: LayoutDashboard, end: true },
      { to: '/attendance', label: 'Attendance Hub', Icon: Clock },
    ],
  },
  {
    title: 'People & Teams',
    items: [
      { to: '/employees', label: 'Employee Directory', Icon: Users },
      { to: '/departments', label: 'Tech Squads', Icon: Building2, requireNotViyana: true },
      { to: '/recruitment', label: 'Talent & Hiring', Icon: BriefcaseBusiness },
      { to: '/performance', label: 'Goals & Reviews', Icon: Target },
    ],
  },
  {
    title: 'Operations & Payroll',
    items: [
      { to: '/payroll', label: 'Payroll Engine', Icon: DollarSign },
      { to: '/leaves', label: 'Leave Requests', Icon: FileText, badgeKey: 'leave' },
      { to: '/wfh', label: 'Remote / WFH', Icon: Home, badgeKey: 'wfh' },
    ],
  },
  {
    title: 'Platform & Audit',
    items: [
      { to: '/helpdesk', label: 'IT Helpdesk', Icon: Headset },
      { to: '/letters', label: 'HR Letters', Icon: FileText },
      { to: '/holidays', label: 'Holiday Calendar', Icon: CalendarDays, requireNotViyana: true },
      { to: '/activity-logs', label: 'Reports & Audit', Icon: ClipboardList },
    ],
  },
]

const empNavGroups = [
  {
    title: 'My Workspace',
    items: [
      { to: '/', label: 'Self-Service Home', Icon: LayoutDashboard, end: true },
      { to: '/attendance', label: 'My Attendance', Icon: Clock },
      { to: '/attendance-sheet', label: 'Daily Work Update', Icon: FileText },
    ],
  },
  {
    title: 'Leaves & Remote',
    items: [
      { to: '/leaves', label: 'My Leaves', Icon: FileText },
      { to: '/wfh', label: 'Work From Home', Icon: Home },
      { to: '/holidays', label: 'Company Holidays', Icon: CalendarDays },
    ],
  },
  {
    title: 'Finance & Directory',
    items: [
      { to: '/payslips', label: 'Salary Payslips', Icon: Receipt },
      { to: '/directory', label: 'Team Directory', Icon: BookUser },
    ],
  },
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

/* ── Browser tab notification indicator ───────────────────────────────────
   Shows a live unread-count badge in the browser tab (title + favicon) so a
   new HR/employee notification is visible even when the tab is not focused. */
const BASE_DOC_TITLE = 'Worexa Technologies HRMS'
// Use the imported asset URL (Vite resolves to the hashed file in production)
const FAVICON_SRC = logoIcon

let faviconBasePromise = null
function getFaviconBase() {
  if (!faviconBasePromise) {
    faviconBasePromise = new Promise((resolve) => {
      if (typeof document === 'undefined') { resolve(null); return }
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = FAVICON_SRC
    })
  }
  return faviconBasePromise
}

async function renderTabBadge(count) {
  if (typeof document === 'undefined') return
  const link = document.querySelector('link[rel="icon"]') || document.createElement('link')
  if (!(count > 0)) {
    link.href = FAVICON_SRC
    if (typeof link.setAttribute === 'function') link.setAttribute('type', 'image/png')
    if (link.dataset) link.dataset.badge = 'false'
    if (link.parentNode) { /* already in head */ }
    else document.head?.appendChild(link)
    return
  }

  const img = await getFaviconBase()
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (img) {
    try { ctx.drawImage(img, 0, 0, 32, 32) } catch { /* ignore */ }
  }

  const badgeRadius = count > 99 ? 14 : (count > 9 ? 9 : 7)
  const cx = 25
  const cy = 8
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 9px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count > 99 ? '99+' : String(count), cx, cy + 0.5)

  link.type = 'image/png'
  link.href = canvas.toDataURL('image/png')
  if (link.dataset) link.dataset.badge = 'true'
  if (!link.parentNode) document.head?.appendChild(link)
}

/** Keep the browser-tab title and favicon in sync with the unread count. */
export function useTabNotificationIndicator(unreadCount) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = unreadCount > 0 ? `(${Math.min(unreadCount, 99)}) ${BASE_DOC_TITLE}` : BASE_DOC_TITLE
    renderTabBadge(unreadCount)
  }, [unreadCount])
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const navigate = useNavigate()
  const location = useLocation()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false)

  const { toast } = useToast()

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
  const searchInputRef = useRef(null)

  const isHr = user?.role === 'hr'
  const isViyana = user?.company_slug === 'viyana'

  const navGroups = useMemo(() => {
    const rawGroups = isHr ? hrNavGroups : empNavGroups
    return rawGroups.map(g => ({
      ...g,
      items: g.items.filter(item => !(isViyana && item.requireNotViyana))
    })).filter(g => g.items.length > 0)
  }, [isHr, isViyana])

  const navItems = useMemo(() => {
    return navGroups.flatMap(g => g.items)
  }, [navGroups])

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (searchInputRef.current) {
          searchInputRef.current.focus()
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])
  const searchTerm = searchVal.trim().toLowerCase()
  const searchMatches = useMemo(() => (
    searchTerm
      ? navItems.filter(item => item.label.toLowerCase().includes(searchTerm))
      : []
  ), [navItems, searchTerm])

  const notifSummaryInterval = useVisibilityPolling(3000, 30000)

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
  const companyAdminLabel = useMemo(() => {
    if (user?.company_slug === 'viyana') return 'Viyana Admin'
    if (user?.company_name) return `${user.company_name} Admin`
    return 'Worexa Admin'
  }, [user?.company_slug, user?.company_name])

  const initials = useMemo(() => (
    displayUser?.name
      ? displayUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      : (user?.company_slug === 'viyana' ? 'VA' : 'WA')
  ), [displayUser?.name, user?.company_slug])

  const notifications = useMemo(() => notifData?.data?.notifications || notifData?.data || [], [notifData])
  const notifCount = useMemo(
    () => {
      if (showNotifs && notifData?.data?.unread_count !== undefined) return notifData.data.unread_count
      return notifSummaryData?.data?.unread_count ?? notifData?.data?.unread_count ?? notifications.filter(n => !n.is_read).length
    },
    [showNotifs, notifData, notifSummaryData, notifications]
  )

  // Browser tab indicator: title "(N) HRMS" + favicon badge, updates live
  useTabNotificationIndicator(notifCount)

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
    const exact = navItems.find(n => n.to === location.pathname)
    if (exact) return exact.label
    const match = [...navItems].sort((a, b) => b.to.length - a.to.length).find(n => n.end ? location.pathname === '/' : location.pathname.startsWith(n.to) && n.to !== '/')
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
        {/* Brand Header */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-emblem">
            <img src={logoIcon} alt="HRMS" className="sidebar-brand-icon-img" decoding="async" />
          </div>
          <div className="sidebar-brand-info">
            <div className="sidebar-brand-title">
              <span className="sidebar-brand-company">{user?.company_name?.toUpperCase() || 'WOREXA'}</span>
            </div>
            <div className="sidebar-brand-tag">
              <span className="brand-dot" />
              <span className="sidebar-brand-role">{isHr ? 'HR & PEOPLE OPS' : 'EMPLOYEE PORTAL'}</span>
            </div>
          </div>
        </div>

        {/* Quick Search Shortcut Button */}
        <button
          type="button"
          className="sidebar-quick-search"
          onClick={() => {
            if (searchInputRef.current) {
              searchInputRef.current.focus()
            }
          }}
          title="Search workspace (⌘K)"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={13} />
            <span>Search workspace...</span>
          </div>
          <kbd>⌘K</kbd>
        </button>

        {/* Grouped Navigation */}
        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.title} className="sidebar-nav-group">
              <div className="sidebar-nav-group-title">
                <span>{group.title}</span>
              </div>
              {group.items.map(({ to, label, Icon, end, badgeKey }) => {
                let badge = null
                if (isHr) {
                  if (badgeKey === 'leave') badge = badgeLabel(leaveUnreadCount)
                  if (badgeKey === 'wfh') badge = badgeLabel(wfhUnreadCount)
                }
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                    onClick={() => {
                      setSidebarOpen(false)
                      // Clicking a request page marks ONLY that type as viewed (persists via backend)
                      if (badgeKey === 'leave') handleMarkTypeViewed('leave')
                      if (badgeKey === 'wfh') handleMarkTypeViewed('wfh')
                    }}
                  >
                    <span className="nav-icon">
                      <Icon size={16} strokeWidth={1.8} />
                    </span>
                    <span className="nav-label">{label}</span>
                    {badge && <span className="nav-badge">{badge}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Modern Sidebar Footer with User Details & Theme Switcher */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <UserAvatar user={displayUser} initials={initials} className="avatar" />
              <span
                style={{
                  position: 'absolute',
                  bottom: -1,
                  right: -1,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  border: '2px solid #0f172a',
                }}
              />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="user-name">{displayUser?.name || companyAdminLabel}</div>
              <div className="user-role">{isHr ? companyAdminLabel : 'Staff Member'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={toggleTheme}
              className="logout-btn"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              className="logout-btn"
              onClick={handleLogout}
              title="Logout from session"
              aria-label="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
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
            <div className="header-title-container">
              <h1>{getTitle()}</h1>
            </div>
          </div>

          {/* Search bar */}
          <div className="header-search-wrap">
            <Search size={14} className="search-icon" />
            <input
              ref={searchInputRef}
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

            {/* Dark / Light Mode Switch */}
            <button
              type="button"
              className="theme-mode-toggle"
              onClick={toggleTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? (
                <Sun size={16} strokeWidth={2.2} className="toggle-icon-sun" />
              ) : (
                <Moon size={16} strokeWidth={2.2} className="toggle-icon-moon" />
              )}
            </button>

                        {/* User chip */}
            <div className="header-user-chip">
              <UserAvatar user={displayUser} initials={initials} className="chip-avatar" />
              <div>
                <div className="chip-name">{isHr ? (user?.company_slug === 'viyana' ? 'Viyana' : (user?.company_name || 'Worexa')) : (displayUser?.name?.split(' ')[0] || 'User')}</div>
                <div className="chip-role">{isHr ? companyAdminLabel : 'Employee'}</div>
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
