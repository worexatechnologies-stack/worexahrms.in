import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useAuth } from '../App'
import { useLoginMutation } from '../store/apiSlice'
import { notificationService } from '../services/notificationService'
import { unlockAudio } from '../utils/audioHelper'
import logo from '../assets/logo.png'

function getCurrentLocation() {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new Error('Location not supported'))
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    })
  })
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [loginApi, { isLoading: loading }] = useLoginMutation()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (localStorage.getItem('hrms_session_expired') === 'true') {
      localStorage.removeItem('hrms_session_expired')
      setError('Your session has expired. Please login again.')
      notificationService.notifyError('Your session has expired. Please login again.', {
        eventId: 'auth:session-expired',
        forceSpeak: true,
      })
    }
  }, [])

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submittingRef.current || loading) return
    if (!email || !password) {
      setError('Please fill in all fields.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    unlockAudio().catch(() => {})

    const sessionId = 'login_sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now()

    let geoPayload = {}
    try {
      const position = await getCurrentLocation()
      geoPayload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }
    } catch {
      // Location is optional for login.
    }

    try {
      const res = await loginApi({ email, password, session_id: sessionId, ...geoPayload }).unwrap()
      login(res.data.user)
      notificationService.notifySuccess('Login successful. Welcome back.', {
        eventId: `auth:login-success:${res.data.user?.id || email}`,
        forceSpeak: true,
      })
      navigate('/')
    } catch (err) {
      const payload = err.data || {}
      const status = err.status
      const msg = payload.message || ''
      const lc = msg.toLowerCase()

      let finalError = ''
      if (lc.includes('pdo') || lc.includes('not enabled')) {
        finalError = msg
      } else if (status === 503 || lc.includes('connection')) {
        finalError = 'Server busy. Please try again shortly.'
      } else {
        finalError = msg || 'Invalid email or password.'
      }
      setError(finalError)
      notificationService.notifyError('Login failed. Please check your email and password.', {
        eventId: `auth:login-failed:${email}:${Date.now()}`,
        forceSpeak: true,
      })
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-8 sm:px-6 lg:justify-end lg:px-10">
      <video
        className="absolute inset-0 -z-20 h-full w-full object-cover opacity-55"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/forest-bg.png"
        aria-hidden="true"
      >
        <source src="/login-background.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(0,0,0,0.76),rgba(15,23,42,0.66),rgba(249,115,22,0.16))]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[min(34rem,80vw)] w-[min(34rem,80vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500/15 blur-3xl" />

      <section className="w-full max-w-md rounded-lg border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/50 backdrop-blur-2xl sm:p-8 lg:mr-4">
        <div className="mb-7 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/15 bg-orange-500 shadow-lg shadow-orange-500/30">
            <img className="h-10 w-10 object-contain brightness-0 invert" src={logo} alt="WOREXA" decoding="async" />
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold leading-tight text-white">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Sign in to your WOREXA HRMS workspace</p>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <label className="relative block">
            <span className="sr-only">Work email</span>
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-14 w-full rounded-lg border border-white/10 bg-white/5 px-11 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15"
              type="email"
              placeholder="Work email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={submitting || loading}
              autoComplete={rememberMe ? 'email' : 'off'}
              autoFocus
            />
          </label>

          <label className="relative block">
            <span className="sr-only">Password</span>
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-14 w-full rounded-lg border border-white/10 bg-white/5 px-11 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15"
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={submitting || loading}
              autoComplete={rememberMe ? 'current-password' : 'off'}
            />
            <button
              className="absolute right-4 top-1/2 flex -translate-y-1/2 text-slate-400 transition hover:text-orange-300"
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              disabled={submitting || loading}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-slate-300">
              <input
                className="h-4 w-4 rounded border-white/20 accent-orange-500"
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                disabled={submitting || loading}
              />
              Remember me
            </label>
            <button className="font-semibold text-orange-300 transition hover:text-orange-200" type="button" disabled={submitting || loading}>
              Forgot password?
            </button>
          </div>

          <button
            className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 transition hover:-translate-y-0.5 hover:bg-orange-600 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting || loading}
          >
            {(submitting || loading) && <span className="h-4 w-4 animate-spin-fast rounded-full border-2 border-white/40 border-t-white" />}
            {submitting || loading ? 'Signing in...' : 'Sign In Securely'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-orange-300" />
          <span>Location access is used for attendance tracking when available</span>
        </div>
      </section>
    </main>
  )
}
