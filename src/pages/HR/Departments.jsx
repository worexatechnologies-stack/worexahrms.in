import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  useGetDepartmentsQuery, useCreateDepartmentMutation, useUpdateDepartmentMutation, useDeleteDepartmentMutation, useSeedDepartmentsMutation,
  useGetTeamsQuery, useCreateTeamMutation, useUpdateTeamMutation, useDeleteTeamMutation, useSeedTeamsMutation,
  useGetEmployeesQuery,
} from '../../store/apiSlice'
import { useToast } from '../../App'
import {
  Plus, Edit2, Trash2, X, Building2, Users, ChevronDown, ChevronRight,
  Search, RefreshCw, User, Crown, Tag,
} from 'lucide-react'

/* ─── small colour swatch ─── */
const PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#f59e0b','#84cc16','#10b981','#14b8a6','#3b82f6',
  '#06b6d4','#a855f7','#e11d48','#fb923c','#22d3ee',
]

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {PALETTE.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          aria-label={`Select color ${c}`}
          style={{
            width: 32, height: 32, borderRadius: '50%', background: c,
            border: value === c ? `3px solid #fff` : '3px solid transparent',
            cursor: 'pointer',
            boxShadow: value === c ? `0 0 0 3px ${c}, 0 2px 8px ${c}88` : `0 2px 6px ${c}55`,
            transform: value === c ? 'scale(1.18)' : 'scale(1)',
            transition: 'transform 0.15s, box-shadow 0.15s',
            outline: 'none',
          }} />
      ))}
    </div>
  )
}

/* ─── Avatar ─── */
function Avatar({ emp, size = 32 }) {
  const src = emp?.profile_image || ''
  if (src) {
    const imgSrc = src.startsWith('data:') ? src : `/api/${src}`
    return <img src={imgSrc} alt={emp.name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }} />
  }
  const hue = (emp?.name?.charCodeAt(0) || 0) * 13 % 360
  const initials = emp?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},60%,55%)`, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.36, flexShrink: 0,
      border: '2px solid var(--border)',
    }}>{initials}</div>
  )
}

function DeptCard({ dept, onEdit, onDelete }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: dept.color || '#6366f1',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Building2 size={22} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dept.name}
          </div>
          {dept.description && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dept.description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="emp-action-btn edit-btn" onClick={() => onEdit(dept)} title="Edit department" aria-label="Edit department"><Edit2 size={13} /></button>
          <button className="emp-action-btn delete-btn" onClick={() => onDelete(dept)} title="Delete department" aria-label="Delete department"><Trash2 size={13} /></button>
        </div>
      </div>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: dept.color || 'var(--primary)', fontFamily: 'Outfit,sans-serif' }}>{dept.employee_count ?? 0}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Employees</div>
      </div>
    </div>
  )
}

/* ─── Team Card ─── */
function TeamCard({ team, allEmployees, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const lead = allEmployees.find(e => e.id === team.team_lead_id)
  const members = (team.member_ids || []).map(mid => allEmployees.find(e => e.id === mid)).filter(Boolean)

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Users size={22} style={{ color: 'var(--primary)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{team.name}</div>
          {team.department && (
            <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, background: 'var(--primary-light)', padding: '2px 8px', borderRadius: 20, display: 'inline-block', marginTop: 4 }}>
              {team.department}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="emp-action-btn edit-btn" onClick={() => onEdit(team)} title="Edit team" aria-label="Edit team"><Edit2 size={13} /></button>
          <button className="emp-action-btn delete-btn" onClick={() => onDelete(team)} title="Delete team" aria-label="Delete team"><Trash2 size={13} /></button>
        </div>
      </div>

      {team.description && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>{team.description}</p>
      )}

      {/* Lead */}
      {lead && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
          <Crown size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <Avatar emp={lead} size={26} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{lead.name}</span>
          <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 'auto', fontWeight: 600 }}>Team Lead</span>
        </div>
      )}

      {/* Member count + toggle */}
      <button onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Users size={13} />
        <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
      </button>

      {expanded && members.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <Avatar emp={m} size={26} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</div>
                {m.designation && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.designation}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Department Modal ─── */
function DeptModal({ editing, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({ name: editing?.name || '', description: editing?.description || '', color: editing?.color || '#6366f1' })
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const handleSubmit = (e) => { e.preventDefault(); onSubmit(form) }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'460px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.4)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',maxHeight:'calc(100vh - 40px)' }}>
        <div className="modal-header">
          <h2>{editing ? 'Edit Department' : 'New Department'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Department Name *</label>
              <input className="form-input" value={form.name} onChange={e => f('name', e.target.value)} required placeholder="e.g. Engineering" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => f('description', e.target.value)} placeholder="Brief description (optional)" />
            </div>
            <div className="form-group">
              <label className="form-label">Colour</label>
              <ColorPicker value={form.color} onChange={v => f('color', v)} />
            </div>
          </div>
          <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

/* ─── Team Modal ─── */
function TeamModal({ editing, onClose, onSubmit, submitting, departments, allEmployees }) {
  const [form, setForm] = useState({
    name: editing?.name || '',
    description: editing?.description || '',
    department: editing?.department || '',
    team_lead_id: editing?.team_lead_id || '',
    member_ids: editing?.member_ids || [],
  })
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const toggleMember = (empId) => {
    if (form.member_ids.includes(empId)) {
      f('member_ids', form.member_ids.filter(id => id !== empId))
    } else {
      f('member_ids', [...form.member_ids, empId])
    }
  }

  const handleSubmit = (e) => { e.preventDefault(); onSubmit(form) }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'560px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.4)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',maxHeight:'calc(100vh - 40px)' }}>
        <div className="modal-header">
          <h2>{editing ? 'Edit Team' : 'New Team'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Team Name *</label>
              <input className="form-input" value={form.name} onChange={e => f('name', e.target.value)} required placeholder="e.g. Frontend Team" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => f('description', e.target.value)} placeholder="Brief description (optional)" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="team-department">Department</label>
              <select className="form-select" id="team-department" value={form.department} onChange={e => f('department', e.target.value)}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="team-lead">Team Lead</label>
              <select className="form-select" id="team-lead" value={form.team_lead_id} onChange={e => f('team_lead_id', e.target.value)}>
                <option value="">None</option>
                {allEmployees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.employee_code})</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Members</label>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                {allEmployees.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 20 }}>No employees available</p>
                ) : allEmployees.map(e => (
                  <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 6, marginBottom: 2 }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = '' }}>
                    <input type="checkbox" checked={form.member_ids.includes(e.id)} onChange={() => toggleMember(e.id)} />
                    <Avatar emp={e} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{e.employee_code}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

/* ─── Main Page ─── */
export default function DepartmentsPage() {
  const { toast } = useToast()
  const [tab, setTab] = useState('departments') // 'departments' | 'teams'
  const [search, setSearch] = useState('')
  const [showDeptModal, setShowDeptModal] = useState(false)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [editingTeam, setEditingTeam] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: deptRes, isLoading: loadingDepts, refetch: refetchDepts } = useGetDepartmentsQuery()
  const { data: teamRes, isLoading: loadingTeams, refetch: refetchTeams } = useGetTeamsQuery()
  const { data: empRes } = useGetEmployeesQuery({ status: 'active' })

  const [createDept] = useCreateDepartmentMutation()
  const [updateDept] = useUpdateDepartmentMutation()
  const [deleteDept] = useDeleteDepartmentMutation()
  const [seedDepts] = useSeedDepartmentsMutation()
  const [createTeam] = useCreateTeamMutation()
  const [updateTeam] = useUpdateTeamMutation()
  const [deleteTeam] = useDeleteTeamMutation()
  const [seedTeams] = useSeedTeamsMutation()

  const departments = deptRes?.data ?? (Array.isArray(deptRes) ? deptRes : [])
  const teams = teamRes?.data ?? (Array.isArray(teamRes) ? teamRes : [])
  const empData = empRes?.data
  const allEmployees = empData?.employees ?? (Array.isArray(empData) ? empData : [])

  const filteredDepts = useMemo(() =>
    departments.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase())),
    [departments, search])

  const filteredTeams = useMemo(() =>
    teams.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.department?.toLowerCase().includes(search.toLowerCase())),
    [teams, search])

  /* ─── Dept handlers ─── */
  const handleSeedDepts = async () => {
    try {
      const res = await seedDepts().unwrap()
      toast(`Created ${res.data?.count ?? 8} sample departments.`, 'success')
    } catch (err) {
      toast(err.data?.message || 'Failed to seed.', 'error')
    }
  }

  const handleSeedTeams = async () => {
    try {
      const res = await seedTeams().unwrap()
      toast(`Created ${res.data?.count ?? 6} sample teams.`, 'success')
    } catch (err) {
      toast(err.data?.message || 'Failed to seed.', 'error')
    }
  }

  const handleDeptSubmit = async (form) => {
    setSubmitting(true)
    try {
      if (editingDept) {
        await updateDept({ id: editingDept.id, data: form }).unwrap()
        toast('Department updated.', 'success')
      } else {
        await createDept(form).unwrap()
        toast('Department created.', 'success')
      }
      setShowDeptModal(false); setEditingDept(null)
    } catch (err) {
      toast(err.data?.message || 'Failed to save.', 'error')
    } finally { setSubmitting(false) }
  }

  const handleDeptDelete = async (dept) => {
    if (!confirm(`Delete "${dept.name}"? Employees in this department won't be affected but must be reassigned.`)) return
    try {
      await deleteDept(dept.id).unwrap()
      toast('Department deleted.', 'success')
    } catch (err) {
      toast(err.data?.message || 'Delete failed.', 'error')
    }
  }

  /* ─── Team handlers ─── */
  const handleTeamSubmit = async (form) => {
    setSubmitting(true)
    try {
      if (editingTeam) {
        await updateTeam({ id: editingTeam.id, data: form }).unwrap()
        toast('Team updated.', 'success')
      } else {
        await createTeam(form).unwrap()
        toast('Team created.', 'success')
      }
      setShowTeamModal(false); setEditingTeam(null)
    } catch (err) {
      toast(err.data?.message || 'Failed to save.', 'error')
    } finally { setSubmitting(false) }
  }

  const handleTeamDelete = async (team) => {
    if (!confirm(`Delete team "${team.name}"?`)) return
    try {
      await deleteTeam(team.id).unwrap()
      toast('Team deleted.', 'success')
    } catch (err) {
      toast(err.data?.message || 'Delete failed.', 'error')
    }
  }

  const isLoading = loadingDepts || loadingTeams

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="search-bar" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0, display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="form-input" placeholder="Search departments…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search" style={{ paddingLeft: 36, width: '100%' }} />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search" style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center' }}><X size={14}/></button>}
        </div>

        <button className="btn btn-primary" onClick={() => { setEditingDept(null); setShowDeptModal(true) }}><Plus size={15} /> New Department</button>
        <button className="btn btn-secondary" onClick={refetchDepts} title="Refresh" aria-label="Refresh list"><RefreshCw size={14} /></button>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="loading-container"><div className="spinner" /></div>
      )}

      {/* ── Departments ── */}
      {!isLoading && tab === 'departments' && (
        filteredDepts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
            <Building2 size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
            <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 18 }}>
              {search ? 'No departments match your search.' : 'No departments yet'}
            </h3>
            {!search && (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24, lineHeight: 1.6, maxWidth: 340, margin: '0 auto 24px' }}>
                  Departments help organize your employees. Create one manually or load the default set to get started quickly.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => { setEditingDept(null); setShowDeptModal(true) }}>
                    <Plus size={14} /> Create Department
                  </button>
                  <button className="btn btn-secondary" onClick={handleSeedDepts}>
                    <RefreshCw size={14} /> Load Sample Departments
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14 }}>
                  Sample includes: IT, HR, Social Media, BBE, Accounting, Sales, SEO, Performance Marketing
                </p>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filteredDepts.map(d => (
              <DeptCard key={d.id} dept={d}
                onEdit={dept => { setEditingDept(dept); setShowDeptModal(true) }}
                onDelete={handleDeptDelete} />
            ))}
          </div>
        )
      )}

      {/* ── Modals ── */}
      {showDeptModal && <DeptModal editing={editingDept} onClose={() => { setShowDeptModal(false); setEditingDept(null) }} onSubmit={handleDeptSubmit} submitting={submitting} />}
    </>
  )
}
