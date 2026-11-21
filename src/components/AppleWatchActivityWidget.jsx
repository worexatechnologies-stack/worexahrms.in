import React, { useState } from 'react'
import { Clock3, CalendarDays, Calendar, ChevronRight, CheckCircle2, ArrowRight } from 'lucide-react'

/**
 * AppleWatchActivityWidget
 * 
 * Recreates the Apple Watch Concentric Activity Rings interface from Image 2
 * while synchronizing in real time with website attendance data (working hours,
 * shift progress, active productivity ratio, pending leaves, upcoming holidays).
 */
export default function AppleWatchActivityWidget({
  workingHours = '00:00:00',
  liveNetSecs = 0,
  shiftProgressPercent = 0,
  shiftTargetSecs = 27000, // 7.5 hours
  activeBreak = false,
  manualBreakSecs = 0,
  pendingLeaves = 0,
  upcomingHolidays = [],
  today = {},
  liveClock = new Date(),
  navigate = () => {},
  isViyana = false,
}) {
  const [activePage, setActivePage] = useState(0) // 0: Rings Watch Face, 1: Shift Hours, 2: Leaves, 3: Holidays
  const [showLiveMetricLabels, setShowLiveMetricLabels] = useState(false)

  // Live formatted watch digital clock (e.g. 11:04)
  const timeFormatted = liveClock
    ? liveClock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '11:04'

  // Geometry calculations for concentric rings (viewBox 220 x 220, center 110, 110)
  // Outer Ring: SURVIVOR (Orange #FF5500) -> Net Working Hours vs 7.5h shift
  const r1 = 82
  const c1 = 2 * Math.PI * r1 // ~515.22
  const isCheckedIn = Boolean(today?.check_in)
  
  // Outer Ring Ratio: If checked in, liveNetSecs / shiftTargetSecs; default baseline looks alive & matches Image 2 (~68%)
  const survivorRatio = isCheckedIn
    ? Math.min(1, Math.max(0.06, liveNetSecs / shiftTargetSecs))
    : 0.68
  const survivorOffset = c1 * (1 - survivorRatio)

  // Middle Ring: AGILITY (Neon Green #22C55E) -> Active Shift Focus (Attendance vs Breaks)
  const r2 = 62
  const c2 = 2 * Math.PI * r2 // ~389.55
  const agilityRatio = activeBreak
    ? 0.28
    : (isCheckedIn ? (liveNetSecs > 0 ? Math.min(1, Math.max(0.25, liveNetSecs / (liveNetSecs + (manualBreakSecs || 0)))) : 0.40) : 0.42)
  const agilityOffset = c2 * (1 - agilityRatio)

  // Inner Ring: POWER (Electric Blue #00B0FF) -> Overall Shift Target Progress
  const r3 = 42
  const c3 = 2 * Math.PI * r3 // ~263.89
  const powerRatio = isCheckedIn
    ? Math.min(1, Math.max(0.10, shiftProgressPercent / 100))
    : 0.48
  const powerOffset = c3 * (1 - powerRatio)

  const upcomingHolidaysCount = Array.isArray(upcomingHolidays) ? upcomingHolidays.length : 0
  const nextHoliday = upcomingHolidaysCount > 0 ? upcomingHolidays[0] : null

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ─── APPLE WATCH HARDWARE CHASSIS ─── */}
      <div className="relative mx-auto w-full max-w-[310px] select-none">
        
        {/* Hardware Crown (Top Right) */}
        <div 
          aria-hidden="true"
          className="absolute -right-3 top-12 w-3.5 h-11 rounded-r-md bg-gradient-to-r from-slate-400 via-slate-200 to-slate-400 dark:from-slate-600 dark:via-slate-400 dark:to-slate-700 shadow-md border border-slate-400/40 dark:border-slate-500/40 flex flex-col justify-between py-1 z-0 pointer-events-none"
        >
          <div className="w-full h-0.5 bg-slate-500/30 dark:bg-slate-700/50" />
          <div className="w-full h-0.5 bg-slate-500/30 dark:bg-slate-700/50" />
          <div className="w-full h-0.5 bg-slate-500/30 dark:bg-slate-700/50" />
          <div className="w-full h-0.5 bg-slate-500/30 dark:bg-slate-700/50" />
          <div className="w-full h-0.5 bg-slate-500/30 dark:bg-slate-700/50" />
        </div>

        {/* Hardware Side Button (Lower Right) */}
        <div 
          aria-hidden="true"
          className="absolute -right-1.5 bottom-14 w-2 h-13 rounded-r-sm bg-gradient-to-r from-slate-400 via-slate-200 to-slate-300 dark:from-slate-600 dark:via-slate-500 dark:to-slate-700 shadow-sm border border-slate-400/40 dark:border-slate-600/40 z-0 pointer-events-none"
        />

        {/* Watch Outer Shell / Bezel */}
        <div className="relative z-10 bg-gradient-to-b from-slate-100 via-slate-200 to-slate-300 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900 p-3 sm:p-3.5 rounded-[44px] shadow-2xl border-2 border-slate-300/80 dark:border-slate-600/60 ring-1 ring-black/5 dark:ring-white/10">
          
          {/* Watch Display (Pure Black OLED Screen) */}
          <div className="bg-black rounded-[34px] p-4 pt-3.5 pb-3 flex flex-col justify-between aspect-square w-full relative overflow-hidden shadow-inner border border-white/10 text-white">
            
            {/* ─── WATCH STATUS BAR ─── */}
            <div className="flex items-center justify-between z-10 mb-1">
              <button
                type="button"
                onClick={() => {
                  if (activePage === 0) {
                    setShowLiveMetricLabels(prev => !prev)
                  } else {
                    setActivePage(0)
                  }
                }}
                className="text-[#FF5722] hover:text-[#ff7043] transition-colors flex items-center gap-0.5 font-semibold text-xs tracking-tight group cursor-pointer"
                title="Click to toggle labels"
              >
                <span>&lt;Skills</span>
              </button>

              <span className="text-white/90 font-mono text-xs font-semibold tracking-tight">
                {timeFormatted}
              </span>
            </div>

            {/* ─── SCREEN BODY BY ACTIVE PAGE ─── */}
            <div className="flex-1 flex items-center justify-center relative">
              {activePage === 0 && (
                /* PAGE 0: EXACT IMAGE 2 CONCENTRIC ACTIVITY RINGS */
                <div 
                  className="relative w-full h-full flex items-center justify-center cursor-pointer group"
                  onClick={() => setShowLiveMetricLabels(prev => !prev)}
                  title="Click to toggle metric values"
                >
                  <svg 
                    viewBox="0 0 220 220" 
                    className="w-full h-full max-w-[215px] max-h-[215px] transform transition-transform duration-500 group-hover:scale-[1.02]"
                  >
                    {/* Dark Background Tracks */}
                    {/* Outer Track (Orange) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r1}
                      stroke="rgba(255, 87, 34, 0.22)"
                      strokeWidth="16"
                      fill="none"
                    />
                    {/* Middle Track (Green) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r2}
                      stroke="rgba(34, 197, 94, 0.22)"
                      strokeWidth="16"
                      fill="none"
                    />
                    {/* Inner Track (Blue) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r3}
                      stroke="rgba(0, 176, 255, 0.22)"
                      strokeWidth="16"
                      fill="none"
                    />

                    {/* Concentric Progress Arcs (Clockwise from 12 o'clock) */}
                    {/* Outer Ring: SURVIVOR (Coral Orange) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r1}
                      stroke="#FF5722"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={c1}
                      strokeDashoffset={survivorOffset}
                      strokeLinecap="round"
                      transform="rotate(-90 110 110)"
                      className="transition-all duration-700 ease-out"
                    />

                    {/* Middle Ring: AGILITY (Neon Green) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r2}
                      stroke="#22C55E"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={c2}
                      strokeDashoffset={agilityOffset}
                      strokeLinecap="round"
                      transform="rotate(-90 110 110)"
                      className="transition-all duration-700 ease-out"
                    />

                    {/* Inner Ring: POWER (Sky Blue) */}
                    <circle
                      cx="110"
                      cy="110"
                      r={r3}
                      stroke="#00B0FF"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={c3}
                      strokeDashoffset={powerOffset}
                      strokeLinecap="round"
                      transform="rotate(-90 110 110)"
                      className="transition-all duration-700 ease-out"
                    />

                    {/* Center Black Circle Hole */}
                    <circle
                      cx="110"
                      cy="110"
                      r="26"
                      fill="#000000"
                    />

                    {/* Text Labels inside the Top-Left Quadrant */}
                    {/* Staggered along the dark bands exactly as shown in Image 2 */}
                    <text
                      x="36"
                      y="52"
                      fill="#FF5722"
                      fontSize="11"
                      fontWeight="800"
                      letterSpacing="0.05em"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {showLiveMetricLabels ? workingHours.slice(0, 5) : 'SURVIVOR'}
                    </text>

                    <text
                      x="49"
                      y="67"
                      fill="#22C55E"
                      fontSize="10"
                      fontWeight="800"
                      letterSpacing="0.05em"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {showLiveMetricLabels ? (activeBreak ? 'PAUSED' : 'ACTIVE') : 'AGILITY'}
                    </text>

                    <text
                      x="53"
                      y="82"
                      fill="#00B0FF"
                      fontSize="10"
                      fontWeight="800"
                      letterSpacing="0.05em"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {showLiveMetricLabels ? `${shiftProgressPercent}%` : 'POWER'}
                    </text>
                  </svg>
                </div>
              )}

              {activePage === 1 && (
                /* PAGE 1: TODAY'S NET HOURS DIGITAL DRILLDOWN */
                <div 
                  onClick={() => navigate('/attendance')}
                  className="flex flex-col items-center justify-center text-center p-2 cursor-pointer w-full"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#FF5722] mb-1">
                    Today's Net Work
                  </span>
                  <div className="text-2xl font-mono font-extrabold text-white tracking-tight">
                    {workingHours}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Goal: 7.5 Hours · {shiftProgressPercent}% Done
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#FF5722] hover:underline">
                    <span>Timesheet</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              )}

              {activePage === 2 && (
                /* PAGE 2: PENDING LEAVES DRILLDOWN */
                <div 
                  onClick={() => navigate('/leaves')}
                  className="flex flex-col items-center justify-center text-center p-2 cursor-pointer w-full"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#22C55E] mb-1">
                    Pending Leaves
                  </span>
                  <div className="text-3xl font-extrabold text-white tracking-tight">
                    {pendingLeaves}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {pendingLeaves === 1 ? '1 Request Awaiting Review' : 'Active Leave Requests'}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E] hover:underline">
                    <span>Manage Leaves</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              )}

              {activePage === 3 && (
                /* PAGE 3: UPCOMING HOLIDAYS DRILLDOWN */
                <div 
                  onClick={() => navigate('/holidays')}
                  className="flex flex-col items-center justify-center text-center p-2 cursor-pointer w-full"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#00B0FF] mb-1">
                    Upcoming Holidays
                  </span>
                  <div className="text-3xl font-extrabold text-white tracking-tight">
                    {upcomingHolidaysCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 truncate max-w-[170px]">
                    {nextHoliday?.holiday_name || 'Scheduled Company Holidays'}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#00B0FF] hover:underline">
                    <span>Holiday Calendar</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              )}
            </div>

            {/* ─── BOTTOM 4 PAGER DOTS (MATCHING IMAGE 2) ─── */}
            <div className="flex justify-center items-center gap-1.5 pt-1 z-10">
              {[0, 1, 2, 3].map((pageIdx) => (
                <button
                  key={pageIdx}
                  type="button"
                  onClick={() => setActivePage(pageIdx)}
                  className={`rounded-full transition-all duration-300 cursor-pointer ${
                    activePage === pageIdx
                      ? 'w-1.5 h-1.5 bg-white'
                      : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/60'
                  }`}
                  aria-label={`Go to watch page ${pageIdx + 1}`}
                />
              ))}
            </div>

          </div>
        </div>
      </div>

      {/* ─── 3 CONNECTED COMPANION STAT TILES (FROM IMAGE 1) ─── */}
      {/* Retains full data visibility & one-click routing to Attendance, Leaves, Holidays */}
      <div className="grid grid-cols-1 gap-2.5 w-full">
        
        {/* Tile 1: Today's Net Hours */}
        <article
          onClick={() => navigate('/attendance')}
          className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-4 py-3 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-[#FF5722] flex items-center justify-center flex-shrink-0">
              <Clock3 size={17} />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block leading-tight">
                Today's Net Hours
              </span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white tracking-tight">
                {workingHours}
              </span>
            </div>
          </div>
          <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
        </article>

        {/* Tile 2: Pending Leaves */}
        <article
          onClick={() => navigate('/leaves')}
          className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-4 py-3 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CalendarDays size={17} />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block leading-tight">
                Pending Leaves
              </span>
              <span className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                {pendingLeaves} Requests
              </span>
            </div>
          </div>
          <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
        </article>

        {/* Tile 3: Upcoming Holidays */}
        {!isViyana && (
          <article
            onClick={() => navigate('/holidays')}
            className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-4 py-3 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
                <Calendar size={17} />
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block leading-tight">
                  Upcoming Holidays
                </span>
                <span className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                  {upcomingHolidaysCount} Scheduled
                </span>
              </div>
            </div>
            <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
          </article>
        )}

      </div>
    </div>
  )
}
