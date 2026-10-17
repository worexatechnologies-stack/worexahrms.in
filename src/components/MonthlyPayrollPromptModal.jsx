import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '../App'
import { useCheckMonthlyPayrollDueQuery, useBulkGeneratePayrollMutation } from '../store/apiSlice'
import { Calendar, Clock, CheckCircle2, ShieldCheck, ArrowRight, X, Loader2 } from 'lucide-react'

export default function MonthlyPayrollPromptModal() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const isHr = user?.role === 'hr'

  const { data: dueRes, isLoading } = useCheckMonthlyPayrollDueQuery(undefined, {
    skip: !isHr,
    pollingInterval: 120000, // Recheck every 2 minutes
  })

  const [bulkGenerate, { isLoading: generating }] = useBulkGeneratePayrollMutation()

  const dueData = dueRes?.data
  const isDue = dueData?.due === true && dueData?.missing_count > 0

  // Session dismiss key so it doesn't harass HR repeatedly once dismissed in the session
  const sessionKey = dueData ? `dismissed_payroll_prompt_${dueData.target_year}_${dueData.target_month}` : null
  const [dismissed, setDismissed] = useState(false)

  const isDismissed = sessionKey ? (dismissed || sessionStorage.getItem(sessionKey) === 'true') : false

  if (!isHr || isLoading || !isDue || isDismissed || typeof document === 'undefined') {
    return null
  }

  const handleDismiss = () => {
    if (sessionKey) sessionStorage.setItem(sessionKey, 'true')
    setDismissed(true)
  }

  const handleGenerate = async () => {
    try {
      const res = await bulkGenerate({
        month: dueData.target_month,
        year: dueData.target_year,
      }).unwrap()

      const count = res?.data?.generated_count ?? dueData.missing_count
      toast(`Generated ${count} draft payslip${count === 1 ? '' : 's'} for ${dueData.target_month_name} ${dueData.target_year}! Review and edit before sending.`, 'success')

      if (sessionKey) sessionStorage.setItem(sessionKey, 'true')
      setDismissed(true)

      // Navigate to payroll with month & year filter
      navigate(`/payroll?month=${dueData.target_month}&year=${dueData.target_year}`)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to auto-generate payroll.', 'error')
    }
  }

  return createPortal(
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999998,
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          borderRadius: '20px',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 65px -12px rgba(15, 23, 42, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header with gradient badge */}
        <div
          style={{
            position: 'relative',
            padding: '28px 24px 20px',
            background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(245, 158, 11, 0.08))',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 8px 20px -4px rgba(249, 115, 22, 0.45)',
            }}
          >
            <Calendar size={26} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  background: 'rgba(249, 115, 22, 0.15)',
                  color: '#ea580c',
                  padding: '2px 8px',
                  borderRadius: 6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Clock size={11} /> Monthly Payroll Due
              </span>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, lineHeight: 1.3 }}>
              Generate Payslips for {dueData.target_month_name} {dueData.target_year}
            </h2>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text)', margin: 0 }}>
            It’s time to process monthly payslips! There are <strong style={{ color: 'var(--primary, #f97316)' }}>{dueData.missing_count} active employees</strong> waiting for their <strong>{dueData.target_month_name} {dueData.target_year}</strong> payslips.
          </p>

          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 12,
              padding: '14px 16px',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
              <span><strong>Auto-Calculated:</strong> Uses each employee's base salary from profile.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
              <span><strong>Saved as Draft:</strong> Hidden from employees until you send them.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <span><strong>Full Control:</strong> Review and edit allowances & deductions before sending.</span>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDismiss}
            disabled={generating}
            style={{ fontSize: '13px', padding: '9px 18px' }}
          >
            Remind Me Later
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{
              fontSize: '13px',
              padding: '9px 20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
              boxShadow: '0 4px 14px rgba(249, 115, 22, 0.35)',
            }}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="spin" /> Generating Drafts…
              </>
            ) : (
              <>
                OK, Generate For All ({dueData.missing_count}) <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
