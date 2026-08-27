import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Eye, X, Calendar, FileText, Tag, CheckCircle, ChevronLeft, ChevronRight, RefreshCw, Plus } from 'lucide-react'
import { useGetLeavesQuery, useCreateLeaveMutation } from '../../store/apiSlice'
import { useToast } from '../../App'

const PER_PAGE = 15

const daysDiff = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1)

export default function EmpLeaves() {
  const [showForm,    setShowForm]    = useState(false)
  const [viewLeave,   setViewLeave]   = useState(null)
  const [form,        setForm]        = useState({ leave_type: 'casual', start_date: '', end_date: '', reason: '' })
  const [page,        setPage]        = useState(1)
  const { toast } = useToast()

  useEffect(() => {
    if (showForm || viewLeave) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showForm, viewLeave])

  // ----- RTK Query Hooks -----
  const { data: leavesRes, isLoading: loading, refetch: load } = useGetLeavesQuery({
    page,
    per_page: PER_PAGE
  })
  const [createLeave, { isLoading: submitting }] = useCreateLeaveMutation()

  const d = leavesRes?.data
  const leaves = d?.leaves || d || []
  const pagination = d?.pagination || null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.start_date || !form.end_date || !form.reason) { toast('Fill all fields.', 'error'); return }
    try {
      const res = await createLeave(form).unwrap()
      toast(res.message || 'Leave request submitted.', 'success')
      setShowForm(false)
      setForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' })
      setPage(1)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed to submit.', 'error')
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <div className="search-bar">
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Apply for Leave</button>
        <button className="btn btn-secondary" onClick={() => load()}><RefreshCw size={14} /> Refresh</button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} requests` : `${leaves.length} requests`}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : leaves.length === 0 ? (
          <div className="table-empty"><div className="empty-icon">-</div><p>No leave requests.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.id}>
                    <td style={{ textTransform: 'capitalize' }}>{l.leave_type}</td>
                    <td>{l.start_date}</td>
                    <td>{l.end_date}</td>
                    <td>{daysDiff(l.start_date, l.end_date)}</td>
                    <td><span className="leave-reason-preview">{l.reason}</span></td>
                    <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                    <td>
                      <button className="btn btn-icon btn-secondary leave-view-btn" title="View full details" aria-label="View full details" onClick={() => setViewLeave(l)}>
                        <Eye size={14} />
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
                  Page {page} of {totalPages} &nbsp;·&nbsp; {pagination.total} requests
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

      {/* Leave detail modal */}
      {viewLeave && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setViewLeave(null)}>
          <div className="modal leave-detail-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FileText size={18} style={{ color:'var(--primary)' }} /> Leave Request Details
              </h2>
              <button className="modal-close" onClick={() => setViewLeave(null)} aria-label="Close details"><X size={18} /></button>
            </div>
            <div className="leave-detail-body" style={{ padding: '0 24px 20px' }}>
              <div className="leave-detail-grid">
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><Tag size={13} /> Type</span>
                  <span className="leave-detail-value" style={{ textTransform:'capitalize' }}>{viewLeave.leave_type}</span>
                </div>
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><Calendar size={13} /> Duration</span>
                  <span className="leave-detail-value">
                    {viewLeave.start_date} → {viewLeave.end_date}
                    <em style={{ marginLeft:6, color:'var(--text-secondary)', fontSize:12 }}>
                      ({daysDiff(viewLeave.start_date, viewLeave.end_date)} day{daysDiff(viewLeave.start_date, viewLeave.end_date) !== 1 ? 's' : ''})
                    </em>
                  </span>
                </div>
                <div className="leave-detail-item">
                  <span className="leave-detail-label"><CheckCircle size={13} /> Status</span>
                  <span className={`status-badge status-${viewLeave.status}`}>{viewLeave.status}</span>
                </div>
              </div>
              <div className="leave-detail-reason" style={{ marginTop: 14 }}>
                <span className="leave-detail-label" style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}><FileText size={13} /> Reason</span>
                <p className="leave-detail-reason-text" style={{ marginTop: 6 }}>{viewLeave.reason}</p>
              </div>
              <div className="modal-footer" style={{ margin: '20px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setViewLeave(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Apply form modal */}
      {showForm && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !submitting && setShowForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"520px",background:"#ffffff",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(15,23,42,0.35)",border:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2>Apply for Leave</h2>
              <button className="modal-close" onClick={() => !submitting && setShowForm(false)} aria-label="Close form"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '0 24px 20px' }}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="leave-type">Leave Type</label>
                <select className="form-select" id="leave-type" value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })}>
                  <option value="casual">Casual</option>
                  <option value="sick">Sick</option>
                  <option value="earned">Earned</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="start-date">Start Date</label>
                  <input type="date" className="form-input" id="start-date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="end-date">End Date</label>
                  <input type="date" className="form-input" id="end-date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} required />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="leave-reason">Reason</label>
                <textarea
                  className="form-textarea"
                  id="leave-reason"
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  required
                />
              </div>
              <div className="modal-footer" style={{ margin: '18px -24px -20px', padding: '14px 24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
