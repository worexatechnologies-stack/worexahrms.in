import { useState } from 'react'
import { useGetAttendanceQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import { ChevronLeft, ChevronRight, RefreshCw, Home, Building2, Clock, Calendar, CheckCircle2 } from 'lucide-react'
import { fmtTime } from '../../utils/attendanceHelpers'

const PER_PAGE = 15

function formatDate(dateStr) {
  if (!dateStr) return { formatted: '—', dayName: '', raw: '' }
  try {
    const parts = dateStr.split('-').map(Number)
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2])
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' })
      const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' })
      return {
        formatted: `${String(parts[2]).padStart(2, '0')} ${monthName} ${parts[0]}`,
        dayName,
        raw: dateStr
      }
    }
  } catch {}
  return { formatted: dateStr, dayName: '', raw: dateStr }
}

function formatWorkingHours(record) {
  const raw = record?.net_working_hours || record?.working_hours
  if (!raw || raw === '-') return '—'
  const parts = String(raw).split(':')
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10) || 0
    const m = parseInt(parts[1], 10) || 0
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  return raw
}

function isFullShift(record) {
  const raw = record?.net_working_hours || record?.working_hours
  if (!raw) return false
  const parts = String(raw).split(':').map(Number)
  const secs = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
  return secs >= 27000 // 7.5 hours
}

export default function EmpAttendance() {
  const { user } = useAuth()
  const isViyana = user?.company_slug === 'viyana'
  const [page, setPage] = useState(1)

  // ----- RTK Query Hook -----
  const { data: attendanceRes, isFetching: loading, refetch: load } = useGetAttendanceQuery({
    page,
    per_page: PER_PAGE
  })

  const d = attendanceRes?.data
  const records = d?.records || d || []
  const pagination = d?.pagination || null
  const totalPages = pagination ? Math.ceil(pagination.total / PER_PAGE) : 1
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      {/* ─── MINIMAL EXECUTIVE TOOLBAR ─── */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-white/[0.08] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs backdrop-blur-sm">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
            My Attendance Log
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Biometric punches, shift hours, break sessions, and attendance statuses.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 font-mono tracking-tight">
            {pagination ? `${pagination.total} Records` : `${records.length} Records`}
          </span>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => load()}
            title="Refresh attendance records"
            style={{ padding: '7px 14px', borderRadius: 10, fontSize: 13, gap: 6 }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin-fast' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ─── CLEAN MINIMAL TABLE CARD ─── */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-white/[0.08] rounded-2xl shadow-xs overflow-hidden backdrop-blur-sm">
        {loading && records.length === 0 ? (
          <div className="loading-container" style={{ minHeight: 300 }}><div className="spinner" /></div>
        ) : records.length === 0 ? (
          <div className="table-empty py-16 text-center">
            <Calendar size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No attendance records found.</p>
          </div>
        ) : (
          <div className="table-container overflow-x-auto">
            <table className="w-full text-left border-collapse" style={{ minWidth: 1050 }}>
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-white/[0.06]">
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ width: 140 }}>
                    Date
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ width: 110 }}>
                    Check In
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ width: 110 }}>
                    Check Out
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ width: 125 }}>
                    Working Hours
                  </th>
                  {!isViyana && (
                    <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ minWidth: 220 }}>
                      Breaks
                    </th>
                  )}
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" style={{ minWidth: 240 }}>
                    Task Update
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center" style={{ width: 140 }}>
                    Status
                  </th>
                  <th className="py-3.5 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center" style={{ width: 100 }}>
                    Mode
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {records.map(r => {
                  const dateInfo = formatDate(r.date)
                  const isTodayActive = r.date === todayStr && r.check_in && !r.check_out
                  const fullShift = isFullShift(r)
                  const status = (r.status || 'present').toLowerCase()
                  const isLate = (status === 'late' || status === 'present') && r.late_minutes > 0

                  return (
                    <tr 
                      key={r.id} 
                      className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors duration-150"
                    >
                      {/* Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-[13px]">
                            {dateInfo.formatted}
                          </span>
                          {dateInfo.dayName && (
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-700/50">
                              {dateInfo.dayName}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Check In */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {r.check_in ? (
                          <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 tracking-tight">
                            {fmtTime(r.check_in)}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Check Out */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {r.check_out ? (
                          <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 tracking-tight">
                            {fmtTime(r.check_out)}
                          </span>
                        ) : isTodayActive ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Working Hours */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {r.working_hours && r.working_hours !== '-' ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`font-mono text-xs font-bold ${
                              fullShift 
                                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20' 
                                : 'text-slate-800 dark:text-slate-200'
                            }`}>
                              {formatWorkingHours(r)}
                            </span>
                            {fullShift && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" title="Shift target completed (8.5h)" />
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Breaks (Minimal, User-friendly pill cards) */}
                      {!isViyana && (
                        <td className="py-3.5 px-4">
                          {Array.isArray(r.breaks) && r.breaks.length > 0 ? (
                            <div className="flex flex-col gap-1.5">
                              {r.breaks.map((b, i) => {
                                const type = (b.break_type || 'break').toLowerCase()
                                const label = type === 'lunch' ? 'Lunch' : type === 'evening' ? 'Evening' : type === 'tea' ? 'Tea' : 'Break'
                                const sTime = fmtTime(b.started_at)
                                const eTime = b.ended_at ? fmtTime(b.ended_at) : (b.status === 'active' ? 'Active' : '')
                                const isLunch = type === 'lunch'

                                return (
                                  <div
                                    key={i}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 text-[11px] font-medium text-slate-700 dark:text-slate-300 w-fit shadow-2xs"
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${isLunch ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.6)]'}`} />
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{label}:</span>
                                    <span className="font-mono text-slate-600 dark:text-slate-400 tracking-tight">
                                      {sTime}{eTime ? ` – ${eTime}` : ''}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      )}

                      {/* Task Update */}
                      <td className="py-3.5 px-4" style={{ maxWidth: 280 }}>
                        {r.daily_task_update ? (
                          <div 
                            className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50/70 dark:bg-slate-800/40 px-2.5 py-1.5 rounded-lg border border-slate-200/60 dark:border-slate-700/50 line-clamp-2 leading-relaxed" 
                            title={r.daily_task_update}
                          >
                            {r.daily_task_update}
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        {isLate ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25">
                              Late
                            </span>
                            <span className="text-[10px] font-mono font-bold text-amber-600/90 dark:text-amber-400/90 mt-0.5">
                              +{r.late_minutes}m
                            </span>
                          </div>
                        ) : status === 'requires_review' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/25">
                            Requires Review
                          </span>
                        ) : status === 'present' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                            Present
                          </span>
                        ) : status === 'absent' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/25">
                            Absent
                          </span>
                        ) : status === 'half_day' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/25">
                            Half Day
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 capitalize">
                            {status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>

                      {/* Mode */}
                      <td className="py-3.5 px-4 text-center">
                        {r.mode === 'wfh' ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                            <Home size={11} className="text-indigo-500 dark:text-indigo-400" /> Remote
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/70 px-2.5 py-0.5 rounded-full border border-slate-200/70 dark:border-slate-700/60">
                            <Building2 size={11} className="text-slate-400 dark:text-slate-400" /> Office
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200/80 dark:border-white/[0.06] bg-slate-50/60 dark:bg-slate-950/40">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Page <strong className="text-slate-800 dark:text-slate-200">{page}</strong> of <strong className="text-slate-800 dark:text-slate-200">{totalPages}</strong> &nbsp;·&nbsp; {pagination.total} records total
                </span>
                <div className="flex items-center gap-1.5">
                  <button 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => setPage(1)} 
                    disabled={page === 1} 
                    aria-label="First page"
                    style={{ padding: '4px 8px', borderRadius: 7 }}
                  >
                    «
                  </button>
                  <button 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => setPage(page - 1)} 
                    disabled={page === 1} 
                    aria-label="Previous page"
                    style={{ padding: '4px 8px', borderRadius: 7 }}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 px-2">
                    {page}
                  </span>
                  <button 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => setPage(page + 1)} 
                    disabled={page >= totalPages} 
                    aria-label="Next page"
                    style={{ padding: '4px 8px', borderRadius: 7 }}
                  >
                    <ChevronRight size={13} />
                  </button>
                  <button 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => setPage(totalPages)} 
                    disabled={page >= totalPages} 
                    aria-label="Last page"
                    style={{ padding: '4px 8px', borderRadius: 7 }}
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
