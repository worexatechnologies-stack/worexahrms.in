import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api'
import { useGetPayrollQuery, useGetEmployeesQuery, useGeneratePayrollMutation, useDeletePayrollMutation } from '../../store/apiSlice'
import { useToast } from '../../App'
import { Plus, RefreshCw, FileDown, X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'

const MONTHS = ['','January','February','March','April','May','June',
                'July','August','September','October','November','December']
const PER_PAGE = 20

export default function HrPayroll() {
  const [showModal,  setShowModal]  = useState(false)
  const [opening,    setOpening]    = useState(null)  // id of payslip being opened
  const [form,       setForm]       = useState({ employee_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), basic_salary: '', allowances: '0', deductions: '0' })
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [submitting, setSubmitting]  = useState(false)

  // filters & pagination
  const [yearFilter, setYearFilter] = useState('')
  const [page,       setPage]       = useState(1)

  const { toast } = useToast()

  // ----- RTK Query Hooks -----
  const { data: payrollRes, isLoading: loading, refetch: load } = useGetPayrollQuery({
    page,
    per_page: PER_PAGE,
    ...(yearFilter ? { year: yearFilter } : {})
  })

  const { data: employeesRes, refetch: refetchEmployees } = useGetEmployeesQuery(
    { per_page: 500, status: 'active' },
    { skip: !showModal } // Only query employees list when modal is open
  )

  const [generatePayroll] = useGeneratePayrollMutation()
  const [deletePayroll] = useDeletePayrollMutation()

  const d = payrollRes?.data
  const payrolls = d?.payroll || d || []
  const pagination = d?.pagination || null

  const employees = employeesRes?.data?.employees || employeesRes?.data || []

  const changeYear = (y) => {
    setYearFilter(y)
    setPage(1)
  }

  const openGenerate = () => {
    setForm({ employee_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), basic_salary: '', allowances: '0', deductions: '0' })
    setSelectedEmp(null)
    setShowModal(true)
  }

  const handleEmpChange = (id) => {
    const emp = employees.find(e => String(e.id) === id)
    setSelectedEmp(emp || null)
    setForm(prev => ({ ...prev, employee_id: id, basic_salary: emp ? String(emp.basic_salary) : '' }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.employee_id || !form.month || !form.year) { toast('Fill required fields.', 'error'); return }
    setSubmitting(true)
    try {
      const net = parseFloat(form.basic_salary || 0) + parseFloat(form.allowances || 0) - parseFloat(form.deductions || 0)
      await generatePayroll({
        employee_id: form.employee_id,
        month: parseInt(form.month),
        year: parseInt(form.year),
        basic_salary: parseFloat(form.basic_salary || 0),
        allowances: parseFloat(form.allowances || 0),
        deductions: parseFloat(form.deductions || 0),
        net_salary: net,
      }).unwrap()
      toast('Payroll created.', 'success')
      setShowModal(false)
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

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
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url, '_blank')
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
      <div className="search-bar">
        <button className="btn btn-primary" onClick={openGenerate}><Plus size={15}/> Generate Payroll</button>
        <button className="btn btn-secondary" onClick={() => load()}><RefreshCw size={14}/> Refresh</button>

        {/* Year filter */}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Year:</span>
        <select
          className="form-select"
          value={yearFilter}
          onChange={e => changeYear(e.target.value)}
          aria-label="Filter by year"
          style={{ maxWidth: 110 }}
        >
          <option value="">All Years</option>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} records` : `${payrolls.length} records`}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && payrolls.length === 0 ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : payrolls.length === 0 ? (
          <div className="table-empty"><div className="empty-icon">-</div><p>No payroll records.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Employee</th><th>Period</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Net Salary</th><th style={{textAlign: 'right'}}>Actions</th></tr>
              </thead>
              <tbody>
                {payrolls.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.employee_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.employee_code}</div>
                    </td>
                    <td>{MONTHS[p.month]} {p.year}</td>
                    <td>₹{parseFloat(p.basic_salary).toLocaleString()}</td>
                    <td>₹{parseFloat(p.allowances).toLocaleString()}</td>
                    <td>₹{parseFloat(p.deductions).toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>₹{parseFloat(p.net_salary).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => downloadPayslip(p.id)} disabled={opening === p.id} aria-label="Download PDF">
                        {opening === p.id ? '...' : <FileDown size={14}/>}
                      </button>
                      <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444', borderColor: 'transparent', background: 'rgba(239, 68, 68, 0.1)' }} onClick={() => handleDelete(p.id)} aria-label="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--bg-card)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} records
                </span>
                <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">«</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 13, padding: '0 8px' }}>{page}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
                    <ChevronRight size={14} />
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Generate modal */}
      {showModal && createPortal(
        <div onClick={() => !submitting && setShowModal(false)} style={{ position:'fixed',inset:0,top:0,left:0,right:0,bottom:0,width:'100vw',height:'100vh',background:'rgba(15,23,42,0.65)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999999,padding:'20px',boxSizing:'border-box',overflowY:'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'560px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.4)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',maxHeight:'calc(100vh - 40px)' }}>
            <div className="modal-header">
              <h2>Generate Payroll</h2>
              <button className="modal-close" onClick={() => !submitting && setShowModal(false)} aria-label="Close modal"><X size={18}/></button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="payroll-employee-select">Employee *</label>
                  <select className="form-select" id="payroll-employee-select" value={form.employee_id} onChange={e => handleEmpChange(e.target.value)} required>
                    <option value="">Select employee...</option>
                    {employees.filter(e => e.status === 'active').map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-month-select">Month *</label>
                    <select className="form-select" id="payroll-month-select" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} required>
                      {MONTHS.slice(1).map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-year-input">Year *</label>
                    <input type="number" min="2020" className="form-input" id="payroll-year-input" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} required />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-basic">Basic Salary</label>
                    <input type="number" step="0.01" className="form-input" id="payroll-basic" value={form.basic_salary} onChange={e => setForm({ ...form, basic_salary: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-allowances">Allowances</label>
                    <input type="number" step="0.01" min="0" className="form-input" id="payroll-allowances" value={form.allowances} onChange={e => setForm({ ...form, allowances: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-deductions">Deductions</label>
                    <input type="number" step="0.01" min="0" className="form-input" id="payroll-deductions" value={form.deductions} onChange={e => setForm({ ...form, deductions: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="payroll-net-salary">Net Salary</label>
                    <input type="text" className="form-input" id="payroll-net-salary" readOnly
                      value={selectedEmp ? '₹' + (parseFloat(form.basic_salary || 0) + parseFloat(form.allowances || 0) - parseFloat(form.deductions || 0)).toLocaleString() : '-'} />
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Generating...' : 'Generate'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
