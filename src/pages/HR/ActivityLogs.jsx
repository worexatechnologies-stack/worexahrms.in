import React, { useState } from 'react'
import { useGetActivityLogsQuery } from '../../store/apiSlice'
import {
  RefreshCw, Search, Calendar, Filter, ClipboardList,
  ChevronDown, ChevronUp, MapPin, Laptop, Clock, User, CheckSquare
} from 'lucide-react'

const TYPES = [
  { value: '', label: 'All Types' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' }
]

function parseMessage(log) {
  if (!log) return { text: '', meta: null }
  const msg = log.message || ''
  if (msg.includes('employee_id=')) {
    const parts = msg.split(';')
    const meta = {}
    let text = ''
    parts.forEach(part => {
      if (part.includes('=')) {
        const [k, v] = part.split('=')
        meta[k.trim()] = v.trim()
      } else {
        const trimmed = part.trim()
        if (trimmed) text += trimmed + ' '
      }
    })
    return { text: text.trim(), meta }
  }

  // Handle structured fields for new log entries
  if (log.source_employee_name || log.device || log.lat || log.login_time || log.check_in_time) {
    const meta = {
      name: log.source_employee_name || '',
      time: log.login_time || log.check_in_time || '',
      device: log.device || '',
      lat: log.lat || null,
      lng: log.lng || null,
      accuracy: log.accuracy || ''
    }
    return { text: msg, meta }
  }

  return { text: msg, meta: null }
}

export default function ActivityLogs() {
  // Filters
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  
  // Expandable row state
  const [expandedId, setExpandedId] = useState(null)

  // ----- RTK Query Hook -----
  const { data: logsRes, isFetching: loading, refetch: load } = useGetActivityLogsQuery({
    page,
    per_page: 20,
    ...(search.trim() ? { search } : {}),
    ...(fromDate ? { from: fromDate } : {}),
    ...(toDate ? { to: toDate } : {}),
    ...(typeFilter ? { type: typeFilter } : {})
  })

  const d = logsRes?.data
  const logs = d?.logs || []
  const pagination = d?.pagination || null
  const leaves = d?.leaves || []
  const leaveSummary = d?.leave_summary || null

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    setPage(1)
  }

  const handleReset = () => {
    setSearch('')
    setFromDate('')
    setToDate('')
    setTypeFilter('')
    setPage(1)
  }

  const toggleRow = (id) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  const handlePageChange = (newPg) => {
    setPage(newPg)
  }

  return (
    <div className="activity-logs-page" style={{ padding: '4px 0 20px 0' }}>
      
      {/* Search & Filters Toolbar */}
      <div className="search-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, padding: 12, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: '1 1 300px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search title, description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>Search</button>
        </form>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {/* Log Type Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={15} style={{ color: 'var(--text-secondary)' }} />
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              aria-label="Filter by type"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)' }}
            >
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Date range filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} style={{ color: 'var(--text-secondary)' }} />
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(1); }}
              placeholder="From"
              aria-label="From date"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(1); }}
              placeholder="To"
              aria-label="To date"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }}
            />
          </div>

          <button className="btn btn-secondary" onClick={() => load()} title="Refresh Logs" aria-label="Refresh logs" style={{ padding: '8px 12px' }}>
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-secondary" onClick={handleReset} style={{ padding: '8px 12px' }}>
            Reset
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="activity-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        
        {/* Left Column: System Logs */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClipboardList size={18} style={{ color: 'var(--primary)' }} />
              System Activities
            </h3>
            {pagination && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Total: {pagination.total} records
              </span>
            )}
          </div>

          {loading && logs.length === 0 ? (
            <div className="loading-container" style={{ minHeight: 300 }}><div className="spinner" /></div>
          ) : logs.length === 0 ? (
            <div className="table-empty" style={{ minHeight: 300, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <p style={{ color: 'var(--text-secondary)' }}>No logs found matching search criteria.</p>
            </div>
          ) : (
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ width: '40px' }}></th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13 }}>Timestamp</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13 }}>Activity</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13 }}>Severity</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13 }}>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const parsed = parseMessage(log)
                    const isExpanded = expandedId === log.id
                    
                    return (
                      <React.Fragment key={log.id}>
                        <tr 
                          onClick={() => toggleRow(log.id)}
                          style={{ 
                            borderBottom: '1px solid var(--border)', 
                            cursor: 'pointer',
                            background: isExpanded ? 'var(--bg)' : 'transparent',
                            transition: 'background 0.2s'
                          }}
                        >
                          <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            {log.created_at}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            {log.title}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span className={`status-badge status-${log.type || 'info'}`} style={{ textTransform: 'capitalize', fontSize: 11, padding: '3px 8px' }}>
                              {log.type || 'info'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {parsed.text}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`expand-${log.id}`} style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                            <td></td>
                            <td colSpan={4} style={{ padding: '16px 20px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                
                                {/* Detailed message text */}
                                <div>
                                  <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: 'var(--text-primary)' }}>Log details</h4>
                                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{parsed.text}</p>
                                </div>

                                {/* Structured Metadata (if available) */}
                                {parsed.meta && (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: 12, background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)', marginTop: 4 }}>
                                    {parsed.meta.name && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <User size={14} style={{ color: 'var(--primary)' }} />
                                        <span><strong>Name:</strong> {parsed.meta.name}</span>
                                      </div>
                                    )}
                                    {parsed.meta.time && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <Clock size={14} style={{ color: 'var(--primary)' }} />
                                        <span><strong>Action Time:</strong> {parsed.meta.time}</span>
                                      </div>
                                    )}
                                    {parsed.meta.device && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <Laptop size={14} style={{ color: 'var(--primary)' }} />
                                        <span><strong>Device:</strong> {parsed.meta.device}</span>
                                      </div>
                                    )}
                                    {parsed.meta.lat && parsed.meta.lng && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <MapPin size={14} style={{ color: 'var(--primary)' }} />
                                        <span>
                                          <strong>Coordinates:</strong>{' '}
                                          <a 
                                            href={`https://www.google.com/maps?q=${parsed.meta.lat},${parsed.meta.lng}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                                            onClick={e => e.stopPropagation()}
                                          >
                                            {parseFloat(parsed.meta.lat).toFixed(4)}, {parseFloat(parsed.meta.lng).toFixed(4)}
                                          </a>
                                          {parsed.meta.accuracy && ` (±${parsed.meta.accuracy}m)`}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination controls */}
          {pagination && pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Page {page} of {pagination.pages}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handlePageChange(1)}
                  disabled={page === 1}
                >
                  «
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                >
                  Prev
                </button>
                <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 12, color: 'var(--text-primary)' }}>
                  {page}
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= pagination.pages}
                >
                  Next
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handlePageChange(pagination.pages)}
                  disabled={page >= pagination.pages}
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Leave Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Leaves Stats Card */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <CheckSquare size={16} style={{ color: 'var(--primary)' }} />
              Leaves Stats (Date Range)
            </h3>
            {leaveSummary ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{leaveSummary.total}</div>
                </div>
                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pending</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', marginTop: 4 }}>{leaveSummary.pending}</div>
                </div>
                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Approved</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{leaveSummary.approved}</div>
                </div>
                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Rejected</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>{leaveSummary.rejected}</div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '10px 0', fontSize: 12 }}>
                Select a date range to view stats
              </div>
            )}
          </div>

          {/* Leaves List Card */}
          <div className="card" style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              Recent Leave Submissions
            </h3>
            {loading && leaves.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0' }}><div className="spinner" /></div>
            ) : leaves.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 0', fontSize: 12 }}>
                No leaves submitted in this range.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: '350px', paddingRight: 4 }}>
                {leaves.slice(0, 5).map(l => (
                  <div 
                    key={l.id} 
                    style={{ 
                      padding: 10, 
                      borderRadius: 6, 
                      background: 'var(--bg)', 
                      border: '1px solid var(--border)',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
                      <span style={{ color: 'var(--text-primary)' }}>{l.employee_name}</span>
                      <span className={`status-badge status-${l.status}`} style={{ fontSize: 10, padding: '2px 6px' }}>{l.status}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      {l.leave_type} · {l.start_date} to {l.end_date}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: 2 }}>
                      "{l.reason}"
                    </div>
                  </div>
                ))}
                {leaves.length > 5 && (
                  <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    + {leaves.length - 5} more leaves in range
                  </div>
                )}
              </div>
            )}
          </div>
          
        </div>
      </div>
      
    </div>
  )
}
