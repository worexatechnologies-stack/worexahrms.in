import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sun,
  Moon,
  KeyRound,
  Clock,
  ChevronRight,
  Fingerprint,
  Building2,
  HelpCircle,
  Activity,
  Check,
  X,
  Sparkles,
  TrendingUp,
  Receipt,
  Home,
  Laptop
} from 'lucide-react'
import { useAuth, useTheme } from '../App'
import { useLoginMutation } from '../store/apiSlice'
import { notificationService } from '../services/notificationService'
import { unlockAudio } from '../utils/audioHelper'
import { MOTIVATION_QUOTES } from '../data/motivationQuotes'
import logoIcon from '../assets/logo-icon.png'
import logoDark from '../assets/logo-dark.png'

export default function Login() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('hrms_remember_email') || ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return Boolean(localStorage.getItem('hrms_remember_email'))
    } catch {
      return false
    }
  })
  const [error, setError] = useState('')
  const [capsLockActive, setCapsLockActive] = useState(false)
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSubmitted, setForgotSubmitted] = useState(false)
  const [activeFeatureTab, setActiveFeatureTab] = useState(0)

  // Real-time clock & greeting
  const [greeting, setGreeting] = useState('Welcome Back')
  const [currentTime, setCurrentTime] = useState('')
  const [currentDateFormatted, setCurrentDateFormatted] = useState('')

  const { login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const navigate = useNavigate()
  const [loginApi, { isLoading: loading }] = useLoginMutation()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const passwordInputRef = useRef(null)

  // Deterministic daily motivational quote
  const dailyQuote = useMemo(() => {
    try {
      const now = new Date()
      const start = new Date(now.getFullYear(), 0, 0)
      const diff = now - start
      const oneDay = 1000 * 60 * 60 * 24
      const dayOfYear = Math.floor(diff / oneDay)
      return MOTIVATION_QUOTES[dayOfYear % MOTIVATION_QUOTES.length] || MOTIVATION_QUOTES[0]
    } catch {
      return MOTIVATION_QUOTES[0] || 'Empower your workday with focus, clarity, and excellence.'
    }
  }, [])

  // Auto-cycle showcase tabs every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeatureTab((prev) => (prev + 1) % 3)
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  // Time & greeting updater
  useEffect(() => {
    const updateTimeAndGreeting = () => {
      const now = new Date()
      const hr = now.getHours()
      if (hr >= 4 && hr < 12) setGreeting('Good morning')
      else if (hr >= 12 && hr < 17) setGreeting('Good afternoon')
      else setGreeting('Good evening')

      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      )
      setCurrentDateFormatted(
        now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      )
    }

    updateTimeAndGreeting()
    const timer = setInterval(updateTimeAndGreeting, 1000)
    return () => clearInterval(timer)
  }, [])

  // Check expired session on mount
  useEffect(() => {
    if (localStorage.getItem('hrms_session_expired') === 'true') {
      localStorage.removeItem('hrms_session_expired')
      setError('Your session has expired. Please sign in again.')
      notificationService.notifyError('Your session has expired. Please login again.', {
        eventId: 'auth:session-expired',
        forceSpeak: true,
      })
    }
  }, [])

  // Handle keyboard CapsLock detection
  const handleKeyEvent = (e) => {
    if (e.getModifierState) {
      setCapsLockActive(e.getModifierState('CapsLock'))
    }
  }

  // Quick fill preset helper for testing or fast switching
  const handlePresetFill = (role) => {
    if (role === 'admin') {
      setEmail('admin@worexa.com')
      setPassword('admin123')
    } else if (role === 'viyana') {
      setEmail('viyana@worexa.com')
      setPassword('viyana123')
    } else {
      setEmail('employee@worexa.com')
      setPassword('emp123')
    }
    setError('')
    if (passwordInputRef.current) {
      passwordInputRef.current.focus()
    }
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submittingRef.current || loading) return
    if (!email || !password) {
      setError('Please fill in both your work email and password.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    unlockAudio().catch(() => { })

    // Save or clear rememberMe email
    try {
      if (rememberMe) {
        localStorage.setItem('hrms_remember_email', email.trim())
      } else {
        localStorage.removeItem('hrms_remember_email')
      }
    } catch { }

    const sessionId = 'login_sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now()

    // Location is optional and non-blocking
    let geoPayload = {}
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        let isGranted = false
        if (navigator.permissions && navigator.permissions.query) {
          const perm = await navigator.permissions.query({ name: 'geolocation' }).catch(() => null)
          if (perm && perm.state === 'granted') {
            isGranted = true
          }
        }
        if (isGranted) {
          const position = await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(pos),
              () => resolve(null),
              { enableHighAccuracy: false, timeout: 2000, maximumAge: 60000 }
            )
          })
          if (position?.coords) {
            geoPayload = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }
          }
        }
      } catch {
        // Location is optional - ignore errors and continue login
      }
    }

    try {
      const res = await loginApi({ email: email.trim(), password, session_id: sessionId, ...geoPayload }).unwrap()
      sessionStorage.removeItem('emp_voice_welcomed')
      login(res.data.user)
      notificationService.notifySuccess('Login successful. Welcome back.', {
        eventId: `auth:login-success:${res.data.user.id || email}`,
        forceSpeak: false,
      })
      navigate('/')
    } catch (err) {
      const payload = err.data || {}
      const status = err.status
      const msg = payload.message || ''
      const lc = msg.toLowerCase()

      let finalError = ''
      if (status === 429 || lc.includes('too many') || lc.includes('rate limit')) {
        finalError = msg || 'Too many attempts. For your security, please wait 15 minutes before retrying.'
      } else if (lc.includes('pdo') || lc.includes('not enabled')) {
        finalError = msg
      } else if (status === 503) {
        finalError = msg || 'Server temporarily busy. Please try again in a moment.'
      } else if (lc.includes('connection')) {
        finalError = msg || 'Database connection error. Please try again shortly.'
      } else {
        finalError = msg || 'Invalid email or password. Please verify your credentials.'
      }
      setError(finalError)
      notificationService.notifyError(finalError, {
        eventId: `auth:login-failed:${email}:${Date.now()}`,
        forceSpeak: true,
      })
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  const handleForgotSubmit = (e) => {
    e.preventDefault()
    if (!forgotEmail) return
    setForgotSubmitted(true)
  }

  // Feature showcase definitions
  const showcaseFeatures = [
    {
      id: 0,
      title: 'Real-Time Attendance & Biometrics',
      subtitle: 'eSSL Hardware Synchronization & GPS Geofencing',
      badge: 'Live Sync Active',
      icon: Fingerprint,
      telemetry: {
        label: 'Biometric Status',
        value: 'Terminal Connected (99.8% Accuracy)',
        sub: 'Shift: General (09:00 - 18:00)',
      },
    },
    {
      id: 1,
      title: 'Automated Payroll & Compliance',
      subtitle: 'Instant Salary Slips, Tax Calculations & Bank Export',
      badge: 'Compliance Verified',
      icon: Receipt,
      telemetry: {
        label: 'Payroll Engine',
        value: 'Zero Discrepancies Reconciled',
        sub: 'Dynamic PT, TDS & Overtime Tracking',
      },
    },
    {
      id: 2,
      title: 'Smart WFH & Leave Workflows',
      subtitle: 'Seamless Leave Requests, Real-Time Approvals & Team Visibility',
      badge: 'Frictionless Self-Service',
      icon: Home,
      telemetry: {
        label: 'WFH Tracking',
        value: 'IP & Geolocation Guard Enabled',
        sub: 'Push Notifications & Calendar Sync',
      },
    },
  ]

  const activeFeature = showcaseFeatures[activeFeatureTab]

  return (
    <main className="login-page relative min-h-screen w-full flex items-center justify-center overflow-x-hidden font-sans bg-slate-50 dark:bg-[#070b13] text-slate-900 dark:text-slate-100 selection:bg-blue-500/20">
      {/* Subtle geometric dot grid pattern (Linear / Stripe style) */}
      <div className="absolute inset-0 opacity-[0.035] dark:opacity-[0.07] bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">

          {/* Left Column: Modern Enterprise Sign-In Card */}
          <div className="lg:col-span-7 xl:col-span-6 w-full max-w-lg mx-auto lg:mx-0">
            <div className="rounded-2xl bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 p-6 sm:p-9 shadow-sm dark:shadow-2xl relative transition-all duration-200">

              {/* Card Top Bar */}
              <div className="flex items-center justify-between mb-7 pb-5 border-b border-slate-100 dark:border-slate-800/80">
                {/* Brand Lockup */}
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 p-2 shrink-0 shadow-xs">
                    <img className="h-full w-full object-contain" src={logoIcon} alt="Worexa" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold tracking-tight text-base text-slate-900 dark:text-white">
                        WOREXA
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                        ENTERPRISE
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Workforce Management OS
                    </p>
                  </div>
                </div>

                {/* Status Indicator & Theme Toggle */}
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    System Operational
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex h-8.5 w-8.5 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200 dark:border-slate-700 transition-colors"
                    title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    aria-label="Toggle theme"
                  >
                    {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Title & Subtitle */}
              <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Sign in to your workplace
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Enter your credentials to access your attendance, payroll, and workspace.
                </p>
              </div>

              {/* Error Banner */}
              {error && (
                <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200 animate-slide-up">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <div className="flex-1 leading-relaxed font-medium">
                    {error}
                  </div>
                  <button
                    type="button"
                    onClick={() => setError('')}
                    className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 p-0.5"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Login Form */}
              <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
                {/* Email Field */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Work Email
                    </label>
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 dark:text-slate-500">
                      <Mail className="h-4 w-4" />
                    </div>
                    <input
                      className="login-input block w-full rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm font-medium focus:bg-white dark:focus:bg-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all pl-10 pr-9 py-2.5"
                      type="email"
                      id="email"
                      placeholder="name@worexa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submitting || loading}
                      autoComplete={rememberMe ? 'email' : 'off'}
                      autoCapitalize="none"
                      spellCheck="false"
                      autoFocus={!email}
                    />
                    {email && (
                      <button
                        type="button"
                        onClick={() => setEmail('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        tabIndex={-1}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      disabled={submitting || loading}
                      onClick={() => setShowForgotModal(true)}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 dark:text-slate-500">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      ref={passwordInputRef}
                      className="login-input block w-full rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm font-medium focus:bg-white dark:focus:bg-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all pl-10 pr-10 py-2.5"
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleKeyEvent}
                      onKeyUp={handleKeyEvent}
                      onFocus={handleKeyEvent}
                      disabled={submitting || loading}
                      autoComplete={rememberMe ? 'current-password' : 'off'}
                    />
                    <button
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors focus:outline-none cursor-pointer"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={submitting || loading}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Real-time CapsLock detection indicator */}
                  {capsLockActive && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 animate-fade-in">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      <span>Caps Lock is currently enabled</span>
                    </div>
                  )}
                </div>

                {/* Keep me signed in & Quick Presets */}
                <div className="flex flex-wrap items-center justify-between gap-2 mt-0.5">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500/20 dark:bg-slate-900"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={submitting || loading}
                    />
                    <span>Remember my email</span>
                  </label>

                  {/* Quick preset chips for rapid testing */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Demo:</span>
                    <button
                      type="button"
                      onClick={() => handlePresetFill('admin')}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      title="Fill HR Admin credentials"
                    >
                      Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePresetFill('employee')}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      title="Fill Employee credentials"
                    >
                      Staff
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePresetFill('viyana')}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      title="Fill Viyana client credentials"
                    >
                      Viyana
                    </button>
                  </div>
                </div>

                {/* Submit Action Button */}
                <button
                  type="submit"
                  disabled={submitting || loading}
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs transition-all active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                >
                  {(submitting || loading) ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In to Workspace</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Security & Compliance Badges */}
              <div className="mt-7 pt-5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>SOC-2 Type II Certified</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>256-Bit TLS Encryption</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Multi-Tenant Isolation</span>
                </div>
              </div>

            </div>

            {/* Mobile-only daily quote */}
            <div className="lg:hidden mt-5 text-center px-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                "{dailyQuote}"
              </p>
            </div>
          </div>

          {/* Right Column: Sleek Enterprise Telemetry Showcase (lg+ only) */}
          <div className="hidden lg:flex lg:col-span-5 xl:col-span-6 flex-col gap-5 pl-0 xl:pl-4">

            {/* Operations Overview Box */}
            <div className="rounded-2xl bg-slate-900 dark:bg-[#0a0f1d] border border-slate-800 text-white p-7 shadow-xl relative overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
                <div className="flex items-center">
                  <img src={logoDark} alt="Worexa Technologies" className="h-7 w-auto object-contain" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono font-semibold text-blue-400">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>{currentTime || '00:00:00'} IST</span>
                </div>
              </div>

              {/* Feature Showcase Tab Switcher */}
              <div className="mb-5">
                <div className="flex gap-1.5 p-1 rounded-xl bg-slate-800/80 border border-slate-700/80 mb-5">
                  {showcaseFeatures.map((feat) => {
                    const IconComponent = feat.icon
                    const isCurrent = activeFeatureTab === feat.id
                    return (
                      <button
                        key={feat.id}
                        type="button"
                        onClick={() => setActiveFeatureTab(feat.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                        }`}
                      >
                        <IconComponent className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{feat.title.split(' ')[0]}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Active Showcase Feature View */}
                <div className="rounded-xl bg-slate-850/80 border border-slate-800 p-5 relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30">
                      {activeFeature.badge}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">
                      eSSL Hardware Bridge
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-1">
                    {activeFeature.title}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed mb-4">
                    {activeFeature.subtitle}
                  </p>

                  {/* Telemetry Indicator */}
                  <div className="rounded-lg bg-slate-950/70 border border-slate-800/90 p-3 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                        {activeFeature.telemetry.label}
                      </div>
                      <div className="text-xs font-bold text-emerald-400 mt-0.5">
                        {activeFeature.telemetry.value}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {activeFeature.telemetry.sub}
                      </div>
                    </div>
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                      <Activity className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Two Column Metric Badges */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>On-Time Record</span>
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div className="text-xl font-bold text-white font-mono">99.8%</div>
                  <div className="text-[10px] font-medium text-emerald-400 mt-0.5">
                    Hardware terminal verified
                  </div>
                </div>

                <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>Audit Discrepancies</span>
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                  <div className="text-xl font-bold text-white font-mono">Zero</div>
                  <div className="text-[10px] font-medium text-blue-400 mt-0.5">
                    Automated payroll audits
                  </div>
                </div>
              </div>

              {/* Daily Quote Footer */}
              <div className="pt-4 border-t border-slate-800 flex items-start gap-2.5">
                <span className="text-xl font-serif text-blue-400 leading-none">“</span>
                <div>
                  <p className="text-xs text-slate-300 italic leading-relaxed">
                    {dailyQuote}
                  </p>
                  <span className="block mt-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Engineering Culture Pulse
                  </span>
                </div>
              </div>

            </div>

            {/* Tenancy Notice */}
            <div className="flex items-center justify-between px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span>Multi-Tenant: Worexa HQ &amp; Client Portals (e.g. Viyana)</span>
              </div>
              <div>© {new Date().getFullYear()} Worexa Technologies</div>
            </div>

          </div>

        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0e1422] border border-slate-200 dark:border-slate-800 p-6 sm:p-7 shadow-xl relative"
            role="dialog"
            aria-modal="true"
          >
            {/* Modal close button */}
            <button
              type="button"
              onClick={() => {
                setShowForgotModal(false)
                setForgotSubmitted(false)
                setForgotEmail('')
              }}
              className="absolute top-5 right-5 h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Reset Password
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Worexa Enterprise Security Policy
                </p>
              </div>
            </div>

            {!forgotSubmitted ? (
              <form onSubmit={handleForgotSubmit}>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                  Enter your registered work email. We will notify your organization's HR Administrator to generate and send your secure password reset credentials.
                </p>

                <div className="mb-4">
                  <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Registered Work Email
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      placeholder="name@worexa.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="login-input block w-full rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm font-medium pl-10 pr-4 py-2.5"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 p-3 mb-5 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2.5">
                  <HelpCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Alternatively, contact organizational HR directly at{' '}
                    <strong className="font-semibold underline">hr@worexa.com</strong> for expedited in-person recovery.
                  </span>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-xs cursor-pointer"
                  >
                    Request Reset
                  </button>
                </div>
              </form>
            ) : (
              <div className="py-2 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-3 border border-emerald-500/20">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  Request Dispatched
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
                  A reset verification ticket for <strong>{forgotEmail}</strong> has been forwarded to your HR department. Please check your inbox or consult your HR administrator.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(false)
                    setForgotSubmitted(false)
                    setForgotEmail('')
                  }}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
