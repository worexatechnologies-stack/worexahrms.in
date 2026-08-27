import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useGetLeavesQuery, useDecideLeaveMutation } from '../../store/apiSlice'
import { useToast } from '../../App'
import { RefreshCw, CheckCircle, XCircle, ChevronLeft, ChevronRight, X } from 'lucide-react'

const PER_PAGE = 20

const days = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1)

export default function HrLeaves() {
  const [selectedLeave, setSelectedLeave] = useState(null)
  const [statusFilter,  setStatusFilter]  = useState('pending')
  const [page,          setPage]          = useState(1)
  const { toast } = useToast()

  // ----- RTK Query Hooks -----
  const { data: leavesRes, isFetching: loading, refetch: load } = useGetLeavesQuery({
    page,
    per_page: PER_PAGE,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {})
  })

  const { data: pendingRes } = useGetLeavesQuery({
    page: 1,
    per_page: 1,
    status: 'pending'
  })

  const [decideLeave] = useDecideLeaveMutation()

  const d = leavesRes?.data
  const leaves = d?.leaves || d || []
  const pagination = d?.pagination || null
  const pendingCount = pendingRes?.data?.pagination?.total ?? 0

  const changeFilter = (s) => {
    setStatusFilter(s)
    setPage(1)
  }

  const updateStatus = async (id, status) => {
    try {
      await decideLeave({ id, status }).unwrap()
      toast('Leave ' + status + '.', 'success')
    } catch { toast('Failed to update.', 'error') }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  useEffect(() => {
    if (selectedLeave) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selectedLeave])

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Leave Management</h1>
          <p>Review and manage employee leave requests.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => load()}><RefreshCw size={15}/> Refresh</button>
      </div>

      {/* Filter tabs */}
      <div className="filter-bar" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            style={{ textTransform: 'capitalize' }}
          >
            {s}
            {s === 'pending' && pendingCount > 0 && (
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: '50%', padding: '1px 6px', fontSize: 11 }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner" />Loading leave requests...</div>
        ) : leaves.length === 0 ? (
          <div className="empty-state">No {statusFilter !== 'all' ? statusFilter : ''} leave requests found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Branch</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedLeave(l)}>
                    <td><code>{l.employee_code}</code></td>
                    <td><b>{l.employee_name}</b></td>
                    <td>{l.branch || '-'}</td>
                    <td><span style={{ textTransform: 'capitalize' }}>{l.leave_type}</span></td>
                    <td>{l.start_date}</td>
                    <td>{l.end_date}</td>
                    <td>{days(l.start_date, l.end_date)}</td>
                    <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      {l.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-success btn-icon"
                            onClick={() => updateStatus(l.id, 'approved')}
                            title="Approve"
                          >
                            <CheckCircle size={14} />
                          </button>
                          <button
                            className="btn btn-sm btn-danger btn-icon"
                            onClick={() => updateStatus(l.id, 'rejected')}
                            title="Reject"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Page {page} of {totalPages} ({totalRecords} records)
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(1)} disabled={page <= 1} aria-label="First page">«</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => p - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={14}/></button>
                  <span style={{ padding: '4px 10px', fontSize: 13, display: 'flex', alignItems: 'center' }}>{page}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={14}/></button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedLeave && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setSelectedLeave(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"520px",background:"#ffffff",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(15,23,42,0.35)",border:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2>Leave Details</h2>
              <button className="modal-close" onClick={() => setSelectedLeave(null)} aria-label="Close details"><X size={18} /></button>
            </div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="detail-grid">
                <div><strong>Employee</strong><span>{selectedLeave.employee_name} ({selectedLeave.employee_code})</span></div>
                <div><strong>Branch</strong><span>{selectedLeave.branch || '-'}</span></div>
                <div><strong>Type</strong><span style={{ textTransform: 'capitalize' }}>{selectedLeave.leave_type}</span></div>
                <div><strong>Dates</strong><span>{selectedLeave.start_date} to {selectedLeave.end_date}</span></div>
                <div><strong>Status</strong><span className={`status-badge status-${selectedLeave.status}`}>{selectedLeave.status}</span></div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: 'var(--text)' }}>Reason</div>
                <div className="leave-reason-full">{selectedLeave.reason}</div>
              </div>
              <div className="modal-footer" style={{ margin: '20px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedLeave(null)}>Close</button>
                <button className="btn btn-success" disabled={selectedLeave.status === 'approved'} onClick={() => { updateStatus(selectedLeave.id, 'approved'); setSelectedLeave(null) }}>Approve</button>
                <button className="btn btn-danger" disabled={selectedLeave.status === 'rejected'} onClick={() => { updateStatus(selectedLeave.id, 'rejected'); setSelectedLeave(null) }}>Reject</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
