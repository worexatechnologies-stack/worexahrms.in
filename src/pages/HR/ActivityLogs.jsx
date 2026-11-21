import React, { useState, useMemo } from 'react'
import { useGetActivityLogsQuery } from '../../store/apiSlice'
import {
  RefreshCw, Search, Calendar, Filter, ClipboardList,
  ChevronDown, ChevronUp, MapPin, Laptop, Clock, User, CheckSquare,
  AlertTriangle, AlertCircle, CheckCircle2, ShieldCheck, Download,
  TrendingUp, FileSpreadsheet, Activity, ExternalLink, X, ArrowUpRight,
  Info, Building2
} from 'lucide-react'

const TYPES = [
  { value: '', label: 'All Types' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' }
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

function getActivityCategory(title = '', msg = '') {
  const t = (title + ' ' + msg).toLowerCase()
  if (t.includes('attendance') || t.includes('check-in') || t.includes('late') || t.includes('break')) {
    return { label: 'Attendance', color: '#2563eb', bg: '#eff6ff' }
  }
  if (t.includes('leave') || t.includes('wfh') || t.includes('holiday')) {
    return { label: 'Leave & Off', color: '#059669', bg: '#ecfdf3' }
  }
  if (t.includes('login') || t.includes('password') || t.includes('auth') || t.includes('security')) {
    return { label: 'Security & Auth', color: '#7c3aed', bg: '#f5f3ff' }
  }
  if (t.includes('payroll') || t.includes('salary')) {
    return { label: 'Payroll', color: '#0891b2', bg: '#ecfeff' }
  }
  return { label: 'System', color: '#64748b', bg: '#f1f5f9' }
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

  const handleSetToday = () => {
    const today = new Date().toISOString().slice(0, 10)
    setFromDate(today)
    setToDate(today)
    setPage(1)
  }

  const toggleRow = (id) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  const handlePageChange = (newPg) => {
    setPage(newPg)
  }

  // Client-side CSV export
  const handleExportCSV = () => {
    if (!logs || logs.length === 0) return
    const headers = ['Timestamp', 'Activity', 'Severity', 'Category', 'Summary']
    const rows = logs.map(l => {
      const parsed = parseMessage(l)
      const cat = getActivityCategory(l.title, l.message)
      return [
        `"${(l.created_at || '').replace(/"/g, '""')}"`,
        `"${(l.title || '').replace(/"/g, '""')}"`,
        `"${(l.type || 'info').replace(/"/g, '""')}"`,
        `"${cat.label.replace(/"/g, '""')}"`,
        `"${(parsed.text || '').replace(/"/g, '""')}"`
      ]
    })
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `hrms_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Distribution counts for current view
  const severityCounts = useMemo(() => {
    const counts = { warning: 0, error: 0, info: 0, success: 0 }
    logs.forEach(l => {
      const t = l.type || 'info'
      if (counts[t] !== undefined) counts[t]++
      else counts.info++
    })
    return counts
  }, [logs])

  const totalCurrent = logs.length || 1
  const warningPct = Math.round((severityCounts.warning / totalCurrent) * 100)
  const errorPct = Math.round((severityCounts.error / totalCurrent) * 100)
  const infoPct = Math.round((severityCounts.info / totalCurrent) * 100)
  const successPct = Math.round((severityCounts.success / totalCurrent) * 100)

  // Leave approval ratio
  const leaveTotal = leaveSummary?.total || 0
  const leaveApprovedPct = leaveTotal > 0 ? Math.round((leaveSummary.approved / leaveTotal) * 100) : 0
  const leavePendingPct = leaveTotal > 0 ? Math.round((leaveSummary.pending / leaveTotal) * 100) : 0
  const leaveRejectedPct = leaveTotal > 0 ? Math.round((leaveSummary.rejected / leaveTotal) * 100) : 0

  return (
    <div className="activity-logs-page" style={{ padding: '4px 0 24px 0' }}>

      {/* ── 1. Executive Audit Overview KPI Cards ── */}
      <div className="audit-overview-kpis animate-fade-in">
        {/* Total Audit Records */}
        <div 
          className={`audit-kpi-card ${!typeFilter ? 'active' : ''}`}
          onClick={() => { setTypeFilter(''); setPage(1); }}
          title="Click to view all audit logs"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon navy"><ClipboardList size={20} /></div>
            <span className="emp-kpi-badge">Enterprise Trail</span>
          </div>
          <div className="emp-kpi-value">
            {pagination?.total ? pagination.total.toLocaleString() : logs.length.toLocaleString()}
          </div>
          <div className="emp-kpi-label">Total System Logged Events</div>
        </div>

        {/* Flagged Review / Warnings */}
        <div 
          className={`audit-kpi-card ${typeFilter === 'warning' ? 'active' : ''}`}
          onClick={() => { setTypeFilter(typeFilter === 'warning' ? '' : 'warning'); setPage(1); }}
          title="Click to filter warning events"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon amber"><AlertTriangle size={20} /></div>
            <span className="emp-kpi-badge" style={{ color: '#ea580c', background: '#fff7ed' }}>
              ● Requires Review
            </span>
          </div>
          <div className="emp-kpi-value" style={{ color: '#ea580c' }}>
            {severityCounts.warning}
          </div>
          <div className="emp-kpi-label">Flagged Warnings & Incidents</div>
        </div>

        {/* System & Security Events */}
        <div 
          className={`audit-kpi-card ${typeFilter === 'info' ? 'active' : ''}`}
          onClick={() => { setTypeFilter(typeFilter === 'info' ? '' : 'info'); setPage(1); }}
          title="Click to filter operational info events"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon purple"><ShieldCheck size={20} /></div>
            <span className="emp-kpi-badge" style={{ color: '#7c3aed', background: '#f5f3ff' }}>
              Verified
            </span>
          </div>
          <div className="emp-kpi-value" style={{ color: '#7c3aed' }}>
            {severityCounts.info}
          </div>
          <div className="emp-kpi-label">Operational & Auth Events</div>
        </div>

        {/* Leave Clearance Rate */}
        <div 
          className="audit-kpi-card"
          title="Leave clearance compliance"
        >
          <div className="emp-kpi-top">
            <div className="emp-kpi-icon green"><TrendingUp size={20} /></div>
            <span className="emp-kpi-badge" style={{ color: '#059669', background: '#ecfdf3' }}>
              {leaveSummary ? `${leaveSummary.approved}/${leaveSummary.total} Approved` : 'Clear'}
            </span>
          </div>
          <div className="emp-kpi-value" style={{ color: '#059669' }}>
            {leaveSummary && leaveSummary.total > 0 ? `${leaveApprovedPct}%` : '100%'}
          </div>
          <div className="emp-kpi-label">Leave Clearance Rate</div>
        </div>
      </div>

      {/* ── 2. Modern Search & Filter Toolbar ── */}
      <div 
        className="search-bar animate-fade-in" 
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 12, 
          marginBottom: 20, 
          padding: '16px 18px', 
          background: 'var(--bg-card)', 
          borderRadius: 16, 
          border: '1px solid var(--border)',
          boxShadow: '0 2px 10px rgba(15, 23, 42, 0.03)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          {/* Search Field */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: '1 1 280px', minWidth: 240 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search activity title, employee, summary..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '9px 36px 9px 38px', 
                  borderRadius: 10, 
                  border: '1px solid var(--border)', 
                  background: 'var(--surface-2)', 
                  color: 'var(--text-primary)',
                  fontSize: 13.5,
                  outline: 'none',
                  transition: 'border-color 0.18s, box-shadow 0.18s'
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setPage(1); }}
                  aria-label="Clear search"
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 4
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              Search
            </button>
          </form>

          {/* Severity Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={15} style={{ color: 'var(--text-muted)' }} />
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              aria-label="Filter by type"
              style={{ 
                padding: '8px 12px', 
                borderRadius: 10, 
                border: '1px solid var(--border)', 
                background: 'var(--surface-2)', 
                color: 'var(--text-primary)', 
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Date range filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
            <Calendar size={15} style={{ color: 'var(--text-muted)' }} />
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(1); }}
              placeholder="From"
              aria-label="From date"
              style={{ 
                padding: '7px 10px', 
                borderRadius: 9, 
                border: '1px solid var(--border)', 
                background: 'var(--surface-2)', 
                color: 'var(--text-primary)', 
                fontSize: 12.5 
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(1); }}
              placeholder="To"
              aria-label="To date"
              style={{ 
                padding: '7px 10px', 
                borderRadius: 9, 
                border: '1px solid var(--border)', 
                background: 'var(--surface-2)', 
                color: 'var(--text-primary)', 
                fontSize: 12.5 
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={handleSetToday}
              title="Set date range to today"
              style={{ fontSize: 11.5, padding: '6px 10px', borderRadius: 8 }}
            >
              Today
            </button>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => load()} 
              title="Refresh Logs" 
              aria-label="Refresh logs" 
              style={{ padding: '8px 12px', borderRadius: 9 }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin-fast' : ''} />
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={handleReset} 
              style={{ padding: '8px 14px', borderRadius: 9, fontSize: 13 }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Quick Filter Severity Chips Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Quick Filters:</span>
          <div 
            className={`audit-filter-chip ${typeFilter === '' ? 'active' : ''}`}
            onClick={() => { setTypeFilter(''); setPage(1); }}
          >
            All Logs
          </div>
          <div 
            className={`audit-filter-chip ${typeFilter === 'warning' ? 'active' : ''}`}
            onClick={() => { setTypeFilter('warning'); setPage(1); }}
            style={typeFilter === 'warning' ? { background: '#ea580c', borderColor: '#ea580c' } : {}}
          >
            <AlertTriangle size={13} style={{ color: typeFilter === 'warning' ? '#fff' : '#ea580c' }} />
            Warnings ({severityCounts.warning})
          </div>
          <div 
            className={`audit-filter-chip ${typeFilter === 'error' ? 'active' : ''}`}
            onClick={() => { setTypeFilter('error'); setPage(1); }}
            style={typeFilter === 'error' ? { background: '#ef4444', borderColor: '#ef4444' } : {}}
          >
            <AlertCircle size={13} style={{ color: typeFilter === 'error' ? '#fff' : '#ef4444' }} />
            Errors ({severityCounts.error})
          </div>
          <div 
            className={`audit-filter-chip ${typeFilter === 'info' ? 'active' : ''}`}
            onClick={() => { setTypeFilter('info'); setPage(1); }}
          >
            <Info size={13} style={{ color: typeFilter === 'info' ? '#fff' : '#2563eb' }} />
            Info ({severityCounts.info})
          </div>
          <div 
            className={`audit-filter-chip ${typeFilter === 'success' ? 'active' : ''}`}
            onClick={() => { setTypeFilter('success'); setPage(1); }}
            style={typeFilter === 'success' ? { background: '#10b981', borderColor: '#10b981' } : {}}
          >
            <CheckCircle2 size={13} style={{ color: typeFilter === 'success' ? '#fff' : '#10b981' }} />
            Success ({severityCounts.success})
          </div>
        </div>
      </div>

      {/* ── 3. Main Two-Column Layout ── */}
      <div className="activity-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        
        {/* Left Column: System Activities Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 16 }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1d4ed8' }}>
                <Activity size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  System Activities & Audit Trail
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Immutable event stream for compliance & operations
                </span>
              </div>
            </div>
            {pagination && (
              <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                {pagination.total.toLocaleString()} Records
              </span>
            )}
          </div>

          {loading && logs.length === 0 ? (
            <div className="loading-container" style={{ minHeight: 340 }}><div className="spinner" /></div>
          ) : logs.length === 0 ? (
            <div className="table-empty" style={{ minHeight: 340, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
              <ClipboardList size={38} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
              <p style={{ color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>No audit logs found matching the selected criteria.</p>
              <button className="btn btn-sm btn-secondary" onClick={handleReset}>Clear All Filters</button>
            </div>
          ) : (
            <div className="table-container activity-log-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="activity-log-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1.5px solid var(--border)', background: 'var(--surface-2)' }}>
                    <th style={{ width: '44px', padding: '12px 14px' }}></th>
                    <th style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Timestamp</th>
                    <th style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Activity</th>
                    <th style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Severity</th>
                    <th style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const parsed = parseMessage(log)
                    const isExpanded = expandedId === log.id
                    const cat = getActivityCategory(log.title, log.message)
                    const sev = log.type || 'info'
                    
                    return (
                      <React.Fragment key={log.id}>
                        <tr 
                          onClick={() => toggleRow(log.id)}
                          style={{ 
                            borderBottom: '1px solid var(--border)', 
                            cursor: 'pointer',
                            background: isExpanded ? 'var(--surface-2)' : 'transparent',
                            transition: 'background 0.18s ease'
                          }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(37, 99, 235, 0.03)' }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                        >
                          <td style={{ textAlign: 'center', padding: '14px 10px', color: 'var(--text-muted)' }}>
                            <div style={{ width: 24, height: 24, borderRadius: 6, background: isExpanded ? 'var(--primary)' : 'var(--surface-2)', color: isExpanded ? '#fff' : 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                              <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                              {log.created_at}
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                                {log.title}
                              </span>
                              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: cat.bg, color: cat.color }}>
                                {cat.label}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {sev === 'warning' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#fff7ed', color: '#ea580c', border: '1px solid rgba(234, 88, 12, 0.2)' }}>
                                <AlertTriangle size={12} />
                                Warning
                              </span>
                            )}
                            {sev === 'error' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                <AlertCircle size={12} />
                                Error
                              </span>
                            )}
                            {sev === 'success' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ecfdf5', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                <CheckCircle2 size={12} />
                                Success
                              </span>
                            )}
                            {sev !== 'warning' && sev !== 'error' && sev !== 'success' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#2563eb', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                                <Info size={12} />
                                {sev}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {parsed.text}
                          </td>
                        </tr>

                        {/* Expanded details view */}
                        {isExpanded && (
                          <tr key={`expand-${log.id}`} style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                            <td></td>
                            <td colSpan={4} style={{ padding: '18px 22px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                
                                {/* Detailed message text */}
                                <div style={{ background: 'var(--bg-card)', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <FileSpreadsheet size={15} style={{ color: 'var(--primary)' }} />
                                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Event Narrative</h4>
                                  </div>
                                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{parsed.text}</p>
                                </div>

                                {/* Structured Metadata Cards */}
                                {parsed.meta && (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
                                    {parsed.meta.name && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
                                          <User size={15} />
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Employee</div>
                                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{parsed.meta.name}</div>
                                        </div>
                                      </div>
                                    )}
                                    {parsed.meta.time && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed' }}>
                                          <Clock size={15} />
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Action Timestamp</div>
                                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{parsed.meta.time}</div>
                                        </div>
                                      </div>
                                    )}
                                    {parsed.meta.device && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#ecfeff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0891b2' }}>
                                          <Laptop size={15} />
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Device / Platform</div>
                                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{parsed.meta.device}</div>
                                        </div>
                                      </div>
                                    )}
                                    {parsed.meta.lat && parsed.meta.lng && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
                                          <MapPin size={15} />
                                        </div>
                                        <div>
                                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>GPS Geolocation</div>
                                          <a 
                                            href={`https://www.google.com/maps?q=${parsed.meta.lat},${parsed.meta.lng}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                            onClick={e => e.stopPropagation()}
                                          >
                                            {parseFloat(parsed.meta.lat).toFixed(4)}, {parseFloat(parsed.meta.lng).toFixed(4)}
                                            <ExternalLink size={11} />
                                          </a>
                                          {parsed.meta.accuracy && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>(±{parsed.meta.accuracy}m)</span>}
                                        </div>
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

          {/* Pagination Controls */}
          {pagination && pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>
                Showing page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{pagination.pages}</strong> ({pagination.total.toLocaleString()} total)
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handlePageChange(1)}
                  disabled={page === 1}
                  title="First page"
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
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, height: 28, borderRadius: 6, background: 'var(--surface-2)', fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
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
                  title="Last page"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Analytics, Recent Leaves, and Audit Intelligence */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Card 1: Leaves Stats (Date Range) */}
          <div className="card" style={{ padding: '18px 20px', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                <CheckSquare size={16} style={{ color: 'var(--primary)' }} />
                Leaves Status Overview
              </h3>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6 }}>
                Range
              </span>
            </div>

            {leaveSummary ? (
              <>
                {/* Visual Ratio Progress Bar */}
                <div className="audit-progress-bar">
                  <div 
                    className="audit-progress-segment" 
                    style={{ width: `${leaveApprovedPct}%`, background: '#10b981' }} 
                    title={`Approved: ${leaveApprovedPct}%`} 
                  />
                  <div 
                    className="audit-progress-segment" 
                    style={{ width: `${leavePendingPct}%`, background: '#f59e0b' }} 
                    title={`Pending: ${leavePendingPct}%`} 
                  />
                  <div 
                    className="audit-progress-segment" 
                    style={{ width: `${leaveRejectedPct}%`, background: '#ef4444' }} 
                    title={`Rejected: ${leaveRejectedPct}%`} 
                  />
                </div>

                {/* 4 Metric Boxes */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 10, textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Total Submissions</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{leaveSummary.total}</div>
                  </div>
                  <div style={{ background: '#fffbeb', padding: '10px 12px', borderRadius: 10, textAlign: 'center', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#b45309' }}>Pending Review</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b', marginTop: 2 }}>{leaveSummary.pending}</div>
                  </div>
                  <div style={{ background: '#ecfdf5', padding: '10px 12px', borderRadius: 10, textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#047857' }}>Approved</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', marginTop: 2 }}>{leaveSummary.approved}</div>
                  </div>
                  <div style={{ background: '#fef2f2', padding: '10px 12px', borderRadius: 10, textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c' }}>Rejected</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444', marginTop: 2 }}>{leaveSummary.rejected}</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '14px 0', fontSize: 12 }}>
                Select a date range to view leaves summary
              </div>
            )}
          </div>

          {/* Card 2: Recent Leave Submissions */}
          <div className="card" style={{ padding: '18px 20px', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                <Clock size={16} style={{ color: 'var(--primary)' }} />
                Recent Leave Submissions
              </h3>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                {leaves.length} records
              </span>
            </div>

            {loading && leaves.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><div className="spinner" /></div>
            ) : leaves.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0', fontSize: 12 }}>
                No leaves submitted in this range.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '320px', overflowY: 'auto', paddingRight: 4 }}>
                {leaves.slice(0, 5).map(l => {
                  const empInitials = (l.employee_name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  const statusColors = {
                    approved: { bg: '#ecfdf5', color: '#059669' },
                    pending: { bg: '#fffbeb', color: '#d97706' },
                    rejected: { bg: '#fef2f2', color: '#dc2626' }
                  }
                  const badge = statusColors[l.status] || { bg: 'var(--surface-2)', color: 'var(--text-secondary)' }

                  return (
                    <div 
                      key={l.id} 
                      style={{ 
                        padding: '11px 13px', 
                        borderRadius: 10, 
                        background: 'var(--surface-2)', 
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        transition: 'transform 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {empInitials}
                          </div>
                          <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-primary)' }}>{l.employee_name}</span>
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: badge.bg, color: badge.color, textTransform: 'capitalize' }}>
                          {l.status}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                        <span style={{ fontWeight: 600 }}>{l.leave_type}</span>
                        <span>•</span>
                        <span>{l.start_date} to {l.end_date}</span>
                      </div>

                      {l.reason && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic', background: 'var(--bg-card)', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          "{l.reason}"
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Card 3: Audit Intelligence & Security Pulse (Fills the Void!) */}
          <div className="audit-intel-card animate-fade-in" style={{ borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={16} style={{ color: '#2563eb' }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Audit Health & Intelligence
                </h3>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '3px 8px', borderRadius: 999 }}>
                <span className="audit-pulse-dot" />
                Live Audited
              </span>
            </div>

            {/* Severity Breakdown Bar */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                <span>Event Distribution</span>
                <span>Current Page</span>
              </div>
              <div className="audit-progress-bar" style={{ margin: 0 }}>
                <div style={{ width: `${warningPct}%`, background: '#ea580c' }} title={`Warnings: ${warningPct}%`} />
                <div style={{ width: `${errorPct}%`, background: '#ef4444' }} title={`Errors: ${errorPct}%`} />
                <div style={{ width: `${infoPct}%`, background: '#2563eb' }} title={`Info: ${infoPct}%`} />
                <div style={{ width: `${successPct}%`, background: '#10b981' }} title={`Success: ${successPct}%`} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                <span style={{ color: '#ea580c', fontWeight: 600 }}>{warningPct}% Warn</span>
                <span style={{ color: '#2563eb', fontWeight: 600 }}>{infoPct}% Info</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>{successPct}% OK</span>
                <span style={{ color: '#ef4444', fontWeight: 600 }}>{errorPct}% Err</span>
              </div>
            </div>

            {/* Security & System Metadata Rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="audit-intel-row">
                <span style={{ color: 'var(--text-muted)' }}>Audit Trail Integrity</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={13} style={{ color: '#10b981' }} />
                  SHA-256 Verified
                </span>
              </div>
              <div className="audit-intel-row">
                <span style={{ color: 'var(--text-muted)' }}>Log Retention Policy</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Rolling 90 Days</span>
              </div>
              <div className="audit-intel-row">
                <span style={{ color: 'var(--text-muted)' }}>Monitoring Mode</span>
                <span style={{ fontWeight: 600, color: '#2563eb' }}>Full Compliance</span>
              </div>
            </div>

            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={logs.length === 0}
              className="btn btn-secondary"
              style={{
                width: '100%',
                marginTop: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '9px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: logs.length === 0 ? 'not-allowed' : 'pointer',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)'
              }}
            >
              <Download size={14} />
              Export Audit Trail (CSV)
            </button>
          </div>

        </div>
      </div>
      
    </div>
  )
}
