import { useState } from 'react'
import { useGetLeavesQuery, useDecideLeaveMutation } from '../../store/apiSlice'
import { useToast } from '../../App'
import { RefreshCw, CheckCircle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react'

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

  return (
    <>
      <div className="search-bar" style={{ gap: 12 }}>
        <button className="btn btn-secondary" onClick={() => load()}>
          <RefreshCw size={14}/> Refresh
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeFilter(s)}
              style={{ textTransform: 'capitalize' }}
            >
              {s}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} requests` : `${leaves.length} requests`}
        </span>
        <span className="status-badge status-pending" style={{ marginLeft: 8 }}>
          {pendingCount} pending
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && leaves.length === 0 ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : leaves.length === 0 ? (
          <div className="table-empty"><div className="empty-icon">-</div><p>No leave requests found.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Employee</th><th>Branch</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{l.employee_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.employee_code}</div>
                    </td>
                    <td>{l.branch || '-'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{l.leave_type}</td>
                    <td>{l.start_date}</td>
                    <td>{l.end_date}</td>
                    <td>{days(l.start_date, l.end_date)}</td>
                    <td
                      title="Click to view full leave details"
                      onClick={() => setSelectedLeave(l)}
                      style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--primary)' }}
                    >
                      {l.reason}
                    </td>
                    <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-sm btn-success" disabled={l.status === 'approved'} onClick={() => updateStatus(l.id, 'approved')}>
                          <CheckCircle size={13}/> Approve
                        </button>
                        <button className="btn btn-sm btn-danger" disabled={l.status === 'rejected'} onClick={() => updateStatus(l.id, 'rejected')}>
                          <XCircle size={13}/> Reject
                        </button>
                      </div>
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

      {/* Detail modal */}
      {selectedLeave && (
        <div className="modal-overlay" onClick={() => setSelectedLeave(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Leave Details</h2>
              <button className="modal-close" onClick={() => setSelectedLeave(null)} aria-label="Close details">×</button>
            </div>
            <div className="detail-grid">
              <div><strong>Employee</strong><span>{selectedLeave.employee_name} ({selectedLeave.employee_code})</span></div>
              <div><strong>Branch</strong><span>{selectedLeave.branch || '-'}</span></div>
              <div><strong>Type</strong><span style={{ textTransform: 'capitalize' }}>{selectedLeave.leave_type}</span></div>
              <div><strong>Dates</strong><span>{selectedLeave.start_date} to {selectedLeave.end_date}</span></div>
              <div><strong>Status</strong><span className={`status-badge status-${selectedLeave.status}`}>{selectedLeave.status}</span></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Reason</div>
              <div className="leave-reason-full">{selectedLeave.reason}</div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedLeave(null)}>Close</button>
              <button className="btn btn-success" disabled={selectedLeave.status === 'approved'} onClick={() => { updateStatus(selectedLeave.id, 'approved'); setSelectedLeave(null) }}>Approve</button>
              <button className="btn btn-danger" disabled={selectedLeave.status === 'rejected'} onClick={() => { updateStatus(selectedLeave.id, 'rejected'); setSelectedLeave(null) }}>Reject</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
