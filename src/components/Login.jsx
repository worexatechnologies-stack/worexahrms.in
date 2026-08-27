import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react'
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
    <main className="login-page flex min-h-screen items-center justify-center p-4 sm:p-8 font-sans text-white selection:bg-white/30 bg-transparent">
      {/* 
        The background is now inherited from the global styles.css body mesh gradient.
        No split-screen image is needed. We just show a centered frosted glass card.
      */}

      <div className="w-full max-w-md relative z-10">
        
        {/* iOS Glass Card */}
        <div className="rounded-[2.5rem] bg-white/10 backdrop-blur-[40px] border border-white/20 p-8 sm:p-12 shadow-[0_30px_60px_rgba(0,0,0,0.15)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] relative overflow-hidden">
          
          {/* Subtle noise texture overlay for realism */}
          <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGZpbHRlciBpZD0ibiI+PGZlVHVyYnVsZW5jZSB0eXBlPSJmcmFjdGFsTm9pc2UiIGJhc2VGcmVxdWVuY3k9IjAuNSIgbnVtT2N0YXZlcz0iMyIgc3RpdGNoVGlsZXM9InN0aXRjaCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNuKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />

          <div className="mb-10 flex flex-col items-center text-center relative z-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] backdrop-blur-md border border-white/20">
              <img className="h-9 w-9 object-contain brightness-0 invert" src={logo} alt="WOREXA" />
            </div>
            <h2 className="text-[28px] font-semibold tracking-tight text-white mb-2">Welcome Back</h2>
            <p className="text-sm font-medium text-white/70">Sign in to your enterprise workspace</p>
          </div>

          {error && (
            <div className="relative z-10 mb-8 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-md p-4 text-sm text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span className="leading-relaxed font-medium">{error}</span>
            </div>
          )}

          <form className="relative z-10 flex flex-col gap-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="mb-2 block text-[13px] font-semibold text-white/80">
                Work Email
              </label>
              <input
                className="block h-12 w-full rounded-2xl border border-white/20 bg-white/5 px-4 text-[15px] text-white transition-all focus:border-white/40 focus:bg-white/10 focus:outline-none placeholder:text-white/40 font-medium"
                type="email"
                id="email"
                placeholder="name@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={submitting || loading}
                autoComplete={rememberMe ? 'email' : 'off'}
                autoFocus
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-[13px] font-semibold text-white/80">
                  Password
                </label>
                <button 
                  type="button" 
                  disabled={submitting || loading}
                  className="text-[13px] font-semibold text-white/80 transition-colors hover:text-white"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  className="block h-12 w-full rounded-2xl border border-white/20 bg-white/5 px-4 text-[15px] text-white transition-all focus:border-white/40 focus:bg-white/10 focus:outline-none placeholder:text-white/40 font-medium pr-12"
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={submitting || loading}
                  autoComplete={rememberMe ? 'current-password' : 'off'}
                />
                <button
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 p-2 text-white/50 transition hover:text-white focus:outline-none rounded-xl hover:bg-white/10"
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={submitting || loading}
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer select-none items-center gap-3 text-sm font-medium text-white/70 hover:text-white transition-colors mt-2 w-max">
              <div className="relative flex items-center justify-center">
                <input
                  className="peer sr-only"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  disabled={submitting || loading}
                />
                <div className="h-5 w-5 rounded-lg border border-white/30 bg-white/5 transition-all peer-checked:border-white peer-checked:bg-white"></div>
                <CheckCircle2 className="absolute h-3.5 w-3.5 text-black opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3} />
              </div>
              Keep me signed in
            </label>

            <button
              className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-black shadow-lg shadow-black/10 transition-all duration-200 hover:bg-white/90 active:scale-[0.98] disabled:transform-none disabled:cursor-not-allowed disabled:opacity-70"
              type="submit"
              disabled={submitting || loading}
            >
              {(submitting || loading) && <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />}
              {submitting || loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-12 flex items-center justify-center gap-2 text-center text-xs font-semibold text-white/50 relative z-10">
            <ShieldCheck className="h-4 w-4" />
            <span>Secured with SOC2 Compliant Encryption</span>
          </div>
          
        </div>
      </div>
    </main>
  )
}
