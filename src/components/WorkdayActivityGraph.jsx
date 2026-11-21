import React, { useState, useMemo } from 'react'
import { Clock3, Hourglass, Zap, Coffee, CalendarDays, Calendar, ChevronRight, BarChart2, PieChart } from 'lucide-react'

function formatTimer(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return [hours, minutes, remainingSeconds].map(v => String(v).padStart(2, '0')).join(':')
}

/**
 * WorkdayActivityGraph
 * 
 * Replaces the clunky watch chassis with a dedicated, professional,
 * intuitive data visualization card. Displays a real-time Radial Shift Progress
 * Gauge and an interactive 7-Day Work Trend bar chart.
 */
export default function WorkdayActivityGraph({
  workingHours = '00:00:00',
  liveNetSecs = 0,
  shiftProgressPercent = 0,
  shiftTargetSecs = 27000, // 7.5 hours
  activeBreak = false,
  manualBreakSecs = 0,
  estCheckoutTime = null,
  pendingLeaves = 0,
  upcomingHolidays = [],
  today = {},
  recentAttendance = [],
  navigate = () => {},
  isViyana = false,
}) {
  const [activeTab, setActiveTab] = useState('gauge') // 'gauge' | 'trend'

  const isCheckedIn = Boolean(today?.check_in)
  const shiftProgressRatio = isCheckedIn ? Math.min(1, Math.max(0.02, liveNetSecs / shiftTargetSecs)) : 0
  const remainingSecs = Math.max(0, shiftTargetSecs - liveNetSecs)
  const remainingFormatted = formatTimer(remainingSecs)
  
  const totalTrackedSecs = liveNetSecs + (manualBreakSecs || 0)
  const focusRatio = totalTrackedSecs > 0 ? Math.min(1, Math.max(0.1, liveNetSecs / totalTrackedSecs)) : 1
  const focusPercent = Math.round(focusRatio * 100)

  // SVG Geometry for Radial Gauge
  // Outer Ring: Shift Hours Worked (Coral Orange #f97316)
  const r1 = 88
  const c1 = 2 * Math.PI * r1 // ~552.92
  const offset1 = c1 * (1 - shiftProgressRatio)

  // Inner Ring: Active Focus Ratio (Emerald Green #10b981)
  const r2 = 72
  const c2 = 2 * Math.PI * r2 // ~452.39
  const offset2 = c2 * (1 - (activeBreak ? 0.35 : focusRatio))

  // 7-Day Work Trend Calculation
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
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-5 h-full transition-all">
      
      {/* ─── CARD HEADER & VIEW SELECTOR ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Shift Activity & Pacing
            </h3>
          </div>
          <span className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
            {activeTab === 'gauge' ? "Today's Work Progress" : '7-Day Attendance Trend'}
          </span>
        </div>

        {/* View Toggle Tabs */}
        <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => setActiveTab('gauge')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'gauge'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <PieChart size={13} />
            <span>Radial Gauge</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trend')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'trend'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <BarChart2 size={13} />
            <span>Weekly Bars</span>
          </button>
        </div>
      </div>

      {/* ─── TAB 1: RADIAL ACTIVITY GAUGE ─── */}
      {activeTab === 'gauge' && (
        <div className="flex flex-col items-center justify-center my-auto">
          
          {/* Circular SVG Gauge with Center Metrics */}
          <div className="relative w-56 h-56 sm:w-60 sm:h-60 flex items-center justify-center select-none">
            <svg 
              viewBox="0 0 220 220" 
              className="w-full h-full transform -rotate-90 drop-shadow-xs"
            >
              {/* Outer Track (Muted Orange Background) */}
              <circle
                cx="110"
                cy="110"
                r={r1}
                stroke="rgba(37, 99, 235, 0.12)"
                strokeWidth="13"
                fill="none"
              />
              {/* Inner Track (Muted Green Background) */}
              <circle
                cx="110"
                cy="110"
                r={r2}
                stroke="rgba(14, 165, 233, 0.12)"
                strokeWidth="10"
                fill="none"
              />

              {/* Outer Progress Arc: Shift Hours Worked */}
              <circle
                cx="110"
                cy="110"
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
                cx="110"
                cy="110"
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

            {/* Center Content: Clear, Prominent, Live Numbers */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">
                Net Work Time
              </span>
              <div className="text-3xl sm:text-4xl font-mono font-extrabold text-slate-900 dark:text-white tracking-tight tabular-nums">
                {workingHours}
              </div>
              
              <div className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold text-xs font-mono">
                <span>{shiftProgressPercent}%</span>
                <span className="text-slate-400 dark:text-slate-500 font-normal">of 7.5h</span>
              </div>

              {estCheckoutTime && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  Est. Wrap-up: {estCheckoutTime}
                </span>
              )}
            </div>
          </div>

          {/* Color-Coded Ring Legend */}
          <div className="flex items-center justify-center gap-5 mt-2 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              <span className="text-slate-600 dark:text-slate-400">Shift Target ({shiftProgressPercent}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              <span className="text-slate-600 dark:text-slate-400">Focus ({focusPercent}%)</span>
            </div>
          </div>

        </div>
      )}

      {/* ─── TAB 2: 7-DAY ATTENDANCE TREND BARS ─── */}
      {activeTab === 'trend' && (
        <div className="flex flex-col justify-center my-auto py-2">
          
          {/* Target Line Legend */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-4 px-1">
            <span className="font-semibold">Daily Worked Hours</span>
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 bg-dashed border-b-2 border-dashed border-indigo-400" />
              <span className="text-[11px] font-mono">7.5h Goal Line</span>
            </div>
          </div>

          {/* 7 Vertical Bars */}
          <div className="h-44 flex items-end justify-between gap-2 sm:gap-3 px-1 border-b border-slate-200 dark:border-slate-800 pb-2">
            {weekData.map((day, idx) => {
              const heightPct = Math.min(100, Math.max(8, (day.hours / 8.5) * 100))
              const isGoalMet = day.hours >= 7.5
              
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
                  
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-mono pointer-events-none whitespace-nowrap z-20 shadow-md">
                    {day.hours}h ({day.pct}%)
                  </div>

                  {/* Hours text above bar */}
                  <span className="text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                    {day.hours > 0 ? `${day.hours}h` : '-'}
                  </span>

                  {/* Bar */}
                  <div className="w-full max-w-[28px] bg-slate-100 dark:bg-slate-800 rounded-t-lg overflow-hidden h-full flex items-end">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-lg transition-all duration-500 ${
                        day.isToday
                          ? 'bg-orange-500 shadow-xs'
                          : isGoalMet
                            ? 'bg-emerald-500'
                            : day.hours > 0
                              ? 'bg-indigo-500'
                              : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    />
                  </div>

                  {/* Day label */}
                  <span className={`text-[11px] font-semibold tracking-tight ${
                    day.isToday ? 'text-orange-500 font-bold' : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    {day.dayName}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Blue bar = Today's Live Time</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
              Avg: {(weekData.reduce((acc, d) => acc + d.hours, 0) / 7).toFixed(1)}h / day
            </span>
          </div>

        </div>
      )}

      {/* ─── 3 USER-FRIENDLY METRIC SUMMARY TILES ─── */}
      <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
        
        {/* Metric 1: Today's Shift */}
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 text-center border border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 mb-0.5">
            <Clock3 size={11} />
            <span>Worked</span>
          </div>
          <div className="text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
            {workingHours}
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-tight">
            {shiftProgressPercent}% Goal
          </span>
        </div>

        {/* Metric 2: Remaining */}
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 text-center border border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">
            <Hourglass size={11} />
            <span>Time Left</span>
          </div>
          <div className="text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
            {remainingFormatted}
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-tight">
            To 7.5 Hours
          </span>
        </div>

        {/* Metric 3: Active Focus */}
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 text-center border border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 mb-0.5">
            <Zap size={11} />
            <span>Focus</span>
          </div>
          <div className="text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
            {focusPercent}%
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-tight">
            {manualBreakSecs > 0 ? `${Math.round(manualBreakSecs / 60)}m Break` : '100% Active'}
          </span>
        </div>

      </div>

      {/* ─── QUICK-LINK CONTEXT STRIP (Leaves & Holidays) ─── */}
      <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
        <button
          type="button"
          onClick={() => navigate('/leaves')}
          className="inline-flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors cursor-pointer"
        >
          <CalendarDays size={14} className="text-indigo-500" />
          <span>{pendingLeaves} Pending Leaves</span>
          <ChevronRight size={13} className="text-slate-300 dark:text-slate-600" />
        </button>

        {!isViyana && (
          <button
            type="button"
            onClick={() => navigate('/holidays')}
            className="inline-flex items-center gap-1.5 hover:text-rose-600 dark:hover:text-rose-400 font-medium transition-colors cursor-pointer"
          >
            <Calendar size={14} className="text-rose-500" />
            <span>{upcomingHolidaysCount} Holidays</span>
            <ChevronRight size={13} className="text-slate-300 dark:text-slate-600" />
          </button>
        )}
      </div>

    </div>
  )
}

