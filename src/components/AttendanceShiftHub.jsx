import React, { useState, useMemo, useEffect } from 'react'
import {
  Clock3, Hourglass, Zap, Coffee, CalendarDays, Calendar,
  ChevronRight, BarChart2, PieChart, Play, ArrowRight, CheckCircle2
} from 'lucide-react'

function formatTimer(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return [hours, minutes, remainingSeconds].map(v => String(v).padStart(2, '0')).join(':')
}

/**
 * AttendanceShiftHub
 * 
 * Unified Attendance & Shift Performance Command Center.
 * Combines clock-in/out controls, live productive work timer, 
 * radial activity rings, 7-day attendance trends, and key shift metrics
 * into a single, cohesive White & Blue enterprise experience.
 */
export default function AttendanceShiftHub({
  today = {},
  fmtTime = (t) => t,
  isWfh = false,
  isViyana = false,
  workingHours = '00:00:00',
  liveNetSecs = 0,
  shiftProgressPercent = 0,
  shiftTargetSecs = 27000, // 7.5 hours
  estCheckoutTime = null,
  activeBreak = false,
  timerPaused: externalTimerPaused = false,
  manualBreakSecs = 0,
  pendingLeaves = 0,
  upcomingHolidays = [],
  recentAttendance = [],
  prepareCheckin = () => {},
  checkingIn = false,
  setShowCheckoutModal = () => {},
  checkingOut = false,
  setShowBreakModal = () => {},
  setBreakMinutes = () => {},
  setBreakReason = () => {},
  requestingBreak = false,
  onEndBreak = () => {},
  endingBreak = false,
  navigate = () => {},
}) {
  const [activeTab, setActiveTab] = useState('gauge') // 'gauge' | 'trend'

  const isCheckedIn = Boolean(today?.check_in)
  const isCheckedOut = Boolean(today?.check_out)
  const isActiveShift = isCheckedIn && !isCheckedOut
  const timerPaused = activeBreak || externalTimerPaused

  const shiftProgressRatio = isCheckedIn ? Math.min(1, Math.max(0.02, liveNetSecs / shiftTargetSecs)) : 0
  const remainingSecs = Math.max(0, shiftTargetSecs - liveNetSecs)
  const remainingFormatted = formatTimer(remainingSecs)

  const totalTrackedSecs = liveNetSecs + (manualBreakSecs || 0)
  const focusRatio = totalTrackedSecs > 0 ? Math.min(1, Math.max(0.1, liveNetSecs / totalTrackedSecs)) : 1
  const focusPercent = Math.round(focusRatio * 100)

  // SVG Geometry for Radial Activity Ring Gauge
  // Outer Ring: Shift Hours Worked (Royal Blue #2563eb)
  const r1 = 96
  const c1 = 2 * Math.PI * r1 // ~603.185
  const offset1 = c1 * (1 - shiftProgressRatio)

  // Inner Ring: Active Focus Ratio (Sky Blue #0ea5e9)
  const r2 = 78
  const c2 = 2 * Math.PI * r2 // ~490.088
  const offset2 = c2 * (1 - (timerPaused ? 0.35 : focusRatio))

  // 7-Day Attendance Trend Calculation
  const weekData = useMemo(() => {
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
      const isToday = i === 0

      let secs = 0
      if (isToday) {
        secs = liveNetSecs
      } else if (Array.isArray(recentAttendance)) {
        const match = recentAttendance.find(r => r.date === dateStr)
        if (match) {
          if (match.productive_seconds) {
            secs = Number(match.productive_seconds)
          } else if (match.working_hours || match.net_working_hours) {
            const parts = String(match.working_hours || match.net_working_hours).split(':').map(Number)
            if (parts.length >= 2) {
              secs = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
            }
          }
        }
      }

      const hours = Number((secs / 3600).toFixed(1))
      const pct = Math.min(100, Math.round((secs / shiftTargetSecs) * 100))
      days.push({ dateStr, dayName, isToday, secs, hours, pct })
    }
    return days
  }, [recentAttendance, liveNetSecs, shiftTargetSecs])

  const upcomingHolidaysCount = Array.isArray(upcomingHolidays) ? upcomingHolidays.length : 0

  return (
    <section className="w-full bg-white dark:bg-[#0e1422] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden transition-all self-card-surface">
      
      {/* ─── TWO-PANEL BALANCED BODY ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 relative z-10 items-stretch">
        
        {/* LEFT PANEL: Live Shift Timer, Progress, Controls & 3 Metric Tiles (7 cols) */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-4">
          
          {/* Main Work Timer Hero Card */}
          <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 rounded-xl p-5 sm:p-6 relative overflow-hidden transition-all duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                {isActiveShift && (
                  <span className={`w-2 h-2 rounded-full ${activeBreak ? 'bg-amber-500' : 'bg-blue-600'} ${!timerPaused ? 'animate-pulse' : ''} flex-shrink-0`} title={activeBreak ? 'Break Session Active' : 'Active Working Session'} />
                )}
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {timerPaused ? 'Productive Work Time (Paused)' : 'Productive Work Time'}
                </span>
              </div>

              {isActiveShift && (
                <div className="flex items-center gap-2">
                  {activeBreak && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold text-xs border border-amber-500/20 uppercase tracking-wider">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      </span>
                      ON BREAK
                    </span>
                  )}
                  {externalTimerPaused && !activeBreak && <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20 font-bold text-xs border uppercase tracking-wider">PAUSED BY HR</span>}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-mono text-xs font-semibold border border-blue-200/60 dark:border-blue-900/50">
                    <span>{shiftProgressPercent}%</span>
                    <span className="text-slate-400 dark:text-slate-500 font-normal">of 7.5h shift</span>
                  </div>
                </div>
              )}
            </div>

            {/* Big Live Digital Clock */}
            <div className="my-1 flex items-baseline gap-3 flex-wrap">
              <div className={`text-4xl sm:text-5xl font-mono font-bold tracking-tight tabular-nums transition-colors duration-200 ${
                externalTimerPaused
                  ? 'text-rose-600 dark:text-rose-400'
                  : activeBreak
                  ? 'text-amber-600 dark:text-amber-400' 
                  : 'text-slate-900 dark:text-white'
              }`}>
                {workingHours}
              </div>
              {timerPaused && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${systemPause ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'} border tracking-wider uppercase font-mono`}>
                  {externalTimerPaused ? 'PAUSED BY HR' : 'PAUSED'}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {timerPaused
                ? 'Your workday timer is paused by HR.'
                : isActiveShift
                  ? `${remainingFormatted} remaining until your 7.5-hour standard shift target.`
                  : isCheckedOut
                    ? 'Your attendance has been finalized for today. Thank you for your work!'
                    : 'Clock in to activate your productive workday timer and biometric log.'}
            </p>

            {/* Linear Progress Bar */}
            {isActiveShift && (
              <div className="w-full bg-slate-200/80 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-4 relative">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    externalTimerPaused
                      ? 'bg-rose-500'
                      : activeBreak
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, shiftProgressPercent))}%` }}
                />
              </div>
            )}
          </div>

          {/* ACTIVE BREAK INLINE COMMAND BANNER */}
          {!isViyana && activeBreak && (
            <div className="w-full bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-all">
              <div className="flex items-center gap-3 relative z-10">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                  <Coffee size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Break in Progress</span>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                    Productive timer paused · Resume when you're back at your workstation
                  </span>
                </div>
              </div>

              {/* Minimal, Sleek, Aesthetic End-Break Action Button */}
              <button
                type="button"
                onClick={onEndBreak}
                disabled={endingBreak}
                className="inline-flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm px-4 py-2 rounded-xl transition-colors cursor-pointer flex-shrink-0"
              >
                <Play size={11} fill="white" className="text-white ml-0.5" />
                <span>{endingBreak ? 'Resuming shift...' : 'End Break & Resume Work'}</span>
              </button>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="flex items-center gap-3 flex-wrap mt-4">
            {!isCheckedIn && (
              <button
                type="button"
                onClick={prepareCheckin}
                disabled={checkingIn}
                className="inline-flex items-center gap-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-xs transition-all cursor-pointer relative"
              >
                <Play size={16} fill="currentColor" />
                <span className="tracking-wide">{checkingIn ? 'Clocking in...' : 'Clock In Now'}</span>
              </button>
            )}

            {isActiveShift && (
              <button
                type="button"
                onClick={() => setShowCheckoutModal(true)}
                disabled={checkingOut}
                className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-xs transition-all cursor-pointer relative"
              >
                <span className="tracking-wide">{checkingOut ? 'Checking out...' : 'Check Out'}</span>
                <ArrowRight size={18} className="stroke-[2.5] transition-transform duration-200 group-hover:translate-x-1" />
              </button>
            )}

            {isCheckedOut && (
              <div className="inline-flex items-center gap-2 bg-slate-100/90 dark:bg-white/5 text-slate-700 dark:text-slate-200 font-bold text-sm px-5 py-2.5 rounded-xl border border-slate-200/90 dark:border-white/10 relative">
                <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                <span className="tracking-wide">Shift Completed</span>
              </div>
            )}

            {/* If on break (for Viyana where banner is hidden): Minimal End Break in toolbar */}
            {isActiveShift && isViyana && activeBreak && (
              <button
                type="button"
                onClick={onEndBreak}
                disabled={endingBreak}
                className="inline-flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 active:scale-98 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                <Play size={13} fill="currentColor" />
                <span>{endingBreak ? 'Resuming...' : 'End Break'}</span>
              </button>
            )}

            {isActiveShift && !isViyana && !activeBreak && !externalTimerPaused && (
              <button
                type="button"
                onClick={() => {
                  setBreakMinutes(15)
                  setBreakReason('')
                  setShowBreakModal(true)
                }}
                disabled={requestingBreak}
                className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-200/80 dark:border-blue-500/20 font-bold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                <Coffee size={15} />
                <span>Take a Break</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => navigate('/attendance')}
              className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-bold text-xs sm:text-sm px-3 py-2 rounded-lg transition-colors ml-auto cursor-pointer"
            >
              <span>View Full Timesheet</span>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* 3 User-Friendly Metric Tiles */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            
            {/* Tile 1: Worked */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                <Clock3 size={13} />
                <span>Worked</span>
              </div>
              <div className="text-sm sm:text-base font-mono font-bold text-slate-900 dark:text-white truncate">
                {workingHours}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                {shiftProgressPercent}% of 7.5h
              </span>
            </div>

            {/* Tile 2: Remaining */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                <Hourglass size={13} />
                <span>Time Left</span>
              </div>
              <div className="text-sm sm:text-base font-mono font-bold text-slate-900 dark:text-white truncate">
                {remainingFormatted}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                To 7.5 Hours
              </span>
            </div>

            {/* Tile 3: Focus */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-1">
                <Zap size={13} />
                <span>Focus</span>
              </div>
              <div className="text-sm sm:text-base font-mono font-bold text-slate-900 dark:text-white truncate">
                {focusPercent}%
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5 truncate">
                {manualBreakSecs > 0 ? `${Math.round(manualBreakSecs / 60)}m Break` : '100% Active'}
              </span>
            </div>

          </div>

        </div>

        {/* RIGHT PANEL: Graphical Visualizer & Quick Links (5 cols) */}
        <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          
          {/* Subheader with Visualizer Switcher */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {activeTab === 'gauge' ? 'Shift Ring Gauge' : '7-Day Trend'}
              </span>
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 font-mono">
                {activeTab === 'gauge' ? `${shiftProgressPercent}% Completed` : 'Past 7 Days'}
              </span>
            </div>

            {/* Segmented Switcher */}
            <div className="inline-flex items-center bg-white dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs">
              <button
                type="button"
                onClick={() => setActiveTab('gauge')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'gauge'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <PieChart size={12} />
                <span>Shift Ring</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trend')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'trend'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <BarChart2 size={12} />
                <span>7-Day Trend</span>
              </button>
            </div>
          </div>

          {/* VISUALIZER VIEW 1: RADIAL RING GAUGE */}
          {activeTab === 'gauge' && (
            <div className="flex flex-col items-center justify-center my-auto py-2">
              
              {/* Circular SVG Rings */}
              <div className="relative w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center select-none">
                <svg 
                  viewBox="0 0 240 240" 
                  className="w-full h-full transform -rotate-90 drop-shadow-xs"
                >
                  {/* Outer Track (Royal Blue background) */}
                  <circle
                    cx="120"
                    cy="120"
                    r={r1}
                    stroke="rgba(37, 99, 235, 0.12)"
                    strokeWidth="13"
                    fill="none"
                  />
                  {/* Inner Track (Sky Blue background) */}
                  <circle
                    cx="120"
                    cy="120"
                    r={r2}
                    stroke="rgba(14, 165, 233, 0.12)"
                    strokeWidth="10"
                    fill="none"
                  />

                  {/* Outer Progress Arc: Shift Target Progress */}
                  <circle
                    cx="120"
                    cy="120"
                    r={r1}
                    stroke="#2563eb"
                    strokeWidth="13"
                    fill="none"
                    strokeDasharray={c1}
                    strokeDashoffset={offset1}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                  />

                  {/* Inner Progress Arc: Active Focus Ratio */}
                  <circle
                    cx="120"
                    cy="120"
                    r={r2}
                    stroke="#0ea5e9"
                    strokeWidth="10"
                    fill="none"
                    strokeDasharray={c2}
                    strokeDashoffset={offset2}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>

                {/* Center Content of Ring: Clear Pacing Display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 pointer-events-none">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Shift Pacing
                  </span>
                  <div className="text-3xl sm:text-4xl font-mono font-extrabold text-slate-900 dark:text-white tracking-tight leading-none my-1">
                    {shiftProgressPercent}%
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    of 7.5h Goal
                  </span>
                  {estCheckoutTime && (
                    <span className="inline-block text-[10px] text-blue-700 dark:text-blue-300 font-mono font-semibold px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 rounded-md border border-blue-100 dark:border-blue-500/20 mt-1">
                      Wrap: {estCheckoutTime}
                    </span>
                  )}
                </div>
              </div>

              {/* Color-Coded Ring Legend */}
              <div className="flex items-center justify-center gap-4 mt-3 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span className="text-slate-600 dark:text-slate-400">Shift Goal ({shiftProgressPercent}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                  <span className="text-slate-600 dark:text-slate-400">Focus ({focusPercent}%)</span>
                </div>
              </div>

            </div>
          )}

          {/* VISUALIZER VIEW 2: 7-DAY ATTENDANCE BARS */}
          {activeTab === 'trend' && (
            <div className="flex flex-col justify-center my-auto py-2">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3 px-1">
                <span className="font-semibold">Daily Worked Hours</span>
                <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 font-semibold">7.5h Goal Target</span>
              </div>

              {/* 7 Bars */}
              <div className="h-40 flex items-end justify-between gap-2 px-1 border-b border-slate-200 dark:border-slate-800 pb-2">
                {weekData.map((day, idx) => {
                  const heightPct = Math.min(100, Math.max(8, (day.hours / 8.5) * 100))
                  const isGoalMet = day.hours >= 7.5
                  
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-mono pointer-events-none whitespace-nowrap z-20 shadow-md">
                        {day.hours}h ({day.pct}%)
                      </div>

                      <span className="text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                        {day.hours > 0 ? `${day.hours}h` : '-'}
                      </span>

                      <div className="w-full max-w-[26px] bg-slate-200/70 dark:bg-white/10 rounded-t-lg overflow-hidden h-full flex items-end">
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full rounded-t-lg transition-all duration-500 ${
                            day.isToday
                              ? 'bg-blue-600 shadow-xs'
                              : isGoalMet
                                ? 'bg-sky-500'
                                : day.hours > 0
                                  ? 'bg-slate-400 dark:bg-slate-500'
                                  : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        />
                      </div>

                      <span className={`text-[11px] font-semibold tracking-tight ${
                        day.isToday ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
                      }`}>
                        {day.dayName}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between mt-2.5 text-xs text-slate-500 dark:text-slate-400 px-1">
                <span>Blue bar = Today</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  Avg: {(weekData.reduce((acc, d) => acc + d.hours, 0) / 7).toFixed(1)}h / day
                </span>
              </div>
            </div>
          )}

          {/* Quick Context Strip: Leaves & Holidays */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200/70 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => navigate('/leaves')}
              className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-semibold transition-colors cursor-pointer"
            >
              <CalendarDays size={14} className="text-blue-600 dark:text-blue-400" />
              <span>{pendingLeaves} Pending Leaves</span>
              <ChevronRight size={13} className="text-slate-400" />
            </button>

            {!isViyana && (
              <button
                type="button"
                onClick={() => navigate('/holidays')}
                className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 font-semibold transition-colors cursor-pointer"
              >
                <Calendar size={14} className="text-sky-600 dark:text-sky-400" />
                <span>{upcomingHolidaysCount} Upcoming Holidays</span>
                <ChevronRight size={13} className="text-slate-400" />
              </button>
            )}
          </div>

        </div>

      </div>

    </section>
  )
}

