import { useState, useEffect } from 'react'
import { useGetEmployeesQuery, useGetDepartmentsQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import { Search, Users, Briefcase, Mail, Phone, MapPin, Calendar, Building2, ChevronDown, ChevronRight, X } from 'lucide-react'

// Helper: get department names from API

// Avatar: handles base64, legacy path, or initials fallback
function Avatar({ emp, size = 48 }) {
  const src = emp.profile_image || ''
  if (src) {
    const imgSrc = src.startsWith('data:') ? src : `/api/${src}`
    return (
      <img
        src={imgSrc}
        alt={emp.name}
        style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover',
          border: '2.5px solid var(--border)', flexShrink: 0,
        }}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
    )
  }
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 13 % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue}, 60%, 55%)`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.36,
      fontFamily: 'Outfit, sans-serif', flexShrink: 0,
      border: '2.5px solid var(--border)',
    }}>
      {initials}
    </div>
  )
}

// Employee profile card (read-only)
function EmpCard({ emp, onClick }) {
  return (
    <div
      className="emp-card"
      style={{ cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
      onClick={() => onClick(emp)}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      <div className="emp-card-header">
        <Avatar emp={emp} size={52} />
        <div className="emp-card-identity">
          <div className="emp-card-name">{emp.name}</div>
          <div className="emp-card-code">{emp.employee_code}</div>
        </div>
      </div>
      <div className="emp-card-meta">
        {emp.designation && (
          <div className="emp-meta-row">
            <Briefcase size={12} />
            <span>{emp.designation}{emp.department ? ` · ${emp.department}` : ''}</span>
          </div>
        )}
        {emp.email && (
          <div className="emp-meta-row">
            <Mail size={12} />
            <span className="emp-meta-truncate">{emp.email}</span>
          </div>
        )}
        {emp.phone && (
          <div className="emp-meta-row">
            <Phone size={12} />
            <span>{emp.phone}</span>
          </div>
        )}
        {emp.branch && (
          <div className="emp-meta-row">
            <MapPin size={12} />
            <span>{emp.branch}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Department group for hierarchy view
function DeptGroup({ department, employees, onSelect }) {
  const [expanded, setExpanded] = useState(true)
  const hue = department ? (department.charCodeAt(0) * 17) % 360 : 220

  return (
    <div style={{ marginBottom: 28 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '10px 0 10px 4px', marginBottom: 12,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `hsl(${hue}, 60%, 55%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Building2 size={16} color="#fff" />
        </div>
        <div style={{ textAlign: 'left', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
            {department || 'Unassigned'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {employees.length} {employees.length === 1 ? 'member' : 'members'}
          </div>
        </div>
        {expanded
          ? <ChevronDown size={16} style={{ color: 'var(--text-secondary)' }} />
          : <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
        }
      </button>
      {expanded && (
        <div className="emp-card-grid">
          {employees.map(emp => (
            <EmpCard key={emp.id} emp={emp} onClick={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// Profile detail modal (read-only)
function ProfileModal({ emp, onClose }) {
  if (!emp) return null
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 13 % 360

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 460, padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header banner */}
        <div style={{
          background: `linear-gradient(135deg, hsl(${hue}, 60%, 45%), hsl(${hue}, 70%, 60%))`,
          padding: '32px 24px 60px',
          position: 'relative',
        }}>
          <button
            onClick={onClose}
            aria-label="Close Profile"
            style={{
              position: 'absolute', top: 14, right: 14,
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%',
              width: 32, height: 32, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}
          >
            <X size={16} />
          </button>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 18, fontWeight: 700 }}>{emp.name}</h2>
          <p style={{ color: 'rgba(255,255,255,0.85)', margin: '4px 0 0', fontSize: 13 }}>
            {emp.designation || 'Employee'}
          </p>
        </div>

        {/* Avatar overlapping banner */}
        <div style={{ position: 'relative', marginTop: -44, paddingLeft: 24, marginBottom: 8 }}>
          {emp.profile_image ? (
            <img
              src={emp.profile_image.startsWith('data:') ? emp.profile_image : `/api/${emp.profile_image}`}
              alt={emp.name}
              style={{
                width: 88, height: 88, borderRadius: '50%', objectFit: 'cover',
                border: '4px solid var(--bg-primary)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}
            />
          ) : (
            <div style={{
              width: 88, height: 88, borderRadius: '50%',
              background: `hsl(${hue}, 60%, 55%)`,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 32, fontFamily: 'Outfit, sans-serif',
              border: '4px solid var(--bg-primary)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            }}>
              {initials}
            </div>
          )}
        </div>

        {/* Info grid */}
        <div style={{ padding: '8px 24px 24px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 16,
          }}>
            <InfoItem icon={<Briefcase size={13} />} label="Department" value={emp.department || '—'} />
            <InfoItem icon={<Briefcase size={13} />} label="Designation" value={emp.designation || '—'} />
            <InfoItem icon={<Mail size={13} />} label="Email" value={emp.email || '—'} />
            <InfoItem icon={<Phone size={13} />} label="Phone" value={emp.phone || '—'} />
            <InfoItem icon={<MapPin size={13} />} label="Branch" value={emp.branch || '—'} />
            <InfoItem icon={<Calendar size={13} />} label="Joined" value={emp.joining_date || '—'} />
          </div>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
              color: 'var(--text-secondary)',
            }}>Employee ID</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Outfit, sans-serif', color: 'var(--primary)' }}>
              {emp.employee_code}
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 11,
              background: emp.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: emp.status === 'active' ? 'var(--success)' : 'var(--danger)',
              border: '1px solid currentColor', borderRadius: 20, padding: '2px 8px', fontWeight: 600,
            }}>{emp.status}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ icon, label, value }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', marginBottom: 3 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

export default function EmployeeDirectory() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [view, setView] = useState('hierarchy') // 'hierarchy' | 'grid'
  const [selectedEmp, setSelectedEmp] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Fetch all active employees without pagination (directory use case)
  const { data: empRes, isLoading } = useGetEmployeesQuery({
    status: 'active',
    search: debouncedSearch,
    department: deptFilter,
  })

  // Fetch departments from DB
  const { data: deptRes } = useGetDepartmentsQuery()
  const DEPARTMENTS = (deptRes?.data ?? (Array.isArray(deptRes) ? deptRes : [])).map(d => d.name)

  const rawData = empRes?.data
  const employees = rawData?.employees ?? (Array.isArray(rawData) ? rawData : [])

  // Group by department for hierarchy view
  const grouped = employees.reduce((acc, emp) => {
    const dept = emp.department || ''
    if (!acc[dept]) acc[dept] = []
    acc[dept].push(emp)
    return acc
  }, {})

  // Sort departments: known departments first, then unknowns, then unassigned last
  const sortedDepts = Object.keys(grouped).sort((a, b) => {
    if (!a) return 1
    if (!b) return -1
    const ai = DEPARTMENTS.indexOf(a)
    const bi = DEPARTMENTS.indexOf(b)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b)
  })

  const totalCount = employees.length

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="search-bar" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="input-icon-wrap" style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Search size={15} className="input-icon" />
          <input
            className="form-input form-input-icon"
            placeholder="Search by name, email, code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Department filter */}
        <select
          className="form-select"
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          aria-label="Filter by department"
          style={{ flex: '0 0 auto', minWidth: 160 }}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`btn btn-sm ${view === 'hierarchy' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView('hierarchy')}
            title="Department hierarchy view"
          >
            <Building2 size={14} /> Departments
          </button>
          <button
            className={`btn btn-sm ${view === 'grid' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView('grid')}
            title="All employees grid"
          >
            <Users size={14} /> All
          </button>
        </div>

        <span style={{ fontSize: 13, color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {totalCount} {totalCount === 1 ? 'employee' : 'employees'}
        </span>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : employees.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <Users size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
            {search ? 'No employees match your search.' : 'No employees found.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <div className="emp-card-grid">
          {employees.map(emp => (
            <EmpCard key={emp.id} emp={emp} onClick={setSelectedEmp} />
          ))}
        </div>
      ) : (
        <div>
          {sortedDepts.map(dept => (
            <DeptGroup
              key={dept || '__none__'}
              department={dept}
              employees={grouped[dept]}
              onSelect={setSelectedEmp}
            />
          ))}
        </div>
      )}

      {/* ── Profile Modal ── */}
      <ProfileModal emp={selectedEmp} onClose={() => setSelectedEmp(null)} />
    </>
  )
}
