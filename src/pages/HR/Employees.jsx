import { useState, useEffect } from 'react'
import {
  useGetEmployeesQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
  useDeleteEmployeeMutation,
  useGetDepartmentsQuery,
} from '../../store/apiSlice'
import { useToast } from '../../App'
import { Plus, RefreshCw, Edit2, Trash2, X, Search, Mail, Phone, MapPin, Briefcase, Calendar, ChevronLeft, ChevronRight, User } from 'lucide-react'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import ActionButton from '../../components/ui/ActionButton'
import ConfirmModal from '../../components/ui/ConfirmModal'
import EmployeeActionMenu from '../../components/EmployeeActionMenu'

const defaultForm = {
  employee_code: '', name: '', email: '', phone: '',
  department: '', designation: '', joining_date: '', date_of_birth: '',
  employment_type: 'full_time', basic_salary: '', status: 'active',
  branch: '', password: '',
}

function buildFormData(form, photo, isEdit) {
  const fd = new FormData()
  Object.entries(form).forEach(([k, v]) => {
    if (isEdit && k === 'password' && !v) return
    if (v === null || v === undefined || v === '') return
    fd.append(k, v)
  })
  if (photo) fd.append('profile_image', photo)
  if (isEdit) fd.append('_method', 'PUT')
  return fd
}

// Compress an image File to a target max KB using Canvas
async function compressImage(file, maxKB = 200) {
  return new Promise((resolve, reject) => {
    const maxBytes = maxKB * 1024
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (ev) => {
      const img = new Image()
      img.onerror = () => resolve(file) // can't decode, send original
      img.onload = () => {
        // Resize to max 400×400 keeping aspect ratio
        let { width, height } = img
        const maxDim = 400
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim }
          else                 { width  = Math.round(width  * maxDim / height); height = maxDim }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        // Reduce quality until under maxBytes
        let quality = 0.85
        const tryCompress = () => {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return }
            if (blob.size <= maxBytes || quality <= 0.3) {
              const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
              resolve(compressed)
            } else {
              quality -= 0.1
              tryCompress()
            }
          }, 'image/jpeg', quality)
        }
        tryCompress()
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })
}

function Avatar({ emp, size = 52 }) {
  // Handle both base64 data URIs and legacy file paths
  const imageSource = emp.profile_image
  
  if (imageSource) {
    // If it's a data URI (base64), use it directly
    if (imageSource.startsWith('data:')) {
      return (
        <img
          src={imageSource}
          alt={emp.name}
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }}
        />
      )
    }
    // Legacy: file path (for backward compatibility)
    return (
      <img
        src={`/api/${imageSource}`}
        alt={emp.name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }}
      />
    )
  }
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 13 % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue}, 65%, 55%)`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.35,
      fontFamily: 'Outfit, sans-serif', flexShrink: 0,
      border: '2px solid var(--border)',
    }}>
      {initials}
    </div>
  )
}

const EMP_TYPE_LABELS = { full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Intern' }

export default function Employees() {
  const [showModal,  setShowModal]  = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [form,       setForm]       = useState(defaultForm)
  const [photo,      setPhoto]      = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoModalEmp, setPhotoModalEmp] = useState(null)
  const [photoModalFile, setPhotoModalFile] = useState(null)
  const [photoModalPreview, setPhotoModalPreview] = useState('')
  const [photoModalRemove, setPhotoModalRemove] = useState(false)
  const [photoModalSaving, setPhotoModalSaving] = useState(false)
  const [search,     setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [page,       setPage]       = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const { toast } = useToast()
  const PER_PAGE = 12

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // ----- RTK Query Hooks -----
  const { data: employeesRes, isFetching: loading, refetch: load } = useGetEmployeesQuery({
    page,
    per_page: PER_PAGE,
    status: statusFilter === 'all' ? '' : statusFilter,
    search: debouncedSearch
  })
  
  const [createEmployee] = useCreateEmployeeMutation()
  const [updateEmployee] = useUpdateEmployeeMutation()
  const [deleteEmployee] = useDeleteEmployeeMutation()

  // Dynamic departments from DB
  const { data: deptRes } = useGetDepartmentsQuery()
  const departments = (deptRes?.data ?? (Array.isArray(deptRes) ? deptRes : []))

  const d = employeesRes?.data
  const employees = d?.employees ?? (Array.isArray(d) ? d : [])
  const pagination = d?.pagination ?? null

  const openCreate = () => { setEditing(null); setForm(defaultForm); setPhoto(null); setPhotoPreview(''); setShowModal(true) }

  const openPhotoModal = (emp) => {
    setPhotoModalEmp(emp)
    setPhotoModalFile(null)
    setPhotoModalRemove(false)
    setPhotoModalPreview(emp.profile_image
      ? emp.profile_image.startsWith('data:') ? emp.profile_image : `/api/${emp.profile_image}`
      : ''
    )
  }

  const openEdit = (emp) => {
    setEditing(emp)
    setForm({
      employee_code: emp.employee_code || '', name: emp.name || '',
      email: emp.email || '', phone: emp.phone || '',
      department: emp.department || '', designation: emp.designation || '',
      joining_date: emp.joining_date || '', date_of_birth: emp.date_of_birth || '',
      employment_type: emp.employment_type || 'full_time',
      basic_salary: emp.basic_salary || '', status: emp.status || 'active',
      branch: emp.branch || '', password: '',
    })
    setPhoto(null)
    setPhotoPreview(emp.profile_image
      ? emp.profile_image.startsWith('data:') ? emp.profile_image : `/api/${emp.profile_image}`
      : ''
    )
    setShowModal(true)
  }

  const handlePhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // Show original file as preview immediately
    setPhotoPreview(URL.createObjectURL(file))

    // Client-side compress to ≤200KB using Canvas before upload
    // This handles cases where server-side GD fails or is unavailable
    try {
      const compressed = await compressImage(file, 200)
      setPhoto(compressed)
    } catch {
      // Fallback: use original file
      setPhoto(file)
    }
  }

  const handlePhotoModal = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setPhotoModalRemove(false)
    setPhotoModalPreview(URL.createObjectURL(file))

    try {
      const compressed = await compressImage(file, 200)
      setPhotoModalFile(compressed)
    } catch {
      setPhotoModalFile(file)
    }
  }

  const handleRemoveModalPhoto = () => {
    setPhotoModalFile(null)
    setPhotoModalPreview('')
    setPhotoModalRemove(true)
  }

  const savePhotoModal = async () => {
    if (!photoModalEmp) return
    if (!photoModalFile && !photoModalRemove) return

    setPhotoModalSaving(true)
    try {
      const fd = new FormData()
      fd.append('_method', 'PUT')
      if (photoModalFile) {
        fd.append('profile_image', photoModalFile)
      }
      if (photoModalRemove) {
        fd.append('remove_profile_image', '1')
      }
      await updateEmployee({ id: photoModalEmp.id, data: fd }).unwrap()
      toast('Employee photo updated.', 'success')
      setPhotoModalEmp(null)
      setPhotoModalFile(null)
      setPhotoModalPreview('')
      setPhotoModalRemove(false)
      load()
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to update photo.', 'error')
    } finally {
      setPhotoModalSaving(false)
    }
  }



  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.employee_code) return toast('Employee ID is required.', 'error')
    if (!form.name)          return toast('Full name is required.', 'error')
    if (!form.email)         return toast('Email is required.', 'error')
    if (!form.joining_date)  return toast('Joining date is required.', 'error')
    setSubmitting(true)
    try {
      const fd = buildFormData(form, photo, !!editing)
      if (editing) {
        await updateEmployee({ id: editing.id, data: fd }).unwrap()
      } else {
        await createEmployee(fd).unwrap()
      }
      toast(editing ? 'Employee updated.' : 'Employee created.', 'success')
      setShowModal(false)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to save.', 'error')
    } finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteEmployee(deleteTarget.id).unwrap()
      toast('Employee deleted.', 'success')
      setDeleteTarget(null)
    } catch (err) {
      toast(err.data?.message || err.message || 'Delete failed.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1
  const employeeColumns = [
    {
      key: 'employee_code',
      label: 'Employee ID',
      render: (_, emp) => <span className="employee-id-cell">{emp.employee_code || '-'}</span>
    },
    {
      key: 'name',
      label: 'Employee',
      render: (_, emp) => (
        <div className="employee-name-cell">
          <button type="button" onClick={() => openPhotoModal(emp)}
            style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, cursor: 'pointer' }}
            title="View / update photo"
          >
            <Avatar emp={emp} size={38} />
          </button>
          <div className="employee-name-meta">
            <strong>{emp.name}</strong>
            <span>{emp.email || '-'}</span>
          </div>
        </div>
      )
    },
    { key: 'designation', label: 'Role', render: (_, emp) => emp.designation || '-' },
    { key: 'department', label: 'Department', render: (_, emp) => emp.department || '-' },
    { key: 'branch', label: 'Branch', render: (_, emp) => emp.branch || '-' },
    {
      key: 'status',
      label: 'Status',
      render: (_, emp) => <StatusBadge status={emp.status} />
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, emp) => (
        <EmployeeActionMenu employee={emp} onEdit={openEdit} onDelete={setDeleteTarget} />
      )
    }
  ]

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="search-bar" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="input-icon-wrap" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Search size={15} className="input-icon" />
          <input className="form-input form-input-icon" placeholder="Search name, email, code…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['active', 'inactive', 'all'].map(s => (
            <button key={s} type="button"
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setStatusFilter(s); setPage(1) }}
              style={{ textTransform: 'capitalize' }}>{s}</button>
          ))}
        </div>
        <button className="btn btn-secondary" onClick={() => load()} aria-label="Refresh employees"><RefreshCw size={14} /></button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {pagination ? pagination.total : employees.length} employees
        </span>
      </div>

      {/* ── Employee List ── */}
      {loading && employees.length === 0 ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : employees.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <User size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>{search ? 'No matches found.' : 'No employees yet.'}</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}><Plus size={14} /> Add First Employee</button>
        </div>
      ) : (
        <>
          <div className="employee-table-card">
            <DataTable
              columns={employeeColumns}
              rows={employees}
              loading={loading}
              empty="No employees found"
              className="employee-management-table"
            />
          </div>

          <div className="emp-card-grid employee-mobile-list">
            {employees.map(emp => (
              <div key={emp.id} className="emp-card">
                {/* Header */}
                <div className="emp-card-header">
                  <button type="button" onClick={() => openPhotoModal(emp)}
                    style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, cursor: 'pointer' }}
                    title="View / update photo"
                  >
                    <Avatar emp={emp} size={52} />
                  </button>
                  <div className="emp-card-identity">
                    <div className="emp-card-name">{emp.name}</div>
                    <div className="emp-card-code">ID: {emp.employee_code}</div>
                  </div>
                  <StatusBadge status={emp.status} className="emp-card-status" />
                </div>

                {/* Meta rows */}
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
                  {emp.joining_date && (
                    <div className="emp-meta-row">
                      <Calendar size={12} />
                      <span>Joined {emp.joining_date}</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="emp-card-footer">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Salary</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>
                      ₹{parseFloat(emp.basic_salary || 0).toLocaleString()}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {EMP_TYPE_LABELS[emp.employment_type] || emp.employment_type}
                  </span>
                  <EmployeeActionMenu employee={emp} onEdit={openEdit} onDelete={setDeleteTarget} />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 4px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Page {page} of {totalPages} · {pagination.total} employees
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">«</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
                <span style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 8 }}>{page}</span>
                <button className="btn btn-sm btn-secondary" onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={14} /></button>
                <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !submitting && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Edit Employee' : 'Add Employee'}</h2>
              <button className="modal-close" onClick={() => !submitting && setShowModal(false)} aria-label="Close modal"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-code">Employee ID *</label>
                  <input className="form-input" id="emp-code" value={form.employee_code}
                    onChange={e => f('employee_code', e.target.value.toUpperCase())}
                    placeholder="EMP001" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-name">Full Name *</label>
                  <input className="form-input" id="emp-name" value={form.name}
                    onChange={e => f('name', e.target.value.toUpperCase())}
                    placeholder="JOHN DOE" required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-email">Email *</label>
                  <input type="email" className="form-input" id="emp-email" value={form.email}
                    onChange={e => f('email', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-phone">Phone</label>
                  <input className="form-input" id="emp-phone" value={form.phone}
                    onChange={e => f('phone', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-password">Password {editing ? '(blank = keep existing)' : '*'}</label>
                  <input type="text" className="form-input" id="emp-password" value={form.password}
                    onChange={e => f('password', e.target.value)}
                    placeholder={editing ? 'New password (optional)' : 'Set login password'}
                    required={!editing} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-status">Status</label>
                  <select className="form-select" id="emp-status" value={form.status} onChange={e => f('status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-department">Department</label>
                  <select className="form-select" id="emp-department" value={form.department} onChange={e => f('department', e.target.value)}>
                    <option value="">Select Department</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-branch">Branch</label>
                  <input className="form-input" id="emp-branch" value={form.branch} onChange={e => f('branch', e.target.value)} placeholder="e.g. Main, Downtown" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-designation">Designation</label>
                  <input className="form-input" id="emp-designation" value={form.designation} onChange={e => f('designation', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-employment-type">Employment Type</label>
                  <select className="form-select" id="emp-employment-type" value={form.employment_type} onChange={e => f('employment_type', e.target.value)}>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-joining-date">Joining Date *</label>
                  <input type="date" className="form-input" id="emp-joining-date" value={form.joining_date}
                    onChange={e => f('joining_date', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-date-of-birth">Date of Birth</label>
                  <input type="date" className="form-input" id="emp-date-of-birth" value={form.date_of_birth}
                    onChange={e => f('date_of_birth', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-basic-salary">Basic Salary</label>
                  <input type="number" step="0.01" min="0" className="form-input" id="emp-basic-salary" value={form.basic_salary}
                    onChange={e => f('basic_salary', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-profile-photo">Profile Photo</label>
                  <input type="file" id="emp-profile-photo" accept="image/*" onChange={handlePhoto} />
                  {photoPreview && (
                    <img src={photoPreview} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', marginTop: 8, border: '2px solid var(--border)' }} />
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editing ? 'Update Employee' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {photoModalEmp && (
        <div className="modal-overlay" onClick={() => !photoModalSaving && setPhotoModalEmp(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
             <div className="modal-header">
              <h2>Photo for {photoModalEmp.name}</h2>
              <button className="modal-close" onClick={() => !photoModalSaving && setPhotoModalEmp(null)} aria-label="Close modal"><X size={18} /></button>
            </div>
            <div style={{ padding: '0 24px 20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
                {photoModalPreview ? (
                  <img src={photoModalPreview} alt="Employee photo" style={{ width: 180, height: 180, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
                ) : (
                  <div style={{ width: 180, height: 180, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 32, fontWeight: 700, border: '2px dashed var(--border)' }}>
                    No Photo
                  </div>
                )}
                 <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label className="form-label" htmlFor="photo-modal-file">Update Photo</label>
                  <input type="file" id="photo-modal-file" accept="image/*" onChange={handlePhotoModal} />
                  <button type="button" className="btn btn-secondary" onClick={handleRemoveModalPhoto} disabled={photoModalSaving}>
                    Remove Photo
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button className="btn btn-secondary" type="button" onClick={() => !photoModalSaving && setPhotoModalEmp(null)} disabled={photoModalSaving}>Close</button>
                <button className="btn btn-primary" type="button" onClick={savePhotoModal} disabled={photoModalSaving || (!photoModalFile && !photoModalRemove)}>
                  {photoModalSaving ? 'Saving…' : 'Save Photo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete employee"
          message={`Delete ${deleteTarget.name} (${deleteTarget.employee_code})? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setDeleteTarget(null)}
        />
      )}
    </>
  )
}
