import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import api from '../../services/api'
import {
  useGetPayrollQuery,
  useGetEmployeesQuery,
  useGeneratePayrollMutation,
  useBulkGeneratePayrollMutation,
  useUpdatePayrollRecordMutation,
  usePublishPayrollMutation,
  usePublishAllPayrollMutation,
  useDeletePayrollMutation,
} from '../../store/apiSlice'
import { useToast } from '../../App'
import {
  Plus,
  RefreshCw,
  FileDown,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit2,
  Send,
  Users,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react'

const MONTHS = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const PER_PAGE = 20

export default function HrPayroll() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Filters from URL or defaults
  const paramYear = searchParams.get('year')
  const paramMonth = searchParams.get('month')

  const [yearFilter, setYearFilter] = useState(paramYear || String(new Date().getFullYear()))
  const [monthFilter, setMonthFilter] = useState(paramMonth || '')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'draft', 'published'
  const [page, setPage] = useState(1)

  // Modals state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [editingPayroll, setEditingPayroll] = useState(null)
  const [opening, setOpening] = useState(null) // id of payslip being opened
  const [actionLoadingId, setActionLoadingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Single Generate Form
  const [form, setForm] = useState({
    employee_id: '',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    basic_salary: '',
    allowances: '0',
    deductions: '0',
    status: 'draft',
  })
  const [selectedEmp, setSelectedEmp] = useState(null)

  // Bulk Generate Form
  const defaultPrevDate = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d
  }, [])
  const [bulkMonth, setBulkMonth] = useState(paramMonth ? Number(paramMonth) : defaultPrevDate.getMonth() + 1)
  const [bulkYear, setBulkYear] = useState(paramYear ? Number(paramYear) : defaultPrevDate.getFullYear())

  // Edit Payroll Form
  const [editForm, setEditForm] = useState({
    id: '',
    basic_salary: '',
    allowances: '',
    deductions: '',
  })

  const { toast } = useToast()

  // Keep filters synced if URL params change
  useEffect(() => {
    if (paramYear && paramYear !== yearFilter) setYearFilter(paramYear)
    if (paramMonth && paramMonth !== monthFilter) setMonthFilter(paramMonth)
  }, [paramYear, paramMonth])

  // RTK Query Hooks
  const queryParams = {
    page,
    per_page: PER_PAGE,
    ...(yearFilter ? { year: yearFilter } : {}),
    ...(monthFilter ? { month: monthFilter } : {}),
    ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}),
  }

  const { data: payrollRes, isLoading: loading, refetch: load } = useGetPayrollQuery(queryParams)

  const { data: employeesRes } = useGetEmployeesQuery(
    { per_page: 500, status: 'active' },
    { skip: !showGenerateModal && !showBulkModal }
  )

  const [generatePayroll] = useGeneratePayrollMutation()
  const [bulkGeneratePayroll, { isLoading: bulkGenerating }] = useBulkGeneratePayrollMutation()
  const [updatePayrollRecord, { isLoading: updating }] = useUpdatePayrollRecordMutation()
  const [publishPayroll] = usePublishPayrollMutation()
  const [publishAllPayroll, { isLoading: publishingAll }] = usePublishAllPayrollMutation()
  const [deletePayroll] = useDeletePayrollMutation()

  const d = payrollRes?.data
  const payrolls = d?.payroll || d || []
  const pagination = d?.pagination || null
  const employees = employeesRes?.data?.employees || employeesRes?.data || []

  // Compute draft count in current view
  const draftCount = useMemo(() => {
    return payrolls.filter((p) => p.status === 'draft').length
  }, [payrolls])

  const changeYear = (y) => {
    setYearFilter(y)
    setPage(1)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (y) p.set('year', y)
      else p.delete('year')
      return p
    })
  }

  const changeMonth = (m) => {
    setMonthFilter(m)
    setPage(1)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (m) p.set('month', m)
      else p.delete('month')
      return p
    })
  }

  const changeStatus = (s) => {
    setStatusFilter(s)
    setPage(1)
  }

  // Open single generate modal
  const openSingleGenerate = () => {
    setForm({
      employee_id: '',
      month: monthFilter ? Number(monthFilter) : new Date().getMonth() + 1,
      year: yearFilter ? Number(yearFilter) : new Date().getFullYear(),
      basic_salary: '',
      allowances: '0',
      deductions: '0',
      status: 'draft',
    })
    setSelectedEmp(null)
    setShowGenerateModal(true)
  }

  const handleEmpChange = (id) => {
    const emp = employees.find((e) => String(e.id) === id)
    setSelectedEmp(emp || null)
    setForm((prev) => ({
      ...prev,
      employee_id: id,
      basic_salary: emp ? String(emp.basic_salary || '0') : '',
    }))
  }

  // Submit single payroll creation
  const handleSingleSubmit = async (e) => {
    e.preventDefault()
    if (!form.employee_id || !form.month || !form.year) {
      toast('Please fill all required fields.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const net =
        parseFloat(form.basic_salary || 0) +
        parseFloat(form.allowances || 0) -
        parseFloat(form.deductions || 0)

      await generatePayroll({
        employee_id: form.employee_id,
        month: parseInt(form.month),
        year: parseInt(form.year),
        basic_salary: parseFloat(form.basic_salary || 0),
        allowances: parseFloat(form.allowances || 0),
        deductions: parseFloat(form.deductions || 0),
        net_salary: net,
        status: form.status || 'draft',
      }).unwrap()

      toast(
        form.status === 'published' ? 'Payroll created and sent to employee.' : 'Draft payroll created.',
        'success'
      )
      setShowGenerateModal(false)
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to create payroll.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle bulk generate
  const handleBulkSubmit = async (e) => {
    e.preventDefault()
    try {
      const res = await bulkGeneratePayroll({
        month: parseInt(bulkMonth),
        year: parseInt(bulkYear),
      }).unwrap()

      const gen = res?.data?.generated_count ?? 0
      const skip = res?.data?.skipped_count ?? 0
      toast(`Generated ${gen} draft payslips (${skip} already existed).`, 'success')

      setShowBulkModal(false)
      setMonthFilter(String(bulkMonth))
      setYearFilter(String(bulkYear))
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to bulk-generate payroll.', 'error')
    }
  }

  // Open edit modal for an individual payroll record
  const openEdit = (payroll) => {
    setEditingPayroll(payroll)
    setEditForm({
      id: payroll.id,
      basic_salary: String(payroll.basic_salary || 0),
      allowances: String(payroll.allowances || 0),
      deductions: String(payroll.deductions || 0),
    })
  }

  // Save edited payroll record
  const handleSaveEdit = async (publish = false) => {
    if (!editingPayroll) return
    try {
      await updatePayrollRecord({
        id: editingPayroll.id,
        data: {
          basic_salary: parseFloat(editForm.basic_salary || 0),
          allowances: parseFloat(editForm.allowances || 0),
          deductions: parseFloat(editForm.deductions || 0),
          publish: publish ? 1 : 0,
        },
      }).unwrap()

      toast(
        publish
          ? `Payslip updated and sent to ${editingPayroll.employee_name}!`
          : `Payslip updated successfully.`,
        'success'
      )
      setEditingPayroll(null)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to update payslip.', 'error')
    }
  }

  // Publish single draft
  const handlePublishSingle = async (payroll) => {
    if (
      !window.confirm(
        `Send payslip for ${payroll.employee_name} (${MONTHS[payroll.month]} ${payroll.year})? The employee will receive an in-app notification and will be able to view and download it.`
      )
    ) {
      return
    }

    setActionLoadingId(payroll.id)
    try {
      await publishPayroll(payroll.id).unwrap()
      toast(`Payslip sent to ${payroll.employee_name}!`, 'success')
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to send payslip.', 'error')
    } finally {
      setActionLoadingId(null)
    }
  }

  // Publish all drafts for current month & year
  const handlePublishAll = async () => {
    const periodText = monthFilter ? `${MONTHS[monthFilter]} ${yearFilter}` : `${yearFilter}`
    if (
      !window.confirm(
        `Are you sure you want to send all draft payslips for ${periodText}? All respective employees will be notified and can access their payslips.`
      )
    ) {
      return
    }

    try {
      const res = await publishAllPayroll({
        ...(monthFilter ? { month: parseInt(monthFilter) } : {}),
        ...(yearFilter ? { year: parseInt(yearFilter) } : {}),
      }).unwrap()

      const count = res?.data?.published_count ?? 0
      toast(`Successfully published and sent ${count} payslips to employees!`, 'success')
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to send all payslips.', 'error')
    }
  }

  // Delete payroll record
  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this payroll record and its payslip?')) return
    try {
      await deletePayroll(id).unwrap()
      toast('Payroll deleted successfully.', 'success')
      if (payrolls.length === 1 && page > 1) setPage(page - 1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to delete.', 'error')
    }
  }

  // Fetch payslip HTML via cookie-authenticated axios, then open as Blob URL
  const downloadPayslip = async (id) => {
    setOpening(id)
    try {
      const res = await api.get(`/payslip.php?id=${id}`, {
        responseType: 'text',
        headers: { Accept: 'text/html' },
      })
      const blob = new Blob([res.data], { type: 'text/html; charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      if (!win) alert('Pop-up blocked — please allow pop-ups for this site.')
    } catch (err) {
      toast(err.response?.data?.message || 'Could not open payslip', 'error')
      console.error('Payslip open error:', err.response?.data || err)
    } finally {
      setOpening(null)
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <>
      {/* ── Top Search & Filters Toolbar ── */}
      <div className="search-bar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Bulk Auto-Generate Button */}
        <button
          className="btn btn-primary"
          onClick={() => setShowBulkModal(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            boxShadow: '0 4px 12px rgba(249, 115, 22, 0.25)',
          }}
        >
          <Users size={15} /> Auto-Generate For All
        </button>

        {/* Single Manual Generate Button */}
        <button className="btn btn-secondary" onClick={openSingleGenerate}>
          <Plus size={15} /> New Single
        </button>

        {/* Publish All Drafts Button (if drafts exist) */}
        {draftCount > 0 && (
          <button
            className="btn btn-secondary"
            onClick={handlePublishAll}
            disabled={publishingAll}
            style={{
              borderColor: '#10b981',
              color: '#059669',
              background: 'rgba(16, 185, 129, 0.1)',
              fontWeight: 700,
            }}
          >
            {publishingAll ? (
              <>
                <Loader2 size={14} className="spin" /> Sending…
              </>
            ) : (
              <>
                <Send size={14} /> Send All Drafts ({draftCount})
              </>
            )}
          </button>
        )}

        <button className="btn btn-secondary" onClick={() => load()} aria-label="Refresh payroll">
          <RefreshCw size={14} /> Refresh
        </button>

        {/* Month Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Month:</span>
          <select
            className="form-select"
            value={monthFilter}
            onChange={(e) => changeMonth(e.target.value)}
            aria-label="Filter by month"
            style={{ maxWidth: 130 }}
          >
            <option value="">All Months</option>
            {MONTHS.slice(1).map((m, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Year Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Year:</span>
          <select
            className="form-select"
            value={yearFilter}
            onChange={(e) => changeYear(e.target.value)}
            aria-label="Filter by year"
            style={{ maxWidth: 105 }}
          >
            <option value="">All Years</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status:</span>
          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => changeStatus(e.target.value)}
            aria-label="Filter by status"
            style={{ maxWidth: 130 }}
          >
            <option value="all">All Status</option>
            <option value="draft">🟡 Drafts Only</option>
            <option value="published">🟢 Sent / Published</option>
          </select>
        </div>

        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} records` : `${payrolls.length} records`}
        </span>
      </div>

      {/* ── Table Card ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && payrolls.length === 0 ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : payrolls.length === 0 ? (
          <div className="table-empty">
            <div className="empty-icon">-</div>
            <p style={{ fontWeight: 600 }}>No payroll records found.</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              Click "Auto-Generate For All" to generate monthly payslips for all active employees.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Period</th>
                  <th>Basic Salary</th>
                  <th>Allowances</th>
                  <th>Deductions</th>
                  <th>Net Salary</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payrolls.map((p) => {
                  const isDraft = p.status === 'draft'
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.employee_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {p.employee_code} {p.department ? `· ${p.department}` : ''}
                        </div>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {MONTHS[p.month]} {p.year}
                      </td>
                      <td>₹{parseFloat(p.basic_salary).toLocaleString()}</td>
                      <td>₹{parseFloat(p.allowances).toLocaleString()}</td>
                      <td>₹{parseFloat(p.deductions).toLocaleString()}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        ₹{parseFloat(p.net_salary).toLocaleString()}
                      </td>
                      <td>
                        {isDraft ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: '#d97706',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                            }}
                            title="Draft payslip — hidden from employee until sent"
                          >
                            <Clock size={11} /> Draft
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#059669',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                            }}
                          >
                            <CheckCircle2 size={11} /> Sent
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          {/* Edit button */}
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => openEdit(p)}
                            title="Edit payslip figures before sending"
                            style={{ padding: '6px 9px' }}
                          >
                            <Edit2 size={13} />
                          </button>

                          {/* Send button for draft */}
                          {isDraft && (
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => handlePublishSingle(p)}
                              disabled={actionLoadingId === p.id}
                              title="Send payslip to employee"
                              style={{
                                color: '#059669',
                                borderColor: 'rgba(16, 185, 129, 0.3)',
                                background: 'rgba(16, 185, 129, 0.1)',
                                padding: '6px 9px',
                              }}
                            >
                              {actionLoadingId === p.id ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <Send size={13} />
                              )}
                            </button>
                          )}

                          {/* View / Download PDF */}
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => downloadPayslip(p.id)}
                            disabled={opening === p.id}
                            title="Preview / Print PDF"
                            style={{ padding: '6px 9px' }}
                          >
                            {opening === p.id ? '...' : <FileDown size={13} />}
                          </button>

                          {/* Delete */}
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{
                              color: '#ef4444',
                              borderColor: 'transparent',
                              background: 'rgba(239, 68, 68, 0.1)',
                              padding: '6px 9px',
                            }}
                            onClick={() => handleDelete(p.id)}
                            title="Delete payroll record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 20px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} records
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    aria-label="First page"
                  >
                    «
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 13, padding: '0 8px' }}>{page}</span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                    aria-label="Last page"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Auto-Generate For All Modal ── */}
      {showBulkModal &&
        createPortal(
          <div
            onClick={() => !bulkGenerating && setShowBulkModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15,23,42,0.65)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '480px',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                borderRadius: '18px',
                boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(249, 115, 22, 0.15)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Users size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Auto-Generate Monthly Payroll</h2>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                      Generates draft payslips for all active employees
                    </p>
                  </div>
                </div>
                <button
                  className="modal-close"
                  onClick={() => !bulkGenerating && setShowBulkModal(false)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleBulkSubmit}>
                <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div
                    style={{
                      background: 'var(--surface-2)',
                      padding: '12px 16px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'var(--text)',
                    }}
                  >
                    This will automatically create <strong>Draft payslips</strong> for all active employees using their basic salary. You can review and adjust any employee’s allowances or deductions before sending them out!
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="bulk-month-select">
                        Target Month *
                      </label>
                      <select
                        className="form-select"
                        id="bulk-month-select"
                        value={bulkMonth}
                        onChange={(e) => setBulkMonth(Number(e.target.value))}
                        required
                      >
                        {MONTHS.slice(1).map((n, i) => (
                          <option key={i + 1} value={i + 1}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="bulk-year-input">
                        Target Year *
                      </label>
                      <input
                        type="number"
                        min="2020"
                        max="2100"
                        className="form-input"
                        id="bulk-year-input"
                        value={bulkYear}
                        onChange={(e) => setBulkYear(Number(e.target.value))}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div
                  className="modal-footer"
                  style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowBulkModal(false)}
                    disabled={bulkGenerating}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={bulkGenerating}>
                    {bulkGenerating ? (
                      <>
                        <Loader2 size={15} className="spin" /> Generating…
                      </>
                    ) : (
                      'OK, Generate For Everyone'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ── Edit Payslip Modal ── */}
      {editingPayroll &&
        createPortal(
          <div
            onClick={() => !updating && setEditingPayroll(null)}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15,23,42,0.65)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '520px',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                borderRadius: '18px',
                boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div className="modal-header">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                    Edit Payslip — {editingPayroll.employee_name}
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    Period: {MONTHS[editingPayroll.month]} {editingPayroll.year} ({editingPayroll.employee_code})
                  </p>
                </div>
                <button
                  className="modal-close"
                  onClick={() => !updating && setEditingPayroll(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-basic-salary">
                    Basic Salary (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    id="edit-basic-salary"
                    value={editForm.basic_salary}
                    onChange={(e) => setEditForm({ ...editForm, basic_salary: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-allowances">
                      Allowances / Bonus (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      id="edit-allowances"
                      value={editForm.allowances}
                      onChange={(e) => setEditForm({ ...editForm, allowances: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-deductions">
                      Deductions (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      id="edit-deductions"
                      value={editForm.deductions}
                      onChange={(e) => setEditForm({ ...editForm, deductions: e.target.value })}
                    />
                  </div>
                </div>

                {/* Net Salary Preview */}
                <div
                  style={{
                    background: 'var(--surface-2)',
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Calculated Net Salary:
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>
                    ₹
                    {(
                      parseFloat(editForm.basic_salary || 0) +
                      parseFloat(editForm.allowances || 0) -
                      parseFloat(editForm.deductions || 0)
                    ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div
                className="modal-footer"
                style={{
                  padding: '16px 24px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingPayroll(null)}
                  disabled={updating}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleSaveEdit(false)}
                  disabled={updating}
                  style={{ fontWeight: 600 }}
                >
                  {updating ? 'Saving…' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleSaveEdit(true)}
                  disabled={updating}
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    borderColor: 'transparent',
                    fontWeight: 700,
                  }}
                >
                  {updating ? (
                    <>
                      <Loader2 size={14} className="spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Send size={14} /> Save & Send
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ── Single Generate Modal ── */}
      {showGenerateModal &&
        createPortal(
          <div
            onClick={() => !submitting && setShowGenerateModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15,23,42,0.65)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
              padding: '20px',
              boxSizing: 'border-box',
              overflowY: 'auto',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '560px',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                borderRadius: '18px',
                boxShadow: '0 25px 60px -15px rgba(15,23,42,0.4)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                maxHeight: 'calc(100vh - 40px)',
              }}
            >
              <div className="modal-header">
                <h2>Create Single Payroll</h2>
                <button
                  className="modal-close"
                  onClick={() => !submitting && setShowGenerateModal(false)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>
              <form
                onSubmit={handleSingleSubmit}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
              >
                <div
                  className="modal-body"
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '20px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-employee-select">
                      Employee *
                    </label>
                    <select
                      className="form-select"
                      id="payroll-employee-select"
                      value={form.employee_id}
                      onChange={(e) => handleEmpChange(e.target.value)}
                      required
                    >
                      <option value="">Select employee...</option>
                      {employees
                        .filter((e) => e.status === 'active')
                        .map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} ({emp.employee_code})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-month-select">
                        Month *
                      </label>
                      <select
                        className="form-select"
                        id="payroll-month-select"
                        value={form.month}
                        onChange={(e) => setForm({ ...form, month: e.target.value })}
                        required
                      >
                        {MONTHS.slice(1).map((n, i) => (
                          <option key={i + 1} value={i + 1}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-year-input">
                        Year *
                      </label>
                      <input
                        type="number"
                        min="2020"
                        className="form-input"
                        id="payroll-year-input"
                        value={form.year}
                        onChange={(e) => setForm({ ...form, year: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-basic">
                        Basic Salary (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        id="payroll-basic"
                        value={form.basic_salary}
                        onChange={(e) => setForm({ ...form, basic_salary: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-allowances">
                        Allowances (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input"
                        id="payroll-allowances"
                        value={form.allowances}
                        onChange={(e) => setForm({ ...form, allowances: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-deductions">
                        Deductions (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input"
                        id="payroll-deductions"
                        value={form.deductions}
                        onChange={(e) => setForm({ ...form, deductions: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="payroll-net-salary">
                        Net Salary
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        id="payroll-net-salary"
                        readOnly
                        value={
                          selectedEmp
                            ? '₹' +
                              (
                                parseFloat(form.basic_salary || 0) +
                                parseFloat(form.allowances || 0) -
                                parseFloat(form.deductions || 0)
                              ).toLocaleString()
                            : '-'
                        }
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-status-select">
                      Initial Status
                    </label>
                    <select
                      className="form-select"
                      id="payroll-status-select"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    >
                      <option value="draft">Save as Draft (Review & edit later)</option>
                      <option value="published">Publish Immediately (Notify employee)</option>
                    </select>
                  </div>
                </div>
                <div
                  className="modal-footer"
                  style={{
                    flexShrink: 0,
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowGenerateModal(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Generating...' : 'Generate Payroll'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
