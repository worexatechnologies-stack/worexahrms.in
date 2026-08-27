import { useState, useEffect } from 'react'
import { CheckCircle2, ChevronRight, Sparkles, MapPin, LayoutGrid, X } from 'lucide-react'

const TOUR_STEPS = [
  {
    title: 'Welcome to the New HRMS!',
    description: 'We have completely upgraded your workspace. Everything you need is now faster, cleaner, and organized into a sleek, responsive interface.',
    icon: <Sparkles size={28} />,
  },
  {
    title: 'Marking Your Attendance',
    description: 'Use the large "Check In" button at the top of your dashboard when you start your day. Your live timer will track your productive hours instantly.',
    icon: <MapPin size={28} />,
  },
  {
    title: 'Quick Access Tools',
    description: 'Find your Payslips, Leave Requests, and Team Chat directly in the sidebar or the quick actions grid on your dashboard.',
    icon: <LayoutGrid size={28} />,
  },
]

export default function WelcomeTour() {
  const [isVisible, setIsVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('has_seen_tour')
    if (!hasSeenTour) {
      // Small delay to allow dashboard to render before showing tour
      const timer = setTimeout(() => setIsVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      finishTour()
    }
  }

  const finishTour = () => {
    localStorage.setItem('has_seen_tour', 'true')
    setIsVisible(false)
  }

  if (!isVisible) return null

  const step = TOUR_STEPS[currentStep]

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-card, #ffffff)',
          color: 'var(--text, #0f172a)',
          borderRadius: 20,
          border: '1px solid var(--border, #e2e8f0)',
          padding: '32px 28px 26px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          animation: 'modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          boxSizing: 'border-box',
        }}
      >
        {/* Dismiss X Button */}
        <button
          type="button"
          onClick={finishTour}
          aria-label="Close Tour"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'var(--surface-2, #f1f5f9)',
            border: 'none',
            borderRadius: 8,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted, #64748b)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <X size={16} />
        </button>

        {/* Step Icon Badge */}
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 20px rgba(79, 70, 229, 0.35)',
            marginBottom: 20,
          }}
        >
          {step.icon}
        </div>

        {/* Title */}
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--text, #0f172a)',
            marginBottom: 10,
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
          }}
        >
          {step.title}
        </h2>

        {/* Description */}
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--text-secondary, #64748b)',
            marginBottom: 24,
            padding: '0 8px',
          }}
        >
          {step.description}
        </p>

        {/* Stepper Dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 26, alignItems: 'center' }}>
          {TOUR_STEPS.map((_, idx) => (
            <div
              key={idx}
              style={{
                height: 6,
                borderRadius: 999,
                width: idx === currentStep ? 24 : 6,
                background: idx === currentStep ? 'var(--primary, #4f46e5)' : 'var(--border, #cbd5e1)',
                transition: 'all 0.25s ease',
              }}
            />
          ))}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            type="button"
            onClick={finishTour}
            className="btn btn-secondary"
            style={{
              flex: 1,
              borderRadius: 12,
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Skip Tour
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="btn btn-primary"
            style={{
              flex: 1.4,
              borderRadius: 12,
              padding: '11px 18px',
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {currentStep === TOUR_STEPS.length - 1 ? (
              <>
                <span>Get Started</span>
                <CheckCircle2 size={16} />
              </>
            ) : (
              <>
                <span>Next</span>
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
