import { useState } from 'react'
import { useGetAttendanceQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import { ChevronLeft, ChevronRight, RefreshCw, Home } from 'lucide-react'
import { displayWorkedHours, fmtTime } from '../../utils/attendanceHelpers'

const PER_PAGE = 15

export default function EmpAttendance() {
  const { user } = useAuth()
  const isViyana = user?.company_slug === 'viyana'
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
                <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Working Hours</th>{!isViyana && <th>Breaks</th>}<th>Task Update</th><th>Status</th><th>Mode</th></tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.check_in ? fmtTime(r.check_in) : '-'}</td>
                    <td>{r.check_out ? fmtTime(r.check_out) : '-'}</td>
                    <td>{displayWorkedHours(r)}</td>
                    {!isViyana && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {Array.isArray(r.breaks) && r.breaks.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {r.breaks.map((b, i) => {
                            const type = (b.break_type || 'break').toLowerCase()
                            const label = type === 'lunch' ? 'Lunch' : type === 'evening' ? 'Evening' : type === 'tea' ? 'Tea' : 'Break'
                            const sTime = fmtTime(b.started_at)
                            const eTime = b.ended_at ? fmtTime(b.ended_at) : (b.status === 'active' ? 'Active' : '')
                            const isLunch = type === 'lunch'
                            return (
                              <span
                                key={i}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: isLunch ? '#f59e0b' : '#8b5cf6',
                                  background: isLunch ? 'rgba(245, 158, 11, 0.12)' : 'rgba(139, 92, 246, 0.12)',
                                  border: isLunch ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(139, 92, 246, 0.25)',
                                  padding: '2px 7px',
                                  borderRadius: 6,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  width: 'fit-content',
                                }}
                              >
                                {label} {sTime}{eTime ? ` – ${eTime}` : ''}
                              </span>
                            )
                          })}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                      )}
                    </td>
                    )}
                    <td style={{ maxWidth: 280 }}>
                      {r.daily_task_update
                        ? <div className="task-update-cell" title={r.daily_task_update}>{r.daily_task_update}</div>
                        : '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        <span className={`status-badge status-${r.status || 'present'}`}>
                          {(r.status || 'present').replace('_', ' ')}
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
