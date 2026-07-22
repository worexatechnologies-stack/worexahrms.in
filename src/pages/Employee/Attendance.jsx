import { useState } from 'react'
import { useGetAttendanceQuery } from '../../store/apiSlice'
import { ChevronLeft, ChevronRight, RefreshCw, Home } from 'lucide-react'
import { displayWorkedHours } from '../../utils/attendanceHelpers'

const PER_PAGE = 15

export default function EmpAttendance() {
  const [page, setPage] = useState(1)

  // ----- RTK Query Hook -----
  const { data: attendanceRes, isLoading: loading, refetch: load } = useGetAttendanceQuery({
    page,
    per_page: PER_PAGE
  })

  const d = attendanceRes?.data
  const records = d?.records || d || []
  const pagination = d?.pagination || null
  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <div className="search-bar">
        <button className="btn btn-secondary" onClick={() => load()}><RefreshCw size={14} /> Refresh</button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {pagination ? `${pagination.total} records` : `${records.length} records`}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : records.length === 0 ? (
          <div className="table-empty"><div className="empty-icon">-</div><p>No attendance records.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Working Hours</th><th>Task Update</th><th>Status</th><th>Mode</th></tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.check_in?.slice(0, 5) || '-'}</td>
                    <td>{r.check_out?.slice(0, 5) || '-'}</td>
                    <td>{displayWorkedHours(r)}</td>
                    <td style={{ maxWidth: 280 }}>
                      {r.daily_task_update
                        ? <div className="task-update-cell" title={r.daily_task_update}>{r.daily_task_update}</div>
                        : '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        <span className={`status-badge status-${r.status === 'late' ? 'present' : r.status}`}>
                          {(r.status === 'late' ? 'present' : r.status).replace('_', ' ')}
                        </span>
                        {(r.status === 'present' || r.status === 'late') && r.late_minutes > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, fontWeight: '500' }}>
                            They were late by {r.late_minutes} mins
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {r.mode === 'wfh' ? (
                        <span className="status-badge status-wfh" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)', border: '1px solid var(--success)' }}>
                          <Home size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} /> WFH
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Office</span>
                      )}
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
    </>
  )
}
