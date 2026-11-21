import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useGetWFHRequestsQuery, useDecideWFHRequestMutation, useGetWFHLiveStatusQuery, usePauseResumeTimerMutation, useForceStopWFHMutation, useDecideSleepModeMutation } from '../../store/apiSlice'
import { useToast } from '../../App'
import { RefreshCw, CheckCircle, XCircle, ChevronLeft, ChevronRight, Pause, Play, StopCircle, Moon, X } from 'lucide-react'

const PER_PAGE = 20

const days = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1)

function EmployeeAvatar({ name, size = 32 }) {
  const initials = name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = (name?.charCodeAt(0) || 0) * 13 % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue}, 65%, 55%)`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.35,
      fontFamily: 'Outfit, sans-serif', flexShrink: 0,
      border: '2px solid var(--border)',
    }}>
      {initials}
    </div>
  )
}

export default function HrWFH() {
  const [selectedWFH, setSelectedWFH] = useState(null)
  const [selectedTimeline, setSelectedTimeline] = useState(null)
  const [activeTab, setActiveTab] = useState('requests')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page,         setPage]         = useState(1)
  const [stopConfirm, setStopConfirm]   = useState(null) // { employee_id, employee_name }
  const [stopReason, setStopReason]     = useState('')
  const { toast } = useToast()

  // ----- RTK Query Hooks -----
  const { data: wfhRes, isFetching: loading, refetch: load } = useGetWFHRequestsQuery({
    page,
    per_page: PER_PAGE,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {})
  }, { skip: activeTab !== 'requests' })

  const { data: pendingRes } = useGetWFHRequestsQuery({
    page: 1,
    per_page: 1,
    status: 'pending'
  }, { skip: activeTab !== 'requests' })

  const { data: liveRes, isFetching: liveLoading, refetch: refetchLive } = useGetWFHLiveStatusQuery(undefined, {
    skip: activeTab !== 'live-monitor'
  })

  const [decideWFHRequest] = useDecideWFHRequestMutation()
  const [pauseResumeTimer, { isLoading: pauseResumeLoading }] = usePauseResumeTimerMutation()
  const [forceStopWFH, { isLoading: forceStopLoading }] = useForceStopWFHMutation()
  const [decideSleepMode, { isLoading: decideSleepLoading }] = useDecideSleepModeMutation()

  const d = wfhRes?.data
  const requests = d?.wfh_requests || d || []
  const pagination = d?.pagination || null
  const pendingCount = pendingRes?.data?.pagination?.total ?? 0

  const liveStatusList = liveRes?.data?.live_status || []

  const changeFilter = (s) => {
    setStatusFilter(s)
    setPage(1)
  }

  const updateStatus = async (id, status) => {
    try {
      await decideWFHRequest({ id, status }).unwrap()
      toast('WFH request ' + status + '.', 'success')
    } catch {
      toast('Failed to update.', 'error')
    }
  }

  const handlePauseTimer = async (employeeId, employeeName) => {
    if (!window.confirm(`Pause ${employeeName}'s WFH timer?`)) return
    try {
      await pauseResumeTimer({ action: 'hr_pause_timer', body: { employee_id: employeeId, reason: 'Paused by HR via WFH Monitor' } }).unwrap()
      toast(`${employeeName}'s timer paused.`, 'success')
      refetchLive()
    } catch (e) {
      toast(e.data?.message || 'Failed to pause timer.', 'error')
    }
  }

  const handleResumeTimer = async (employeeId, employeeName) => {
    try {
      await pauseResumeTimer({ action: 'hr_resume_timer', body: { employee_id: employeeId } }).unwrap()
      toast(`${employeeName}'s timer resumed.`, 'success')
      refetchLive()
    } catch (e) {
      toast(e.data?.message || 'Failed to resume timer.', 'error')
    }
  }

  const handleForceStop = async () => {
    if (!stopConfirm) return
    try {
      await forceStopWFH({ employee_id: stopConfirm.employee_id, reason: stopReason.trim() || 'Stopped by HR' }).unwrap()
      toast(`${stopConfirm.employee_name}'s WFH session stopped.`, 'success')
      setStopConfirm(null)
      setStopReason('')
      refetchLive()
    } catch (e) {
      toast(e.data?.message || 'Failed to stop WFH session.', 'error')
    }
  }

  const handleDecideSleepMode = async (employeeId, employeeName, status) => {
    try {
      await decideSleepMode({ employee_id: employeeId, status }).unwrap()
      toast(`Sleep mode ${status} for ${employeeName}.`, 'success')
      refetchLive()
    } catch (e) {
      toast(e.data?.message || `Failed to ${status} sleep mode.`, 'error')
    }
  }

  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1

  return (
    <>
      <style>{`
        @keyframes pulse-dot {
          0% { transform: scale(0.95); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.6; }
        }
        .hr-wfh-action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; border-radius: 6px; font-size: 11px;
          font-weight: 600; border: 1px solid transparent;
          cursor: pointer; transition: all 0.2s ease;
          white-space: nowrap;
        }
        .hr-wfh-action-btn:disabled {
          opacity: 0.5; cursor: not-allowed;
        }
        .hr-wfh-action-btn.pause-btn {
          background: var(--warning-soft, rgba(245,158,11,0.12));
          color: var(--warning, #f59e0b);
          border-color: var(--warning, #f59e0b);
        }
        .hr-wfh-action-btn.pause-btn:hover:not(:disabled) {
          background: var(--warning, #f59e0b);
          color: #fff;
        }
        .hr-wfh-action-btn.resume-btn {
          background: var(--success-soft, rgba(16,185,129,0.12));
          color: var(--success, #10b981);
          border-color: var(--success, #10b981);
        }
        .hr-wfh-action-btn.resume-btn:hover:not(:disabled) {
          background: var(--success, #10b981);
          color: #fff;
        }
        .hr-wfh-action-btn.stop-btn {
          background: var(--danger-soft, rgba(239,68,68,0.12));
          color: var(--danger, #ef4444);
          border-color: var(--danger, #ef4444);
        }
        .hr-wfh-action-btn.stop-btn:hover:not(:disabled) {
          background: var(--danger, #ef4444);
          color: #fff;
        }
        .hr-wfh-timer-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 12px; font-size: 10px;
          font-weight: 600; letter-spacing: 0.03em;
        }
      `}</style>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 16 }}>
        <button
          className="btn"
          onClick={() => setActiveTab('requests')}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'requests' ? '3px solid var(--primary)' : '3px solid transparent',
            borderRadius: 0,
            color: activeTab === 'requests' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: 600,
            padding: '10px 16px',
            boxShadow: 'none',
            cursor: 'pointer'
          }}
        >
          Requests Management
        </button>
        <button
          className="btn"
          onClick={() => setActiveTab('live-monitor')}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'live-monitor' ? '3px solid var(--primary)' : '3px solid transparent',
            borderRadius: 0,
            color: activeTab === 'live-monitor' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: 600,
            padding: '10px 16px',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer'
          }}
        >
          <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--success)', borderRadius: '50%', animation: 'pulse-dot 1.8s infinite ease-in-out' }} />
          Live WFH Monitor
        </button>
      </div>

      {activeTab === 'requests' ? (
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
              {pagination ? `${pagination.total} requests` : `${requests.length} requests`}
            </span>
            <span className="status-badge status-pending" style={{ marginLeft: 8 }}>
              {pendingCount} pending
            </span>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading && requests.length === 0 ? (
              <div className="loading-container"><div className="spinner" /></div>
            ) : requests.length === 0 ? (
              <div className="table-empty"><div className="empty-icon">-</div><p>No Work From Home requests found.</p></div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Branch</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EmployeeAvatar name={r.employee_name} size={32} />
                            <div>
                              <div style={{ fontWeight: 500 }}>{r.employee_name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.employee_code}</div>
                            </div>
                          </div>
                        </td>
                        <td>{r.branch || '-'}</td>
                        <td>{r.start_date}</td>
                        <td>{r.end_date}</td>
                        <td>{days(r.start_date, r.end_date)}</td>
                        <td
                          title="Click to view full details"
                          onClick={() => setSelectedWFH(r)}
                          style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--primary)' }}
                        >
                          {r.reason}
                        </td>
                        <td><span className={`status-badge status-${r.status}`}>{r.status}</span></td>
                        <td>
                          <div className="table-actions">
                            <button className="btn btn-sm btn-success" disabled={r.status === 'approved'} onClick={() => updateStatus(r.id, 'approved')}>
                              <CheckCircle size={13}/> Approve
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={r.status === 'rejected'} onClick={() => updateStatus(r.id, 'rejected')}>
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
        </>
      ) : (
        <>
          <div className="search-bar" style={{ gap: 12 }}>
            <button className="btn btn-secondary" onClick={() => refetchLive()}>
              <RefreshCw size={14}/> Refresh
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              {liveStatusList.length} employees active on WFH today
            </span>
          </div>

          {liveLoading ? (
            <div className="loading-container"><div className="spinner" /></div>
          ) : liveStatusList.length === 0 ? (
            <div className="table-empty"><div className="empty-icon">-</div><p>No employees are currently on approved Work From Home today.</p></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
              {liveStatusList.map(item => {
                const statusColor = item.latest_status === 'active' ? 'var(--success)' : 
                                    item.latest_status === 'away' ? 'var(--danger)' :
                                    (item.latest_status === 'meeting' || item.latest_status === 'sleep') ? 'var(--warning)' : 'var(--text-muted)';
                const isPaused = !!item.timer_paused || !!item.pause_reason
                const isCheckedIn = !!item.is_checked_in
                const isCheckedOut = !!item.is_checked_out
                const canPause = isCheckedIn && !isCheckedOut && !isPaused
                const canResume = isCheckedIn && !isCheckedOut && isPaused
                const canStop = isCheckedIn && !isCheckedOut

                return (
                  <div key={item.employee_id} className="card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: `4px solid ${statusColor}`, background: item.latest_status === 'away' ? 'var(--danger-soft)' : 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <EmployeeAvatar name={item.employee_name} size={36} />
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{item.employee_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.employee_code} · {item.branch || 'HO'}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, background: statusColor, borderRadius: '50%', animation: item.latest_status === 'active' ? 'pulse-dot 1.8s infinite ease-in-out' : 'none' }} />
                        <span className={`status-badge status-${item.latest_status}`} style={{ fontSize: 11, textTransform: 'capitalize', padding: '2px 6px' }}>{item.latest_status}</span>
                      </div>
                    </div>

                    {/* Timer State Badge */}
                    {isCheckedIn && !isCheckedOut && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {isPaused ? (
                          <span className="hr-wfh-timer-badge" style={{ background: 'var(--warning-soft, rgba(245,158,11,0.12))', color: 'var(--warning, #f59e0b)', border: '1px solid var(--warning, #f59e0b)' }}>
                            <Pause size={10} /> Timer Paused
                          </span>
                        ) : (
                          <span className="hr-wfh-timer-badge" style={{ background: 'var(--success-soft, rgba(16,185,129,0.12))', color: 'var(--success, #10b981)', border: '1px solid var(--success, #10b981)' }}>
                            <Play size={10} /> Timer Running
                          </span>
                        )}
                        {item.check_in_time && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>In: {item.check_in_time}</span>
                        )}
                      </div>
                    )}
                    {/* Sleep Mode Pending Approval Alert */}
                    {item.sleep_request && item.sleep_request.status === 'pending' && (
                      <div style={{ background: 'var(--warning-soft, rgba(245,158,11,0.12))', border: '1px solid var(--warning, #f59e0b)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--warning, #f59e0b)', marginBottom: 4 }}>
                          <Moon size={14} /> Sleep Mode Requested
                        </div>
                        <div style={{ color: 'var(--text-primary)', marginBottom: 8, fontStyle: 'italic' }}>
                          "{item.sleep_request.reason}"
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-sm btn-success"
                            disabled={decideSleepLoading}
                            onClick={() => handleDecideSleepMode(item.employee_id, item.employee_name, 'approved')}
                            style={{ padding: '3px 8px', fontSize: 11 }}
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={decideSleepLoading}
                            onClick={() => handleDecideSleepMode(item.employee_id, item.employee_name, 'rejected')}
                            style={{ padding: '3px 8px', fontSize: 11 }}
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ background: item.latest_status === 'away' ? 'rgba(255,255,255,0.4)' : 'var(--bg-input)', padding: '10px 12px', borderRadius: 8, fontSize: 13, flex: 1 }}>
                      <div style={{ fontWeight: 600, color: item.latest_status === 'away' ? 'var(--danger)' : 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.05em' }}>{item.latest_status === 'away' ? 'Warning' : 'Working On'}</div>
                      <div style={{ color: item.latest_status === 'away' ? 'var(--danger)' : 'var(--text-primary)', wordBreak: 'break-word', minHeight: 36, lineHeight: '1.4' }}>{item.latest_custom_status}</div>
                    </div>

                    {/* HR Action Buttons: Pause / Resume / Stop */}
                    {isCheckedIn && !isCheckedOut && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        {canPause && (
                          <button
                            className="hr-wfh-action-btn pause-btn"
                            disabled={pauseResumeLoading}
                            onClick={() => handlePauseTimer(item.employee_id, item.employee_name)}
                          >
                            <Pause size={12} /> Pause
                          </button>
                        )}
                        {canResume && (
                          <button
                            className="hr-wfh-action-btn resume-btn"
                            disabled={pauseResumeLoading}
                            onClick={() => handleResumeTimer(item.employee_id, item.employee_name)}
                          >
                            <Play size={12} /> Resume
                          </button>
                        )}
                        {canStop && (
                          <button
                            className="hr-wfh-action-btn stop-btn"
                            disabled={forceStopLoading}
                            onClick={() => { setStopConfirm({ user_id: item.user_id, employee_name: item.employee_name }); setStopReason('') }}
                          >
                            <StopCircle size={12} /> Stop
                          </button>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <span>Updated: {item.last_updated || 'No updates today'}</span>
                      <button className="btn btn-sm btn-secondary" onClick={() => setSelectedTimeline({ employee_name: item.employee_name, timeline: item.timeline || [] })}>Timeline Logs</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Force Stop Confirmation Modal */}
      {stopConfirm && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => !forceStopLoading && setStopConfirm(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"440px",background:"var(--bg-card)",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(0,0,0,0.5)",border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}>
                <StopCircle size={20} /> Force Stop WFH
              </h2>
              <button className="modal-close" onClick={() => !forceStopLoading && setStopConfirm(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div style={{ padding: '0 24px 20px' }}>
              <p style={{ margin: '0 0 16px 0', fontSize: 14, color: 'var(--text-primary)' }}>
                Are you sure you want to force-stop <strong>{stopConfirm.employee_name}</strong>'s WFH session? This will check them out immediately.
              </p>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="stop-reason">Reason (optional)</label>
                <textarea
                  className="form-textarea"
                  id="stop-reason"
                  value={stopReason}
                  onChange={e => setStopReason(e.target.value)}
                  placeholder="e.g. End of working hours, policy violation..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div className="modal-footer" style={{ margin: '20px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setStopConfirm(null)} disabled={forceStopLoading}>Cancel</button>
                <button className="btn btn-danger" onClick={handleForceStop} disabled={forceStopLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StopCircle size={14} /> {forceStopLoading ? 'Stopping...' : 'Force Stop'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Detail modal */}
      {selectedWFH && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setSelectedWFH(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"520px",background:"var(--bg-card)",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(0,0,0,0.5)",border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2>Work From Home Details</h2>
              <button className="modal-close" onClick={() => setSelectedWFH(null)} aria-label="Close details"><X size={18} /></button>
            </div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="detail-grid">
                <div><strong>Employee</strong><span>{selectedWFH.employee_name} ({selectedWFH.employee_code})</span></div>
                <div><strong>Branch</strong><span>{selectedWFH.branch || '-'}</span></div>
                <div><strong>Dates</strong><span>{selectedWFH.start_date} to {selectedWFH.end_date}</span></div>
                <div><strong>Days</strong><span>{days(selectedWFH.start_date, selectedWFH.end_date)} day(s)</span></div>
                <div><strong>Status</strong><span className={`status-badge status-${selectedWFH.status}`}>{selectedWFH.status}</span></div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: 'var(--text)' }}>Reason</div>
                <div className="leave-reason-full">{selectedWFH.reason}</div>
              </div>
              <div className="modal-footer" style={{ margin: '20px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedWFH(null)}>Close</button>
                <button className="btn btn-success" disabled={selectedWFH.status === 'approved'} onClick={() => { updateStatus(selectedWFH.id, 'approved'); setSelectedWFH(null) }}>Approve</button>
                <button className="btn btn-danger" disabled={selectedWFH.status === 'rejected'} onClick={() => { updateStatus(selectedWFH.id, 'rejected'); setSelectedWFH(null) }}>Reject</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Timeline Modal */}
      {selectedTimeline && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }} onClick={() => setSelectedTimeline(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative",width:"100%",maxWidth:"480px",background:"var(--bg-card)",borderRadius:"18px",boxShadow:"0 25px 60px -15px rgba(0,0,0,0.5)",border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"calc(100vh - 40px)" }}>
            <div className="modal-header">
              <h2>{selectedTimeline.employee_name}'s Timeline</h2>
              <button className="modal-close" onClick={() => setSelectedTimeline(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '0 24px 20px' }}>
              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 0' }}>
                {selectedTimeline.timeline.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                    No updates submitted today.
                  </div>
                ) : (
                  selectedTimeline.timeline.map((log, index) => (
                    <div key={log.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingLeft: 20 }}>
                      {/* timeline line */}
                      {index < selectedTimeline.timeline.length - 1 && (
                        <div style={{ position: 'absolute', left: 7, top: 12, bottom: -18, width: 2, background: 'var(--border)' }} />
                      )}
                      {/* timeline dot */}
                      <div style={{
                        position: 'absolute', left: 3, top: 5, width: 10, height: 10, borderRadius: '50%',
                        background: log.status === 'active' ? 'var(--success)' : (log.status === 'meeting' ? 'var(--warning)' : 'var(--text-muted)')
                      }} />
                      
                      <div style={{ flex: 1, background: 'var(--bg-input)', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span className={`status-badge status-${log.status}`} style={{ textTransform: 'capitalize', fontSize: 10, padding: '1px 5px' }}>{log.status}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{log.created_at}</span>
                        </div>
                        <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{log.custom_status}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="modal-footer" style={{ margin: '14px -24px -20px', padding: '14px 24px' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedTimeline(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
