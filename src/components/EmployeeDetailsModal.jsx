import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  IndianRupee,
  Clock,
  ShieldCheck,
  Edit2,
  Camera,
  User,
  Building2,
  BadgeCheck,
} from 'lucide-react'

const EMP_TYPE_LABELS = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern'
}

export default function EmployeeDetailsModal({
  employee,
  isOpen,
  onClose,
  onEdit,
  onUpdatePhoto
}) {
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen || !employee || typeof document === 'undefined') return null

  const emp = employee
  const initials = emp.name ? emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 17 % 360

  const imageSource = emp.profile_image
  const renderAvatar = () => {
    if (imageSource) {
      const src = imageSource.startsWith('data:') || imageSource.startsWith('http')
        ? imageSource
        : `/api/${imageSource.replace(/^\/+/, '')}`
      return (
        <img
          src={src}
          alt={emp.name}
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            objectFit: 'cover',
            border: '4px solid var(--bg-card)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            background: 'var(--bg-card)'
          }}
        />
      )
    }
    return (
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: '50%',
          background: `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${(hue + 40) % 360}, 75%, 45%))`,
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 32,
          fontFamily: 'Outfit, sans-serif',
          border: '4px solid var(--bg-card)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
        }}
      >
        {initials}
      </div>
    )
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
        boxSizing: 'border-box',
        overflowY: 'auto'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '640px',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          borderRadius: '20px',
          boxShadow: '0 30px 70px -15px rgba(15, 23, 42, 0.45)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 40px)',
          animation: 'modalScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Top Decorative Banner */}
        <div
          style={{
            position: 'relative',
            background: `linear-gradient(135deg, hsl(${hue}, 65%, 48%) 0%, hsl(${(hue + 45) % 360}, 75%, 40%) 50%, #312e81 100%)`,
            padding: '24px 24px 56px',
            color: '#ffffff'
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.85)'; e.currentTarget.style.transform = 'scale(1.05)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'; e.currentTarget.style.transform = 'scale(1)' }}
          >
            <X size={18} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.9, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
           Employee Profile Details
          </div>
        </div>

        {/* Identity & Header Overlay Info */}
        <div style={{ position: 'relative', padding: '0 24px', marginTop: '-44px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ position: 'relative' }}>
              {renderAvatar()}
              {onUpdatePhoto && (
                <button
                  type="button"
                  onClick={() => onUpdatePhoto(emp)}
                  title="Update profile photo"
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 2,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    color: '#ffffff',
                    border: '2px solid var(--bg-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                  }}
                >
                  <Camera size={13} />
                </button>
              )}
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                  {emp.name}
                </h2>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: emp.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: emp.status === 'active' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                    border: `1px solid ${emp.status === 'active' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                  }}
                >
                  ● {emp.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', fontWeight: 500 }}>
                {emp.designation || 'Role Not Assigned'} · <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{emp.department || 'General'}</span>
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                border: '1px solid color-mix(in srgb, var(--primary) 25%, var(--border))'
              }}
            >
              ID: {emp.employee_code || `#${emp.id}`}
            </span>
          </div>
        </div>

        {/* Modal Body with Detailed Sections */}
        <div className="modal-body" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Section: Contact Details */}
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 16
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail size={13} className="primary" /> Contact Information
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Email Address</span>
                <a
                  href={`mailto:${emp.email}`}
                  style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 6, wordBreak: 'break-all' }}
                >
                  <Mail size={14} style={{ flexShrink: 0 }} /> {emp.email || '—'}
                </a>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Phone Number</span>
                {emp.phone ? (
                  <a
                    href={`tel:${emp.phone}`}
                    style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Phone size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} /> {emp.phone}
                  </a>
                ) : (
                  <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>—</span>
                )}
              </div>
            </div>
          </div>

          {/* Section: Employment & Organization */}
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 16
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Briefcase size={13} className="primary" /> Employment & Organization
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Department</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} style={{ color: 'var(--primary)' }} /> {emp.department || '—'}
                </span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Branch / Location</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MapPin size={14} style={{ color: 'var(--primary)' }} /> {emp.branch || '—'}
                </span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Employment Type</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BadgeCheck size={14} style={{ color: 'var(--primary)' }} /> {EMP_TYPE_LABELS[emp.employment_type] || emp.employment_type || 'Full Time'}
                </span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Joining Date</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} style={{ color: 'var(--primary)' }} /> {emp.joining_date || '—'}
                </span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Date of Birth</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={14} style={{ color: 'var(--primary)' }} /> {emp.date_of_birth || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Section: Compensation & Salary */}
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12
            }}
          >
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 2 }}>
                Basic Salary
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
                ₹{parseFloat(emp.basic_salary || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>/ month</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {emp.basic_salary && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>Estimated Annual</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>
                    ₹{(parseFloat(emp.basic_salary || 0) * 12).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer with Actions */}
        <div
          className="modal-footer"
          style={{
            flexShrink: 0,
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            {onUpdatePhoto && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onUpdatePhoto(emp) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Camera size={14} /> Update Photo
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { onClose(); onEdit(emp) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Edit2 size={14} /> Edit Employee
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
