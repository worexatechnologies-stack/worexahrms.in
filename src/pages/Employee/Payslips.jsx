import { useState } from 'react'
import api from '../../services/api'
import { useGetPayrollQuery } from '../../store/apiSlice'
import { RefreshCw, FileDown, Receipt, ChevronLeft, ChevronRight, Loader } from 'lucide-react'

const MONTHS = ['','January','February','March','April','May','June',
                'July','August','September','October','November','December']
const PER_PAGE = 15

export default function EmpPayslips() {
  const [opening,    setOpening]    = useState(null)  // id of payslip being opened
  const [page,       setPage]       = useState(1)

  // ----- RTK Query Hook -----
  const { data: payrollRes, isLoading: loading, error: queryError, refetch: load } = useGetPayrollQuery({
    page,
    per_page: PER_PAGE
  })

  const d = payrollRes?.data
  const payrolls = d?.payroll || d || []
  const pagination = d?.pagination || null
  const error = queryError ? (queryError.data?.message || queryError.message || 'Failed to load payslips') : null

  // Fetch payslip HTML via cookie-authenticated axios, then open as Blob URL
  const openPayslip = async (id) => {
    setOpening(id)
    try {
      const res = await api.get(`/payslip.php?id=${id}`, {
        responseType: 'text',
        headers: { Accept: 'text/html' },
      })
      const html = res.data
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url, '_blank')
      // Revoke the blob URL after 60s to free memory
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      if (!win) alert('Pop-up blocked — please allow pop-ups for this site.')
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Could not open payslip'
      alert('Error: ' + msg)
      console.error('Payslip open error:', err.response?.data || err)
    } finally {
      setOpening(null)
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <div className="search-bar">
        <button className="btn btn-secondary" onClick={() => load()}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} payslip${pagination.total !== 1 ? 's' : ''}` : `${payrolls.length} payslip${payrolls.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : error ? (
          <div className="table-empty" style={{ color: 'var(--danger, #ef4444)' }}>
            <Receipt size={36} style={{ opacity: .3, marginBottom: 10 }} />
            <p style={{ fontWeight: 600 }}>Could not load payslips</p>
            <p style={{ fontSize: 13, marginTop: 6, opacity: 0.7 }}>{error}</p>
            <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => load()}>Retry</button>
          </div>
        ) : payrolls.length === 0 ? (
          <div className="table-empty">
            <Receipt size={36} style={{ opacity: .3, marginBottom: 10 }} />
            <p>No payslips yet. Contact HR to generate your payslip.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Basic Salary</th>
                  <th>Allowances</th>
                  <th>Deductions</th>
                  <th>Net Salary</th>
                  <th>Payslip</th>
                </tr>
              </thead>
              <tbody>
                {payrolls.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{MONTHS[p.month]} {p.year}</td>
                    <td>₹{parseFloat(p.basic_salary).toLocaleString()}</td>
                    <td>₹{parseFloat(p.allowances).toLocaleString()}</td>
                    <td>₹{parseFloat(p.deductions).toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>₹{parseFloat(p.net_salary).toLocaleString()}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => openPayslip(p.id)}
                        disabled={opening === p.id}
                        title="View & Print Payslip"
                      >
                        {opening === p.id
                          ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Opening…</>
                          : <><FileDown size={13} /> PDF</>
                        }
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
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} payslips
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
    </>
  )
}
