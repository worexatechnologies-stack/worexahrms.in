import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useGetEmployeesQuery, useGetDepartmentsQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import { 
  Search, Users, Briefcase, MapPin, Calendar, Building2, 
  X, LayoutGrid, List, CheckCircle2, UserCheck, ArrowRight,
  Filter, Sparkles, User
} from 'lucide-react'

// Avatar component with glowing gradient ring
function DirAvatar({ emp, size = 68 }) {
  const src = emp.profile_image || ''
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 23 % 360

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      {src ? (
        <img
          src={src.startsWith('data:') ? src : `/api/${src}`}
          alt={emp.name}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: '3px solid var(--bg-card, #ffffff)',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: `linear-gradient(135deg, hsl(${hue}, 75%, 52%), hsl(${(hue + 45) % 360}, 80%, 42%))`,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: size * 0.36,
            fontFamily: 'Outfit, sans-serif',
            border: '3px solid var(--bg-card, #ffffff)',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            letterSpacing: '0.04em',
          }}
        >
          {initials}
        </div>
      )}
      {/* Active pulse badge */}
      <span
        style={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: emp.status === 'active' ? '#10b981' : '#94a3b8',
          border: '2.5px solid var(--bg-card, #ffffff)',
          boxShadow: emp.status === 'active' ? '0 0 10px rgba(16, 185, 129, 0.7)' : 'none',
        }}
        title={emp.status === 'active' ? 'Active' : 'Inactive'}
      />
    </div>
  )
}

// Executive Profile Card (No email, no phone)
function ExecutiveCard({ emp, onClick }) {
  const hue = (emp.department ? emp.department.charCodeAt(0) * 19 : 210) % 360

  return (
    <div
      className="card"
      onClick={() => onClick(emp)}
      style={{
        cursor: 'pointer',
        padding: '24px 20px 20px',
        borderRadius: '22px',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        position: 'relative',
        boxShadow: '0 4px 18px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-5px)'
        e.currentTarget.style.boxShadow = '0 20px 40px -12px rgba(79, 70, 229, 0.18)'
        e.currentTarget.style.borderColor = 'var(--primary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.04)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {/* Top Bar: Employee ID */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          fontSize: '10.5px',
          fontWeight: 800,
          fontFamily: 'Outfit, sans-serif',
          color: 'var(--text-muted)',
          background: 'var(--surface-2)',
          padding: '2px 8px',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}
      >
        #{emp.employee_code || 'EMP'}
      </div>

      {/* Avatar */}
      <div style={{ marginBottom: '14px', marginTop: '6px' }}>
        <DirAvatar emp={emp} size={68} />
      </div>

      {/* Name */}
      <h3
        style={{
          fontSize: '17px',
          fontWeight: 800,
          color: 'var(--text)',
          margin: '0 0 4px 0',
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {emp.name}
      </h3>

      {/* Role / Designation Pill */}
      <div
        style={{
          fontSize: '12.5px',
          fontWeight: 700,
          color: 'var(--primary)',
          background: 'var(--primary-soft)',
          padding: '4px 12px',
          borderRadius: '999px',
          maxWidth: '90%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: '14px',
        }}
      >
        {emp.designation || 'Team Member'}
      </div>

      {/* Meta Chips */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          width: '100%',
          padding: '12px',
          borderRadius: '14px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          marginTop: 'auto',
          marginBottom: '16px',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
          <Building2 size={13} style={{ color: `hsl(${hue}, 70%, 48%)`, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {emp.department || 'General Team'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <MapPin size={11} style={{ color: '#06b6d4' }} />
            <span>{emp.branch || 'HQ'}</span>
          </span>
          <span style={{ opacity: 0.4 }}>•</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={11} style={{ color: '#8b5cf6' }} />
            <span>{emp.joining_date ? emp.joining_date.slice(0, 7) : 'Active'}</span>
          </span>
        </div>
      </div>

      {/* Action Button */}
      <button
        type="button"
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: '10px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: '12.5px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--primary)'
          e.currentTarget.style.color = '#ffffff'
          e.currentTarget.style.borderColor = 'var(--primary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'var(--surface)'
          e.currentTarget.style.color = 'var(--text)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <span>View Profile</span>
        <ArrowRight size={13} />
      </button>
    </div>
  )
}

// Profile Modal (Read-only, NO email, NO phone)
function DirProfileModal({ emp, onClose }) {
  useEffect(() => {
    if (emp) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [emp])

  if (!emp || typeof document === 'undefined') return null
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 23 % 360

  return createPortal(
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '460px',
          background: 'var(--bg-card, #ffffff)',
          color: 'var(--text, #0f172a)',
          borderRadius: '24px',
          boxShadow: '0 30px 70px rgba(0,0,0,0.35)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          animation: 'modalSlideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Top Gradient Header */}
        <div
          style={{
            height: '110px',
            background: `linear-gradient(135deg, hsl(${hue}, 75%, 50%), hsl(${(hue + 45) % 360}, 80%, 42%))`,
            position: 'relative',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Profile"
            style={{
              background: 'rgba(0, 0, 0, 0.25)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Avatar overlapping banner */}
        <div style={{ position: 'relative', marginTop: '-50px', padding: '0 24px', display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              border: '4px solid var(--bg-card, #ffffff)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              overflow: 'hidden',
              background: `linear-gradient(135deg, hsl(${hue}, 70%, 52%), hsl(${(hue + 40) % 360}, 75%, 45%))`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {emp.profile_image ? (
              <img
                src={emp.profile_image.startsWith('data:') ? emp.profile_image : `/api/${emp.profile_image}`}
                alt={emp.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: '30px', fontWeight: 800, color: '#ffffff', fontFamily: 'Outfit, sans-serif' }}>
                {initials}
              </span>
            )}
          </div>
          <div style={{ paddingBottom: '8px', minWidth: 0 }}>
            <h2 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text)', margin: 0, lineHeight: 1.2 }}>
              {emp.name}
            </h2>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--primary)', marginTop: '2px' }}>
              {emp.designation || 'Team Member'}
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 24px 26px' }}>
          {/* Employee ID Chip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--surface-2)',
              borderRadius: '12px',
              padding: '10px 16px',
              border: '1px solid var(--border)',
              marginBottom: '20px',
            }}
          >
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Employee ID
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>
                #{emp.employee_code || '—'}
              </div>
            </div>
            <div
              style={{
                fontSize: '11.5px',
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: '20px',
                background: emp.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: emp.status === 'active' ? '#10b981' : '#ef4444',
                border: '1px solid currentColor',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <CheckCircle2 size={13} />
              <span style={{ textTransform: 'capitalize' }}>{emp.status || 'Active'}</span>
            </div>
          </div>

          {/* Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Building2 size={13} style={{ color: 'var(--primary)' }} />
                <span>Department</span>
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.department || '—'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Briefcase size={13} style={{ color: '#06b6d4' }} />
                <span>Designation</span>
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.designation || '—'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <MapPin size={13} style={{ color: '#ec4899' }} />
                <span>Branch Location</span>
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.branch || 'Headquarters'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Calendar size={13} style={{ color: '#8b5cf6' }} />
                <span>Date Joined</span>
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.joining_date || '—'}
              </div>
            </div>
          </div>

          {/* Close Action Button */}
          <div style={{ marginTop: '22px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ width: '100%', borderRadius: '12px', padding: '11px', fontWeight: 700 }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function EmployeeDirectory() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'table'
  const [selectedEmp, setSelectedEmp] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Fetch all active employees
  const { data: empRes, isLoading } = useGetEmployeesQuery({
    status: 'active',
    search: debouncedSearch,
    department: deptFilter,
  })

  // Fetch departments list
  const { data: deptRes } = useGetDepartmentsQuery()
  const DEPARTMENTS = useMemo(() => {
    const arr = deptRes?.data ?? (Array.isArray(deptRes) ? deptRes : [])
    return arr.map(d => d.name).filter(Boolean)
  }, [deptRes])

  const rawData = empRes?.data
  const employees = useMemo(() => rawData?.employees ?? (Array.isArray(rawData) ? rawData : []), [rawData])
  const totalColleagues = employees.length

  // Department counts
  const deptCounts = useMemo(() => {
    const counts = {}
    employees.forEach(emp => {
      const d = emp.department || 'Unassigned'
      counts[d] = (counts[d] || 0) + 1
    })
    return counts
  }, [employees])

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* ── Filter & Search Control Panel ── */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          borderRadius: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Search Row + View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Search Field */}
          <div className="input-icon-wrap" style={{ flex: '1 1 280px', minWidth: 220 }}>
            <Search size={15} className="input-icon" />
            <input
              className="form-input form-input-icon"
              placeholder="Search by colleague name, role, department, ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ height: '42px', borderRadius: '12px' }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'var(--surface-2)',
                  border: 'none',
                  borderRadius: '6px',
                  width: 22,
                  height: 22,
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* View Mode Toggle Switcher */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--surface-2)',
              padding: 3,
              borderRadius: 12,
              border: '1px solid var(--border)',
              height: '42px',
              alignItems: 'center',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              style={{
                height: 34,
                padding: '0 14px',
                border: 'none',
                borderRadius: 9,
                background: viewMode === 'grid' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'grid' ? '#ffffff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.18s ease',
              }}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <LayoutGrid size={15} />
              <span>Grid</span>
            </button>
            <button
              type="button"
              style={{
                height: 34,
                padding: '0 14px',
                border: 'none',
                borderRadius: 9,
                background: viewMode === 'table' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'table' ? '#ffffff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.18s ease',
              }}
              onClick={() => setViewMode('table')}
              title="List View"
            >
              <List size={15} />
              <span>List</span>
            </button>
          </div>
        </div>

        {/* Interactive Department Filter Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginRight: '4px', flexShrink: 0 }}>
            <Filter size={13} />
            <span>Departments:</span>
          </div>

          <button
            type="button"
            onClick={() => setDeptFilter('')}
            style={{
              padding: '6px 14px',
              borderRadius: '999px',
              border: deptFilter === '' ? '1px solid var(--primary)' : '1px solid var(--border)',
              background: deptFilter === '' ? 'var(--primary)' : 'var(--surface-2)',
              color: deptFilter === '' ? '#ffffff' : 'var(--text-secondary)',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexShrink: 0,
            }}
          >
            <span>All</span>
            <span style={{ fontSize: '11px', opacity: 0.85 }}>({totalColleagues})</span>
          </button>

          {DEPARTMENTS.map(d => {
            const isSelected = deptFilter === d
            const count = deptCounts[d] || 0
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDeptFilter(isSelected ? '' : d)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '999px',
                  border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: isSelected ? 'var(--primary)' : 'var(--surface-2)',
                  color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                }}
              >
                <span>{d}</span>
                {count > 0 && <span style={{ fontSize: '11px', opacity: 0.85 }}>({count})</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content View ── */}
      {isLoading ? (
        <div className="loading-container" style={{ padding: '60px 0' }}>
          <div className="spinner" />
        </div>
      ) : employees.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 24px', borderRadius: '22px' }}>
          <Users size={46} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
            No colleagues match your criteria
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            {search || deptFilter ? 'Try clearing your search query or selecting a different department.' : 'No active employees in the directory.'}
          </p>
          {(search || deptFilter) && (
            <button
              type="button"
              onClick={() => { setSearch(''); setDeptFilter('') }}
              className="btn btn-secondary"
              style={{ marginTop: 16, borderRadius: 10 }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* Executive Profile Card Grid */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
            gap: '20px',
          }}
        >
          {employees.map(emp => (
            <ExecutiveCard key={emp.id} emp={emp} onClick={setSelectedEmp} />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="card" style={{ padding: 0, borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Colleague</th>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Employee ID</th>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Department</th>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Designation</th>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Location</th>
                  <th style={{ padding: '14px 18px', textAlign: 'left' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr
                    key={emp.id}
                    onClick={() => setSelectedEmp(emp)}
                    style={{ cursor: 'pointer', transition: 'background 0.12s ease' }}
                    className="data-table-row"
                  >
                    <td style={{ padding: '12px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <DirAvatar emp={emp} size={38} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{emp.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, color: 'var(--primary)', fontSize: '13px' }}>
                        #{emp.employee_code}
                      </span>
                    </td>
                    <td style={{ padding: '12px 18px', color: 'var(--text-secondary)' }}>
                      {emp.department || '—'}
                    </td>
                    <td style={{ padding: '12px 18px', color: 'var(--text)' }}>
                      {emp.designation || '—'}
                    </td>
                    <td style={{ padding: '12px 18px', color: 'var(--text-muted)' }}>
                      {emp.branch || 'HQ'}
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '20px',
                          background: emp.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                          color: emp.status === 'active' ? '#10b981' : '#ef4444',
                        }}
                      >
                        {emp.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Profile Details Modal ── */}
      <DirProfileModal emp={selectedEmp} onClose={() => setSelectedEmp(null)} />
    </div>
  )
}
