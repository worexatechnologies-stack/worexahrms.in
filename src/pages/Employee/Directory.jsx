import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useGetEmployeesQuery, useGetDepartmentsQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import { 
  Search, Users, Briefcase, MapPin, Calendar, Building2, 
  X, LayoutGrid, List, CheckCircle2, UserCheck, ArrowRight,
  Filter, User, ChevronLeft, ChevronRight
} from 'lucide-react'

const AVATAR_PALETTES = [
  { bg: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', text: '#dbeafe' }, // Blue
  { bg: 'linear-gradient(135deg, #312e81 0%, #6366f1 100%)', text: '#e0e7ff' }, // Indigo
  { bg: 'linear-gradient(135deg, #4c1d95 0%, #8b5cf6 100%)', text: '#ede9fe' }, // Violet
  { bg: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)', text: '#d1fae5' }, // Emerald
  { bg: 'linear-gradient(135deg, #164e63 0%, #06b6d4 100%)', text: '#cffafe' }, // Cyan
  { bg: 'linear-gradient(135deg, #701a75 0%, #d946ef 100%)', text: '#fae8ff' }, // Fuchsia
  { bg: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)', text: '#ffedd5' }, // Amber/Orange
  { bg: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)', text: '#f1f5f9' }, // Slate
]

function getAvatarPalette(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length
  return AVATAR_PALETTES[index]
}

// Avatar component with sleek executive palette
function DirAvatar({ emp, size = 68, showStatus = true }) {
  const src = emp.profile_image || ''
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const palette = getAvatarPalette(emp.name || '')
  const dotSize = size > 48 ? 12 : 8

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {src ? (
        <img
          src={src.startsWith('data:') ? src : `/api/${src}`}
          alt={emp.name}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: '2px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: palette.bg,
            color: palette.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: Math.round(size * 0.38),
            fontFamily: 'Outfit, sans-serif',
            border: '2px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            letterSpacing: '0.02em',
          }}
        >
          {initials}
        </div>
      )}
      {showStatus && (
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: emp.status === 'active' ? '#10b981' : '#94a3b8',
            border: '1.5px solid var(--bg-card, #0f172a)',
            boxShadow: 'none',
          }}
          title={emp.status === 'active' ? 'Active' : 'Inactive'}
        />
      )}
    </div>
  )
}

// Executive Profile Card (Grid View)
function ExecutiveCard({ emp, onClick }) {
  return (
    <div
      className="dir-card"
      onClick={() => onClick(emp)}
    >
      {/* Top Bar: Employee ID & Status */}
      <div className="dir-card-top">
        <span className="dir-id-badge">
          #{emp.employee_code || 'EMP'}
        </span>
        <span className={`dir-status-badge ${emp.status === 'active' ? 'active' : 'inactive'}`}>
          <span className="dir-status-dot" />
          {emp.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Avatar */}
      <div style={{ margin: '8px 0 12px' }}>
        <DirAvatar emp={emp} size={64} showStatus={false} />
      </div>

      {/* Name */}
      <h3 className="dir-name">
        {emp.name}
      </h3>

      {/* Role / Designation */}
      <div className="dir-role">
        {emp.designation || 'Team Member'}
      </div>

      {/* Meta Chips */}
      <div className="dir-meta-box">
        <div className="dir-meta-row">
          <Building2 size={13} className="dir-meta-icon" />
          <span>{emp.department || 'General Team'}</span>
        </div>
        <div className="dir-meta-subrow">
          <span className="dir-meta-subitem">
            <MapPin size={11} />
            <span>{emp.branch || 'HQ'}</span>
          </span>
          <span className="dir-meta-dot">•</span>
          <span className="dir-meta-subitem">
            <Calendar size={11} />
            <span>{emp.joining_date ? emp.joining_date.slice(0, 7) : 'Active'}</span>
          </span>
        </div>
      </div>

      {/* Action Button */}
      <button
        type="button"
        className="dir-card-btn"
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

  return createPortal(
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.7)',
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
            height: '100px',
            background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)',
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
              background: 'rgba(0, 0, 0, 0.3)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.2)',
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
        <div style={{ position: 'relative', marginTop: '-46px', padding: '0 24px', display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
          <DirAvatar emp={emp} size={84} showStatus={false} />
          <div style={{ paddingBottom: '6px', minWidth: 0 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', margin: 0, lineHeight: 1.25 }}>
              {emp.name}
            </h2>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)', marginTop: '2px', textTransform: 'capitalize' }}>
              {emp.designation || 'Team Member'}
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 24px 24px' }}>
          {/* Employee ID & Status Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--surface-2)',
              borderRadius: '12px',
              padding: '10px 16px',
              border: '1px solid var(--border)',
              marginBottom: '16px',
            }}
          >
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Employee ID
              </div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)', fontFamily: 'ui-monospace, monospace' }}>
                #{emp.employee_code || '—'}
              </div>
            </div>
            <span className={`dir-status-badge ${emp.status === 'active' ? 'active' : 'inactive'}`}>
              <span className="dir-status-dot" />
              {emp.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Building2 size={13} style={{ color: 'var(--primary)' }} />
                <span>Department</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.department || '—'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Briefcase size={13} style={{ color: '#06b6d4' }} />
                <span>Designation</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginTop: '4px', textTransform: 'capitalize' }}>
                {emp.designation || '—'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <MapPin size={13} style={{ color: '#ec4899' }} />
                <span>Location</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.branch || 'Headquarters'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <Calendar size={13} style={{ color: '#8b5cf6' }} />
                <span>Date Joined</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                {emp.joining_date || '—'}
              </div>
            </div>
          </div>

          {/* Close Action Button */}
          <div style={{ marginTop: '20px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ width: '100%', borderRadius: '12px', padding: '10px', fontWeight: 700 }}
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
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset page to 1 whenever search or department filter changes
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, deptFilter])

  // Fetch paginated active employees with field projection
  const { data: empRes, isLoading } = useGetEmployeesQuery({
    page,
    limit,
    status: 'active',
    search: debouncedSearch,
    department: deptFilter,
    mode: 'directory',
  })

  // Fetch departments list
  const { data: deptRes } = useGetDepartmentsQuery()
  const DEPARTMENTS = useMemo(() => {
    const arr = deptRes?.data ?? (Array.isArray(deptRes) ? deptRes : [])
    return arr.map(d => d.name).filter(Boolean)
  }, [deptRes])

  const rawData = empRes?.data
  const employees = useMemo(() => rawData?.employees ?? (Array.isArray(rawData) ? rawData : []), [rawData])
  const pagination = rawData?.pagination ?? null
  const totalColleagues = pagination?.total ?? employees.length
  const totalPages = pagination?.pages ?? Math.max(1, Math.ceil(totalColleagues / limit))
  const startItem = totalColleagues === 0 ? 0 : (page - 1) * limit + 1
  const endItem = Math.min(page * limit, totalColleagues)

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
    <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      
      {/* ── Filter & Search Control Panel ── */}
      <div className="dir-control-panel">
        {/* Search Row + View Switcher */}
        <div className="dir-toolbar-row">
          {/* Search Field */}
          <div className="dir-search-wrap">
            <Search size={15} className="dir-search-icon" />
            <input
              className="dir-search-input"
              placeholder="Search by colleague name, role, department, ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="dir-search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* View Mode Toggle Switcher */}
          <div className="dir-view-switcher">
            <button
              type="button"
              className={`dir-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <LayoutGrid size={15} />
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={`dir-view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="List View"
            >
              <List size={15} />
              <span>List</span>
            </button>
          </div>
        </div>

        {/* Interactive Department Filter Chips */}
        <div className="dir-filter-bar">
          <div className="dir-filter-label">
            <Filter size={12} />
            <span>Departments:</span>
          </div>

          <button
            type="button"
            className={`dir-filter-chip ${deptFilter === '' ? 'active' : ''}`}
            onClick={() => setDeptFilter('')}
          >
            <span>All</span>
            <span className="dir-filter-count">({totalColleagues})</span>
          </button>

          {DEPARTMENTS.map(d => {
            const isSelected = deptFilter === d
            const count = deptCounts[d] || 0
            return (
              <button
                key={d}
                type="button"
                className={`dir-filter-chip ${isSelected ? 'active' : ''}`}
                onClick={() => setDeptFilter(isSelected ? '' : d)}
              >
                <span>{d}</span>
                {count > 0 && <span className="dir-filter-count">({count})</span>}
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
        <div className="card" style={{ textAlign: 'center', padding: '60px 24px', borderRadius: '20px' }}>
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
        <div className="dir-grid">
          {employees.map(emp => (
            <ExecutiveCard key={emp.id} emp={emp} onClick={setSelectedEmp} />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="dir-table-card">
          <div className="dir-table-wrap">
            <table className="dir-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>Colleague</th>
                  <th style={{ width: '130px' }}>Employee ID</th>
                  <th style={{ width: '180px' }}>Department</th>
                  <th style={{ minWidth: '180px' }}>Designation</th>
                  <th style={{ width: '130px' }}>Location</th>
                  <th style={{ width: '120px' }}>Status</th>
                  <th style={{ width: '50px', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr
                    key={emp.id}
                    onClick={() => setSelectedEmp(emp)}
                    className="dir-table-row"
                  >
                    <td>
                      <div className="dir-colleague-cell">
                        <DirAvatar emp={emp} size={36} showStatus={false} />
                        <div className="dir-colleague-info">
                          <span className="dir-colleague-name">{emp.name}</span>
                          <span className="dir-colleague-sub">{emp.designation || 'Team Member'}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="dir-id-badge">
                        #{emp.employee_code}
                      </span>
                    </td>
                    <td>
                      <span className="dir-dept-tag">
                        {emp.department || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="dir-designation-text">
                        {emp.designation || '—'}
                      </span>
                    </td>
                    <td>
                      <div className="dir-location-chip">
                        <MapPin size={12} className="dir-location-icon" />
                        <span>{emp.branch || 'HQ'}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`dir-status-badge ${emp.status === 'active' ? 'active' : 'inactive'}`}>
                        <span className="dir-status-dot" />
                        {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: '18px' }}>
                      <span className="dir-row-arrow">
                        <ArrowRight size={13} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Server-Side Pagination Bar ── */}
      {totalColleagues > 0 && (
        <div
          className="card"
          style={{
            padding: '12px 20px',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            fontSize: '13px',
          }}
        >
          {/* Summary */}
          <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
            Showing <strong style={{ color: 'var(--text)' }}>{startItem}</strong> to{' '}
            <strong style={{ color: 'var(--text)' }}>{endItem}</strong> of{' '}
            <strong style={{ color: 'var(--primary)' }}>{totalColleagues}</strong> colleagues
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            {/* Limit Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>Per page:</span>
              <select
                value={limit}
                onChange={e => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
                className="form-input"
                style={{
                  height: '32px',
                  borderRadius: '8px',
                  padding: '0 8px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
                aria-label="Items per page"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Previous / Next buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="btn btn-secondary"
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  opacity: page <= 1 ? 0.5 : 1,
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
                title="Previous Page"
              >
                <ChevronLeft size={14} />
                <span>Prev</span>
              </button>

              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)', padding: '0 4px' }}>
                {page} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
                className="btn btn-secondary"
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  opacity: page >= totalPages ? 0.5 : 1,
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
                title="Next Page"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Details Modal ── */}
      <DirProfileModal emp={selectedEmp} onClose={() => setSelectedEmp(null)} />
    </div>
  )
}
