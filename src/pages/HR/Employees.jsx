import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  useGetEmployeesQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
  useDeleteEmployeeMutation,
  useGetDepartmentsQuery,
} from '../../store/apiSlice'
import { useToast, useAuth } from '../../App'
import { Plus, RefreshCw, Edit2, Trash2, X, Search, Mail, Phone, MapPin, Briefcase, Calendar, ChevronLeft, ChevronRight, User, LayoutGrid, List, Camera, UploadCloud, Loader2, Image as ImageIcon, Eye, EyeOff, Key, Users, UserCheck, Building2, Filter } from 'lucide-react'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/ui/StatusBadge'
import ActionButton from '../../components/ui/ActionButton'
import ConfirmModal from '../../components/ui/ConfirmModal'
import EmployeeActionMenu from '../../components/EmployeeActionMenu'
import EmployeeDetailsModal from '../../components/EmployeeDetailsModal'

const defaultForm = {
  employee_code: '', name: '', email: '', phone: '',
  department: '', designation: '', joining_date: '', date_of_birth: '',
  employment_type: 'full_time', basic_salary: '', status: 'active',
  branch: '', password: '',
  personal_profile: { preferred_name: '', gender: '', pronouns: '', nationality: '', marital_status: '', blood_group: '', personal_email: '', alternate_phone: '', address_line_1: '', address_line_2: '', city: '', state: '', postal_code: '', country: 'India' },
  emergency_contact: { name: '', relationship: '', phone: '', email: '' },
  employment_details: { team: '', manager_name: '', work_location: '', work_mode: 'hybrid', probation_end_date: '', confirmation_date: '', notice_period_days: '', shift: '', timezone: 'Asia/Kolkata' },
  compensation_details: { currency: 'INR', pay_frequency: 'monthly', bank_account_name: '', bank_account: '', bank_ifsc: '', pan_number: '', uan: '', variable_pay: '' },
  it_profile: { github: '', linkedin: '', skills: '', certifications: '', laptop_asset_tag: '', laptop_model: '', operating_system: '', tools_access: '', security_training_date: '' },
}

function buildFormData(form, photo, isEdit) {
  const fd = new FormData()
  Object.entries(form).forEach(([k, v]) => {
    if (isEdit && k === 'password' && !v) return
    if (v === null || v === undefined || v === '') return
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v)
  })
  if (photo) fd.append('profile_image', photo)
  if (isEdit) fd.append('_method', 'PUT')
  return fd
}

const profileSections = [
  { key: 'personal_profile', title: 'Personal & address details', fields: [
    ['preferred_name', 'Preferred name'], ['gender', 'Gender'], ['pronouns', 'Pronouns'], ['nationality', 'Nationality'],
    ['marital_status', 'Marital status'], ['blood_group', 'Blood group'], ['personal_email', 'Personal email', 'email'],
    ['alternate_phone', 'Alternate phone', 'tel'], ['address_line_1', 'Address line 1'], ['address_line_2', 'Address line 2'],
    ['city', 'City'], ['state', 'State / region'], ['postal_code', 'Postal code'], ['country', 'Country'],
  ] },
  { key: 'emergency_contact', title: 'Emergency contact', fields: [
    ['name', 'Contact name'], ['relationship', 'Relationship'], ['phone', 'Contact phone', 'tel'], ['email', 'Contact email', 'email'],
  ] },
  { key: 'employment_details', title: 'Team & work setup', fields: [
    ['team', 'Squad / team'], ['manager_name', 'Reporting manager'], ['work_location', 'Work location'], ['work_mode', 'Work mode'],
    ['probation_end_date', 'Probation end', 'date'], ['confirmation_date', 'Confirmation date', 'date'],
    ['notice_period_days', 'Notice period (days)', 'number'], ['shift', 'Shift'], ['timezone', 'Time zone'],
  ] },
  { key: 'compensation_details', title: 'Payroll & statutory details · HR only', fields: [
    ['currency', 'Currency'], ['pay_frequency', 'Pay frequency'], ['variable_pay', 'Annual variable pay', 'number'],
    ['bank_account_name', 'Bank account holder'], ['bank_account', 'Bank account number'], ['bank_ifsc', 'IFSC / routing code'],
    ['pan_number', 'PAN / tax ID'], ['uan', 'UAN / pension ID'],
  ] },
  { key: 'it_profile', title: 'Engineering profile & equipment', fields: [
    ['github', 'GitHub profile', 'url'], ['linkedin', 'LinkedIn profile', 'url'], ['skills', 'Skills / tech stack'],
    ['certifications', 'Certifications'], ['laptop_asset_tag', 'Laptop asset tag'], ['laptop_model', 'Laptop model'],
    ['operating_system', 'Operating system'], ['tools_access', 'Assigned tools / access'], ['security_training_date', 'Security training date', 'date'],
  ] },
]

function EmployeeExtraFields({ form, onChange }) {
  return <div className="employee-extra-fields">{profileSections.map(section => <details className="employee-extra-section" key={section.key}>
    <summary>{section.title}<span>{section.fields.length} fields</span></summary>
    <div className="employee-extra-grid">{section.fields.map(([key, label, type = 'text']) => <label className="employee-extra-field" key={key}>
      <span>{label}</span><input type={type} value={form[section.key]?.[key] ?? ''} onChange={e => onChange(section.key, key, e.target.value)} />
    </label>)}</div>
  </details>)}</div>
}

// Format join date nicely: e.g. "22 Dec 2025"
function formatJoinedDate(dateStr) {
  if (!dateStr) return 'Joined —'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return `Joined ${dateStr}`
    return `Joined ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
  } catch {
    return `Joined ${dateStr}`
  }
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
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--bg-card)' }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )
    }
    // Legacy: file path (for backward compatibility)
    return (
      <img
        src={`/api/${imageSource}`}
        alt={emp.name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--bg-card)' }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    )
  }
  const initials = emp.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = ((emp.name?.charCodeAt(0) || 0) * 23 + (emp.name?.charCodeAt(1) || 0) * 7) % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + 45) % 360}, 75%, 40%))`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.36,
      fontFamily: 'Outfit, sans-serif', flexShrink: 0,
      border: '3px solid var(--bg-card)',
      letterSpacing: '0.04em'
    }}>
      {initials}
    </div>
  )
}

const EMP_TYPE_LABELS = { full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Intern' }

export default function Employees() {
  const { user } = useAuth()
  const isViyana = user?.company_slug === 'viyana'
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
  const [selectedDetailsEmp, setSelectedDetailsEmp] = useState(null)
  const [search,     setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [page,       setPage]       = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const { toast } = useToast()
  const PER_PAGE = 12

  const photoFileInputRef = useRef(null)

  useEffect(() => {
    if (showModal || photoModalEmp || deleteTarget || selectedDetailsEmp) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showModal, photoModalEmp, deleteTarget, selectedDetailsEmp])

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const [selectedDept, setSelectedDept] = useState('all')

  // ----- RTK Query Hooks -----
  const { data: employeesRes, isFetching: loading, refetch: load } = useGetEmployeesQuery({
    page,
    per_page: PER_PAGE,
    status: statusFilter === 'all' ? '' : statusFilter,
    department: selectedDept === 'all' ? '' : selectedDept,
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

  const totalEmployeesCount = pagination ? pagination.total : employees.length
  const activeCount = employees.filter(e => e.status === 'active').length
  const departmentsCount = departments.length || (new Set(employees.map(e => e.department).filter(Boolean)).size)
  const fullTimeCount = employees.filter(e => e.employment_type === 'full_time').length

  const openCreate = () => {
    setEditing(null)
    setForm(defaultForm)
    setPhoto(null)
    setPhotoPreview('')
    setShowNewPwd(false)
    setShowModal(true)
  }

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
    setShowNewPwd(false)
    setForm({
      employee_code: emp.employee_code || '', name: emp.name || '',
      email: emp.email || '', phone: emp.phone || '',
      department: emp.department || '', designation: emp.designation || '',
      joining_date: emp.joining_date || '', date_of_birth: emp.date_of_birth || '',
      employment_type: emp.employment_type || 'full_time',
      basic_salary: emp.basic_salary != null && emp.basic_salary !== '' ? String(emp.basic_salary) : '',
      status: emp.status || 'active',
      branch: emp.branch || '', password: '',
      personal_profile: { ...defaultForm.personal_profile, ...(emp.personal_profile || {}) },
      emergency_contact: { ...defaultForm.emergency_contact, ...(emp.emergency_contact || {}) },
      employment_details: { ...defaultForm.employment_details, ...(emp.employment_details || {}) },
      compensation_details: { ...defaultForm.compensation_details, ...(emp.compensation_details || {}) },
      it_profile: { ...defaultForm.it_profile, ...(emp.it_profile || {}) },
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
  const profileField = (group, key, value) => setForm(p => ({ ...p, [group]: { ...(p[group] || {}), [key]: value } }))
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
        <div
          className="employee-name-cell"
          onClick={() => setSelectedDetailsEmp(emp)}
          style={{ cursor: 'pointer' }}
          title="Click to view full employee details"
        >
          <Avatar emp={emp} size={38} />
          <div className="employee-name-meta">
            <strong>{emp.name}</strong>
            <span>{emp.email || '-'}</span>
          </div>
        </div>
      )
    },
    { key: 'designation', label: 'Role', render: (_, emp) => emp.designation || '-' },
    ...(!isViyana ? [{ key: 'department', label: 'Department', render: (_, emp) => emp.department || '-' }] : []),
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
      {/* ── Executive KPI Overview ── */}
      <div className="emp-overview-kpis animate-fade-in">
        <div
          className="emp-kpi-card"
          onClick={() => { setStatusFilter('all'); setSelectedDept('all'); setSearch(''); setPage(1) }}
          title="Click to view all employees"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon navy"><Users size={20} /></div>
            <span className="emp-kpi-badge">Staff Count</span>
          </div>
          <div className="emp-kpi-value">{totalEmployeesCount}</div>
          <div className="emp-kpi-label">Total Registered Employees</div>
        </div>

        <div
          className="emp-kpi-card"
          onClick={() => { setStatusFilter('active'); setPage(1) }}
          title="Click to filter active workforce"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon green"><UserCheck size={20} /></div>
            <span className="emp-kpi-badge" style={{ color: '#059669', background: '#ecfdf3' }}>● Active</span>
          </div>
          <div className="emp-kpi-value">{activeCount}</div>
          <div className="emp-kpi-label">Active Workforce</div>
        </div>

        <div
          className="emp-kpi-card"
          onClick={() => setSelectedDept('all')}
          title="Total functional departments"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon purple"><Building2 size={20} /></div>
            <span className="emp-kpi-badge">Units</span>
          </div>
          <div className="emp-kpi-value">{departmentsCount}</div>
          <div className="emp-kpi-label">Functional Departments</div>
        </div>

        <div
          className="emp-kpi-card"
          title="Full-time staff members"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon cyan"><Briefcase size={20} /></div>
            <span className="emp-kpi-badge">Contract</span>
          </div>
          <div className="emp-kpi-value">{fullTimeCount}</div>
          <div className="emp-kpi-label">Full-Time Personnel</div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="search-bar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="input-icon-wrap" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Search size={15} className="input-icon" />
          <input className="form-input form-input-icon" placeholder="Search name, email, code…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Department Filter */}
        {!isViyana && departments.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <select
              className="form-input"
              style={{
                width: 'auto',
                minWidth: 150,
                padding: '7px 12px',
                fontSize: 13,
                borderRadius: 10,
                cursor: 'pointer',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)'
              }}
              value={selectedDept}
              onChange={e => { setSelectedDept(e.target.value); setPage(1) }}
              title="Filter by department"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => {
                const name = typeof dept === 'string' ? dept : dept.name
                return <option key={name} value={name}>{name}</option>
              })}
            </select>
          </div>
        )}
        
        {/* Status filter tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['active', 'inactive', 'all'].map(s => (
            <button key={s} type="button"
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setStatusFilter(s); setPage(1) }}
              style={{ textTransform: 'capitalize' }}>{s}</button>
          ))}
        </div>

        {/* View Mode Toggle: Grid vs Table list */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', padding: 3, borderRadius: 10, border: '1px solid var(--border)' }}>
          <button
            type="button"
            style={{ 
              height: 32, width: 32, padding: 0, border: 'none', borderRadius: 7,
              background: viewMode === 'grid' ? 'var(--primary)' : 'transparent',
              color: viewMode === 'grid' ? '#ffffff' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all 0.18s ease'
            }}
            onClick={() => setViewMode('grid')}
            title="Grid View"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            style={{ 
              height: 32, width: 32, padding: 0, border: 'none', borderRadius: 7,
              background: viewMode === 'table' ? 'var(--primary)' : 'transparent',
              color: viewMode === 'table' ? '#ffffff' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all 0.18s ease'
            }}
            onClick={() => setViewMode('table')}
            title="List View"
          >
            <List size={16} />
          </button>
        </div>

        <button className="btn btn-secondary" onClick={() => load()} aria-label="Refresh employees"><RefreshCw size={14} /></button>
        
        <button className="btn btn-primary" onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={15} /> Add Employee
        </button>
        
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', alignSelf: 'center', marginLeft: 'auto' }}>
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
          {/* List Table View */}
          {viewMode === 'table' ? (
            <div className="employee-table-card animate-fade-in">
              <DataTable
                columns={employeeColumns}
                rows={employees}
                loading={loading}
                empty="No employees found"
                className="employee-management-table"
                onRowClick={emp => setSelectedDetailsEmp(emp)}
              />
            </div>
          ) : (
            /* Premium Directory Card Grid View */
            <div className="emp-card-grid animate-fade-in">
              {employees.map((emp, idx) => {
                const colorIdx = (idx % 6) + 1
                return (
                  <div
                    key={emp.id}
                    className={`emp-card color-${colorIdx}`}
                    onClick={() => setSelectedDetailsEmp(emp)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view full employee details"
                  >
                    {/* Top color header banner with floating badges */}
                    <div className="emp-card-banner">
                      <span className={`emp-banner-badge status-${emp.status || 'active'}`}>
                        ● {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                      <span className="emp-banner-badge">
                        #{emp.employee_code || 'EMP'}
                      </span>
                    </div>

                    {/* Card Body */}
                    <div className="emp-card-body">
                      {/* Overlapping circle avatar with status dot */}
                      <div className="avatar-wrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedDetailsEmp(emp) }}
                          style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, cursor: 'pointer' }}
                          title="View employee profile"
                        >
                          <Avatar emp={emp} size={68} />
                        </button>
                        <span className={`avatar-status-dot ${emp.status === 'active' ? 'active' : 'inactive'}`} />
                      </div>

                      {/* Name & Designation */}
                      <div className="emp-card-name">{emp.name}</div>
                      <div className="emp-card-role">{emp.designation || 'Role Not Assigned'}</div>

                      {/* Department Tag */}
                      {!isViyana && (
                        <div className="emp-card-dept-tag">
                          <Briefcase size={11} />
                          <span>{emp.department || 'General Team'}</span>
                        </div>
                      )}

                      {/* Rich Contact & Workplace Details Box */}
                      <div className="emp-card-details-box" onClick={e => e.stopPropagation()}>
                        <div className="emp-card-detail-row">
                          <Mail size={13} style={{ color: '#2563eb' }} />
                          {emp.email ? (
                            <a href={`mailto:${emp.email}`} className="emp-card-detail-link" onClick={e => e.stopPropagation()} title={emp.email}>
                              {emp.email}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>No email registered</span>
                          )}
                        </div>

                        <div className="emp-card-detail-row">
                          <Phone size={13} style={{ color: '#10b981' }} />
                          {emp.phone ? (
                            <a href={`tel:${emp.phone}`} className="emp-card-detail-link" onClick={e => e.stopPropagation()} title={emp.phone}>
                              {emp.phone}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>No phone registered</span>
                          )}
                        </div>

                        <div className="emp-card-detail-split">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <MapPin size={11} style={{ color: '#06b6d4', flexShrink: 0 }} />
                            <span>{emp.branch || 'Headquarters'}</span>
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <Calendar size={11} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                            <span>{formatJoinedDate(emp.joining_date)}</span>
                          </span>
                        </div>
                      </div>

                      {/* Footer Details */}
                      <div className="emp-card-footer" onClick={e => e.stopPropagation()}>
                        <div className="emp-card-badge-group">
                          <span className="emp-type-pill">
                            {EMP_TYPE_LABELS[emp.employment_type] || emp.employment_type || 'Full Time'}
                          </span>
                          {emp.basic_salary && parseFloat(emp.basic_salary) > 0 ? (
                            <span className="emp-salary-pill" title="Basic Salary">
                              ₹{parseFloat(emp.basic_salary).toLocaleString()} <small style={{ fontWeight: 600, opacity: 0.8 }}>/mo</small>
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                              Standard Base
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            className="emp-profile-btn"
                            onClick={(e) => { e.stopPropagation(); setSelectedDetailsEmp(emp) }}
                            title="View full employee profile"
                          >
                            <Eye size={12} />
                            <span>Profile</span>
                          </button>
                          <EmployeeActionMenu employee={emp} onEdit={openEdit} onDelete={setDeleteTarget} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {pagination && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, padding: '12px 4px' }}>
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
      {showModal && typeof document !== 'undefined' && createPortal(
        <div onClick={() => !submitting && setShowModal(false)} style={{
          position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0,
          width: '100vw', height: '100vh',
          background: 'rgba(15,23,42,0.65)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'relative', width: '100%', maxWidth: '700px',
            background: 'var(--bg-card)', color: 'var(--text)', borderRadius: '18px',
            boxShadow: '0 25px 60px -15px rgba(15,23,42,0.35)',
            border: '1px solid var(--border)', display: 'flex',
            flexDirection: 'column', overflow: 'hidden',
            maxHeight: 'calc(100vh - 40px)',
          }}>
            <div className="modal-header">
              <h2>{editing ? 'Edit Employee' : 'Add Employee'}</h2>
              <button className="modal-close" onClick={() => !submitting && setShowModal(false)} aria-label="Close modal"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="form-label" htmlFor="emp-password" style={{ margin: 0 }}>
                      {editing ? 'Change Password' : 'Password *'}
                    </label>
                    {editing && (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Leave blank to retain current employee password, or enter a new password to reset it.
                      </span>
                    )}

                    <div style={{ position: 'relative' }}>
                      <input
                        type={showNewPwd ? 'text' : 'password'}
                        className="form-input"
                        id="emp-password"
                        value={form.password}
                        onChange={e => f('password', e.target.value)}
                        placeholder={editing ? 'New password (blank = keep existing)' : 'Set login password'}
                        required={!editing}
                        style={{ paddingRight: '40px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPwd(p => !p)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 4,
                        }}
                        title={showNewPwd ? 'Hide password' : 'Show password'}
                        aria-label={showNewPwd ? 'Hide password' : 'Show password'}
                      >
                        {showNewPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
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
                  {!isViyana && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="emp-department">Department</label>
                      <select className="form-select" id="emp-department" value={form.department} onChange={e => f('department', e.target.value)}>
                        <option value="">Select Department</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.name}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
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
                    <label className="form-label" htmlFor="emp-basic-salary">Basic Monthly Salary (₹)</label>
                    <input type="number" step="0.01" min="0" className="form-input" id="emp-basic-salary" value={form.basic_salary}
                      onChange={e => f('basic_salary', e.target.value)} placeholder="e.g. 50000" />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'block' }}>
                      Auto-used when generating monthly payroll payslips.
                    </span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="emp-profile-photo">Profile Photo</label>
                    <input type="file" id="emp-profile-photo" accept="image/*" onChange={handlePhoto} />
                    {photoPreview && (
                      <img src={photoPreview} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', marginTop: 8, border: '2px solid var(--border)' }} />
                    )}
                  </div>
                </div>
                <EmployeeExtraFields form={form} onChange={profileField} />
              </div>
              <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editing ? 'Update Employee' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Employee Photo Modal ── */}
      {photoModalEmp && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !photoModalSaving && setPhotoModalEmp(null)}>
          <div className="photo-upload-modal" onClick={e => e.stopPropagation()} style={{
            position: 'relative', width: '100%', maxWidth: '480px',
            background: 'var(--bg-card)', color: 'var(--text)', borderRadius: '18px',
            boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
            border: '1px solid var(--border)', display: 'flex',
            flexDirection: 'column', overflow: 'hidden',
          }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--primary-soft)', color: 'var(--primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Camera size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Employee Profile Photo</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    {photoModalEmp.name} {photoModalEmp.employee_code ? `(${photoModalEmp.employee_code})` : ''}
                  </p>
                </div>
              </div>
              <button className="modal-close" onClick={() => !photoModalSaving && setPhotoModalEmp(null)} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '22px 24px' }}>
              <div className="photo-modal-body-content">
                {/* Avatar Preview */}
                <div className="photo-modal-avatar-section">
                  <div className="photo-modal-avatar-frame">
                    {photoModalPreview ? (
                      <img src={photoModalPreview} alt={photoModalEmp.name} className="photo-modal-avatar-img" />
                    ) : (
                      <div className="photo-modal-avatar-fallback">
                        {photoModalEmp.name ? photoModalEmp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : <User size={48} />}
                      </div>
                    )}
                  </div>

                  {photoModalPreview && (
                    <button
                      type="button"
                      className="photo-remove-btn"
                      onClick={handleRemoveModalPhoto}
                      disabled={photoModalSaving}
                    >
                      <Trash2 size={13} /> Remove Photo
                    </button>
                  )}
                </div>

                {/* Upload Dropzone */}
                <input
                  type="file"
                  ref={photoFileInputRef}
                  accept="image/*"
                  onChange={handlePhotoModal}
                  style={{ display: 'none' }}
                />

                <div
                  className="photo-upload-dropzone"
                  onClick={() => photoFileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && photoFileInputRef.current?.click()}
                >
                  <div className="photo-upload-icon-circle">
                    <UploadCloud size={22} />
                  </div>
                  <div className="photo-upload-text">
                    <strong>Click to upload new photo</strong>
                    <span>Supports JPG, PNG, WEBP (Max 5MB)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => !photoModalSaving && setPhotoModalEmp(null)}
                disabled={photoModalSaving}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={savePhotoModal}
                disabled={photoModalSaving || (!photoModalFile && !photoModalRemove)}
                style={{ minWidth: 120 }}
              >
                {photoModalSaving ? (
                  <>
                    <Loader2 size={15} className="spin" /> Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Employee Full Profile Details Modal ── */}
      <EmployeeDetailsModal
        isOpen={!!selectedDetailsEmp}
        employee={selectedDetailsEmp}
        onClose={() => setSelectedDetailsEmp(null)}
        onEdit={(emp) => {
          setSelectedDetailsEmp(null)
          openEdit(emp)
        }}
        onUpdatePhoto={(emp) => {
          setSelectedDetailsEmp(null)
          openPhotoModal(emp)
        }}
      />

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
