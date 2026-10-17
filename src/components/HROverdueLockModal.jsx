import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../App'
import { useGetOverdueApprovalsQuery, useUnlockOverdueApprovalsMutation } from '../store/apiSlice'
import { Lock, Unlock, ShieldAlert, KeyRound, AlertCircle, Clock, CheckCircle2, User, ChevronRight, AlertTriangle } from 'lucide-react'

export default function HROverdueLockModal({ onUnlocked }) {
  const { user } = useAuth()
  const isHr = user?.role === 'hr'

  const { data: overdueRes, isLoading, refetch } = useGetOverdueApprovalsQuery(undefined, {
    skip: !isHr,
    pollingInterval: 15000,
  })

  const [unlockMutation, { isLoading: isUnlocking }] = useUnlockOverdueApprovalsMutation()

  const overdueData = overdueRes?.data || overdueRes || {}
  const items = useMemo(() => overdueData.items || [], [overdueData.items])
  const totalOverdue = overdueData.total_overdue || items.length || 0
  const today = overdueData.today || new Date().toISOString().slice(0, 10)

  // Track if this session has been unlocked today
  const [sessionUnlocked, setSessionUnlocked] = useState(() => {
    try {
      const stored = sessionStorage.getItem('hr_dev_unlocked_date')
      return stored === today
    } catch {
      return false
    }
  })

  // PIN state: 6 digits
  const [pinDigits, setPinDigits] = useState(['', '', '', '', '', ''])
  const [pinError, setPinError] = useState('')
  const [unlockSuccess, setUnlockSuccess] = useState(false)
  const inputRefs = useRef([])

  // Keep sessionUnlocked in sync with stored date
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('hr_dev_unlocked_date')
      if (stored === today) {
        setSessionUnlocked(true)
      }
    } catch {}
  }, [today])

  // Focus first PIN input when modal is visible
  useEffect(() => {
    if (totalOverdue > 0 && !sessionUnlocked && !isLoading) {
      const t = setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 400)
      return () => clearTimeout(t)
    }
  }, [totalOverdue, sessionUnlocked, isLoading])

  const handleDigitChange = (index, value) => {
    // Only accept numeric
    const clean = value.replace(/\D/g, '')
    if (!clean) {
      const copy = [...pinDigits]
      copy[index] = ''
      setPinDigits(copy)
      setPinError('')
      return
    }

    // If user pasted multi-digit string (e.g. "225588")
    if (clean.length > 1) {
      const chars = clean.slice(0, 6).split('')
      const copy = [...pinDigits]
      chars.forEach((c, i) => {
        if (i < 6) copy[i] = c
      })
      setPinDigits(copy)
      setPinError('')
      const nextIdx = Math.min(chars.length, 5)
      inputRefs.current[nextIdx]?.focus()
      return
    }

    const copy = [...pinDigits]
    copy[index] = clean.slice(-1)
    setPinDigits(copy)
    setPinError('')

    // Move to next input
    if (index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
    } else if (e.key === 'Enter') {
      handleUnlockSubmit()
    }
  }

  const handleUnlockSubmit = async (e) => {
    if (e) e.preventDefault()
    const fullPin = pinDigits.join('')

    if (fullPin.length < 6) {
      setPinError('Please enter the complete 6-digit developer PIN.')
      return
    }

    // Verify PIN: user specified 225588
    if (fullPin !== '225588') {
      setPinError('Incorrect Developer PIN. Access remains locked.')
      setPinDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      return
    }

    try {
      await unlockMutation({ pin: fullPin }).unwrap()
    } catch {
      // Backend fallback: if PIN matched 225588, proceed
    }

    setUnlockSuccess(true)
    try {
      sessionStorage.setItem('hr_dev_unlocked_date', today)
    } catch {}

    setTimeout(() => {
      setSessionUnlocked(true)
      if (onUnlocked) onUnlocked()
      refetch()
    }, 900)
  }

  // If not HR, or still loading, or no overdue items, or already unlocked today:
  if (!isHr || isLoading || totalOverdue === 0 || sessionUnlocked) {
    return null
  }

  return createPortal(
    <div
      className="hr-lock-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: 'rgba(7, 11, 22, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <div
        className="hr-lock-modal card"
        style={{
          width: '100%',
          maxWidth: '620px',
          background: 'linear-gradient(145deg, rgba(26, 32, 53, 0.95), rgba(15, 20, 35, 0.98))',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(239, 68, 68, 0.15)',
          padding: '28px',
          color: '#f8fafc',
          position: 'relative',
        }}
      >
        {/* Top Warning Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '999px',
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <ShieldAlert size={15} />
            HR Compliance Lockout
          </div>
          <span
            style={{
              fontSize: '12px',
              color: '#94a3b8',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Clock size={13} /> Past 12:00 AM Midnight
          </span>
        </div>

        {/* Lockout Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '18px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              flexShrink: 0,
              boxShadow: '0 8px 20px rgba(239, 68, 68, 0.35)',
            }}
          >
            <Lock size={26} strokeWidth={2.4} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 800,
                color: '#fff',
                margin: '0 0 6px 0',
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
              }}
            >
              You Didn't Accept Yesterday's Pending Request(s)
            </h1>
            <p
              style={{
                fontSize: '13.5px',
                color: '#cbd5e1',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              One or more approval requests (breaks, extensions, leaves, or attendance) submitted yesterday remained unaddressed past midnight. The HR panel has been locked for policy compliance.
            </p>
          </div>
        </div>

        {/* Overdue Pending Requests List */}
        <div style={{ marginBottom: '22px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fca5a5' }}>
              Pending Overdue Items ({totalOverdue})
            </span>
            <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
              Action required today
            </span>
          </div>

          <div
            style={{
              maxHeight: '190px',
              overflowY: 'auto',
              borderRadius: '14px',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {items.map((it, idx) => (
              <div
                key={it.id || idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px',
                      flexShrink: 0,
                    }}
                  >
                    <User size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '13.5px',
                        color: '#f1f5f9',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {it.employee_name}
                      {it.employee_code && (
                        <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: '12px', marginLeft: '6px' }}>
                          ({it.employee_code})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>{it.type || 'Approval'}</span>
                      {it.subtype && <span>· {it.subtype}</span>}
                      {it.date && <span>· {it.date}</span>}
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Unaccepted
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Developer Override PIN Section */}
        <form
          onSubmit={handleUnlockSubmit}
          className={pinError ? 'hr-lock-shake' : ''}
          style={{
            background: 'rgba(30, 41, 59, 0.55)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '18px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={17} style={{ color: '#60a5fa' }} />
            <strong style={{ fontSize: '14px', color: '#e2e8f0' }}>
              Developer / Admin Override
            </strong>
          </div>

          <p style={{ margin: 0, fontSize: '12.5px', color: '#94a3b8', lineHeight: 1.4 }}>
            Enter the 6-digit Developer PIN to temporarily unlock the HR panel and take immediate action on pending requests.
          </p>

          {/* 6 Digit Inputs */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', margin: '4px 0' }}>
            {pinDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => (inputRefs.current[idx] = el)}
                type="password"
                maxLength={1}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={digit}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                disabled={unlockSuccess || isUnlocking}
                style={{
                  width: '46px',
                  height: '52px',
                  textAlign: 'center',
                  fontSize: '22px',
                  fontWeight: 800,
                  borderRadius: '12px',
                  border: pinError
                    ? '2px solid #ef4444'
                    : digit
                    ? '2px solid #3b82f6'
                    : '1px solid rgba(255, 255, 255, 0.16)',
                  background: 'rgba(15, 23, 42, 0.8)',
                  color: '#fff',
                  outline: 'none',
                  boxShadow: digit ? '0 0 12px rgba(59, 130, 246, 0.3)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              />
            ))}
          </div>

          {pinError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#ef4444',
                fontSize: '12px',
                fontWeight: 600,
                justifyContent: 'center',
              }}
            >
              <AlertCircle size={14} />
              {pinError}
            </div>
          )}

          {unlockSuccess && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#10b981',
                fontSize: '13px',
                fontWeight: 700,
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={16} />
              Developer PIN Verified! Unlocking HR Panel...
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={unlockSuccess || isUnlocking || pinDigits.some((d) => !d)}
            style={{
              width: '100%',
              minHeight: '44px',
              fontSize: '14px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              borderRadius: '12px',
              cursor: 'pointer',
              background: unlockSuccess
                ? '#10b981'
                : 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
            }}
          >
            {unlockSuccess ? (
              <>
                <Unlock size={17} /> Unlocked
              </>
            ) : (
              <>
                <KeyRound size={17} /> Unlock HR Panel
              </>
            )}
          </button>
        </form>
      </div>
    </div>,
    document.body
  )
}
