import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  useGetHolidaysQuery,
  useCreateHolidayMutation,
  useUpdateHolidayMutation,
  useDeleteHolidayMutation
} from '../../store/apiSlice'
import { useToast, useAuth } from '../../App'
import {
  CalendarDays,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Trash2,
  X,
  Sparkles,
  PartyPopper,
  Clock,
  Calendar as CalendarIcon,
  CheckCircle2,
  Info,
  CalendarCheck,
  Building
} from 'lucide-react'
import ConfirmModal from '../../components/ui/ConfirmModal'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getRelativeTime(dateStr, todayStr) {
  const target = new Date(dateStr + 'T00:00:00')
  const current = new Date(todayStr + 'T00:00:00')
  const diffTime = target - current
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return { text: 'Today', isSoon: true, isPast: false }
  if (diffDays === 1) return { text: 'Tomorrow', isSoon: true, isPast: false }
  if (diffDays > 1 && diffDays <= 7) return { text: `In ${diffDays} days`, isSoon: true, isPast: false }
  if (diffDays > 7 && diffDays <= 30) return { text: `In ${diffDays} days`, isSoon: false, isPast: false }
  if (diffDays > 30) {
    const months = Math.floor(diffDays / 30)
    return { text: `In ~${months} month${months > 1 ? 's' : ''}`, isSoon: false, isPast: false }
  }
  return { text: 'Passed', isSoon: false, isPast: true }
}

export default function HrHolidays() {
  const { user } = useAuth()
  const isHr = user?.role === 'hr'

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', date: '', description: '' })
  const [submitting, setSubmitting] = useState(false)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [hovered, setHovered] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (showModal || deleteTarget) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showModal, deleteTarget])

  // ----- RTK Query Hooks -----
  const { data: holidaysRes, isLoading: loading, refetch: load } = useGetHolidaysQuery()
  const [createHoliday] = useCreateHolidayMutation()
  const [updateHoliday] = useUpdateHolidayMutation()
  const [deleteHoliday] = useDeleteHolidayMutation()

  const rawHolidays = holidaysRes?.data || []
  const holidays = rawHolidays.map(h => {
    let dateStr = ''
    if (h.date) {
      if (typeof h.date === 'string') {
        dateStr = h.date
      } else if (h.date.$date && h.date.$date.$numberLong) {
        const ms = parseInt(h.date.$date.$numberLong, 10)
        const d = new Date(ms)
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        dateStr = `${yyyy}-${mm}-${dd}`
      } else if (h.date.$date) {
        const d = new Date(h.date.$date)
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        dateStr = `${yyyy}-${mm}-${dd}`
      }
    }
    return {
      ...h,
      title: h.title || h.name || 'Untitled Holiday',
      date: dateStr || new Date().toISOString().slice(0, 10)
    }
  })

  const openCreate = () => {
    setEditing(null)
    setForm({ title: '', date: `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`, description: '' })
    setShowModal(true)
  }
  const openEdit = (h) => {
    setEditing(h)
    setForm({ title: h.title, date: h.date, description: h.description || '' })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title || !form.date) {
      toast('Title and date required.', 'error')
      return
    }
    setSubmitting(true)
    try {
      if (editing) {
        await updateHoliday({ id: editing.id, body: form }).unwrap()
        toast('Holiday updated successfully.', 'success')
      } else {
        await createHoliday(form).unwrap()
        toast('Holiday created successfully.', 'success')
      }
      setShowModal(false)
    } catch (err) {
      toast(err.data?.message || err.message || 'Operation failed.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteHoliday(deleteTarget.id).unwrap()
      toast('Holiday deleted.', 'success')
      setDeleteTarget(null)
    } catch {
      toast('Delete failed.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  /* ── calendar helpers ── */
  const holidayMap = holidays.reduce((acc, h) => {
    acc[h.date] = h
    return acc
  }, {})

  const prevMonth = () => {
    if (calMonth === 0) {
      setCalYear(y => y - 1)
      setCalMonth(11)
    } else {
      setCalMonth(m => m - 1)
    }
  }
  const nextMonth = () => {
    if (calMonth === 11) {
      setCalYear(y => y + 1)
      setCalMonth(0)
    } else {
      setCalMonth(m => m + 1)
    }
  }

  const jumpToToday = () => {
    const now = new Date()
    setCalYear(now.getFullYear())
    setCalMonth(now.getMonth())
  }

  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const daysInMon = new Date(calYear, calMonth + 1, 0).getDate()
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  /* upcoming list */
  const upcoming = holidays
    .filter(h => h.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)

  const thisYearHolidays = holidays.filter(h => h.date.startsWith(String(calYear)))
  const nextHoliday = upcoming[0]

  /* year grouped list */
  const grouped = holidays.reduce((acc, h) => {
    const yr = h.date.slice(0, 4)
    if (!acc[yr]) acc[yr] = []
    acc[yr].push(h)
    return acc
  }, {})

  if (loading && holidays.length === 0) {
    return (
      <div className="loading-container">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <>
      {/* ── Header Banner & Quick Actions ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text)'
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <CalendarDays size={20} />
            </span>
            Company Holidays & Schedule
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Official declared company holidays, cultural celebrations, and public observances.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={() => load()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {isHr && (
            <button
              className="btn btn-primary"
              onClick={openCreate}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={15} /> Add Holiday
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Stats Cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          marginBottom: 24
        }}
      >
        <div
          className="card animate-fade-in"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <CalendarCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {calYear} Holidays
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {thisYearHolidays.length} Days
            </div>
          </div>
        </div>

        <div
          className="card animate-fade-in"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.12)',
              color: 'var(--success, #10b981)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Clock size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Upcoming Holidays
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {upcoming.length} Left
            </div>
          </div>
        </div>

        <div
          className="card animate-fade-in"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(245, 158, 11, 0.14)',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <PartyPopper size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Next Holiday
            </div>
            {nextHoliday ? (
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nextHoliday.title}>
                {nextHoliday.title} · <span style={{ color: 'var(--primary)', fontSize: 12 }}>{nextHoliday.date}</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No upcoming holidays</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Two-Column Grid: Interactive Calendar & Upcoming Timeline ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 0.95fr)',
          gap: 20,
          alignItems: 'start'
        }}
        className="hol-main-grid"
      >
        {/* ── Interactive Calendar Card ── */}
        <div
          className="card hol-cal-card animate-fade-in"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 20,
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)'
          }}
        >
          {/* Calendar Header & Month Navigation */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
              paddingBottom: 14,
              borderBottom: '1px solid var(--border)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarDays size={19} style={{ color: 'var(--primary)' }} />
                {MONTHS[calMonth]} {calYear}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={jumpToToday}
                style={{ fontSize: 12, padding: '4px 10px', height: 30 }}
              >
                Today
              </button>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label="Previous month"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label="Next month"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Days of Week Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 6,
              marginBottom: 8
            }}
          >
            {DAYS.map((d, i) => (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: i === 0 || i === 6 ? '#f59e0b' : 'var(--text-muted)',
                  padding: '4px 0'
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Date Cells Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 6
            }}
          >
            {Array.from({ length: firstDay }).map((_, i) => (
              <div
                key={'empty-' + i}
                style={{
                  minHeight: 68,
                  borderRadius: 10,
                  background: 'transparent',
                  opacity: 0.2
                }}
              />
            ))}
            {Array.from({ length: daysInMon }).map((_, i) => {
              const day = i + 1
              const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const hol = holidayMap[dateStr]
              const isToday = dateStr === todayStr
              const isSun = (firstDay + i) % 7 === 0
              const isSat = (firstDay + i) % 7 === 6

              return (
                <div
                  key={day}
                  onClick={() => {
                    if (hol && isHr) openEdit(hol)
                  }}
                  onMouseEnter={() => hol && setHovered(hol)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    position: 'relative',
                    minHeight: 68,
                    padding: 8,
                    borderRadius: 10,
                    border: isToday
                      ? '2px solid var(--primary)'
                      : hol
                      ? '1px solid color-mix(in srgb, var(--primary) 40%, var(--border))'
                      : '1px solid var(--border)',
                    background: hol
                      ? 'var(--primary-soft)'
                      : isSun || isSat
                      ? 'var(--surface-2)'
                      : 'var(--bg-card)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: hol ? (isHr ? 'pointer' : 'default') : 'default',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: hol || isToday ? 800 : 600,
                        width: isToday ? 22 : 'auto',
                        height: isToday ? 22 : 'auto',
                        borderRadius: isToday ? '50%' : 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isToday ? 'var(--primary)' : 'transparent',
                        color: isToday ? '#ffffff' : (hol ? 'var(--primary)' : (isSun || isSat ? '#f59e0b' : 'var(--text)')),
                      }}
                    >
                      {day}
                    </span>

                    {hol && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--primary)'
                        }}
                      />
                    )}
                  </div>

                  {hol && (
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--primary)',
                        background: 'color-mix(in srgb, var(--primary) 15%, var(--bg-card))',
                        padding: '2px 5px',
                        borderRadius: 5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 4
                      }}
                      title={hol.title}
                    >
                      {hol.title}
                    </div>
                  )}

                  {/* Tooltip on hover */}
                  {hol && hovered?.id === hol.id && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: '50%',
                        transform: 'translateX(-50%) translateY(-6px)',
                        background: '#0f172a',
                        color: '#ffffff',
                        padding: '8px 12px',
                        borderRadius: 8,
                        fontSize: 11.5,
                        whiteSpace: 'nowrap',
                        zIndex: 50,
                        boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                        pointerEvents: 'none'
                      }}
                    >
                      <strong style={{ display: 'block', color: '#60a5fa' }}>{hol.title}</strong>
                      {hol.description && <span style={{ color: '#cbd5e1', fontSize: 11 }}>{hol.description}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Calendar Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginTop: 18,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text-secondary)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--primary-soft)', border: '1px solid var(--primary)' }} />
              <span>Company Holiday</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)' }} />
              <span>Today</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--surface-2)', border: '1px solid var(--border)' }} />
              <span>Weekend</span>
            </div>
          </div>
        </div>

        {/* ── Upcoming Holidays Timeline Card ── */}
        <div
          className="card hol-upcoming-card animate-fade-in"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 20,
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--border)'
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={17} style={{ color: 'var(--primary)' }} />
              Upcoming Holidays
            </h3>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 6,
                background: 'var(--primary-soft)',
                color: 'var(--primary)'
              }}
            >
              {upcoming.length} Events
            </span>
          </div>

          {upcoming.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
              <PartyPopper size={36} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 14 }}>No upcoming holidays scheduled</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upcoming.map(h => {
                const d = new Date(h.date + 'T00:00:00')
                const dayName = d.toLocaleDateString([], { weekday: 'short' })
                const dayNum = d.getDate()
                const mon = d.toLocaleDateString([], { month: 'short' })
                const rel = getRelativeTime(h.date, todayStr)

                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {/* Date badge */}
                    <div
                      style={{
                        width: 48,
                        height: 50,
                        borderRadius: 10,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', color: 'var(--primary)' }}>
                        {mon}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                        {dayNum}
                      </span>
                      <span style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>
                        {dayName}
                      </span>
                    </div>

                    {/* Holiday details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 700 }}>
                          {h.title}
                        </strong>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: rel.isSoon ? 'rgba(16, 185, 129, 0.14)' : 'var(--primary-soft)',
                            color: rel.isSoon ? 'var(--success, #10b981)' : 'var(--primary)'
                          }}
                        >
                          {rel.text}
                        </span>
                      </div>
                      {h.description && (
                        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.description}
                        </p>
                      )}
                    </div>

                    {/* Action buttons (for HR) */}
                    {isHr && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        <button
                          type="button"
                          className="emp-action-btn edit-btn"
                          onClick={() => openEdit(h)}
                          title="Edit holiday"
                          aria-label="Edit holiday"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="emp-action-btn delete-btn"
                          onClick={() => setDeleteTarget(h)}
                          title="Delete holiday"
                          aria-label="Delete holiday"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Full Holiday Directory By Year ── */}
      {Object.keys(grouped).length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarIcon size={18} style={{ color: 'var(--primary)' }} />
              All Declared Holidays Directory
            </h2>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {holidays.length} total holidays registered
            </span>
          </div>

          {Object.entries(grouped)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([year, list]) => (
              <div
                key={year}
                className="card animate-fade-in"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: 20,
                  marginBottom: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 12,
                    marginBottom: 14,
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CalendarDays size={16} style={{ color: 'var(--primary)' }} /> Year {year}
                  </h3>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {list.length} holidays
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 12
                  }}
                >
                  {list
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(h => {
                      const d = new Date(h.date + 'T00:00:00')
                      const formattedDate = d.toLocaleDateString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })

                      return (
                        <div
                          key={h.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '12px 14px',
                            borderRadius: 12,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)'
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--primary)', marginBottom: 2 }}>
                              {formattedDate}
                            </div>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {h.title}
                            </div>
                            {h.description && (
                              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {h.description}
                              </div>
                            )}
                          </div>

                          {isHr && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                              <button
                                type="button"
                                className="emp-action-btn edit-btn"
                                onClick={() => openEdit(h)}
                                title="Edit holiday"
                                aria-label="Edit holiday"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                className="emp-action-btn delete-btn"
                                onClick={() => setDeleteTarget(h)}
                                title="Delete holiday"
                                aria-label="Delete holiday"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* ── Add / Edit Holiday Modal ── */}
      {showModal && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => !submitting && setShowModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999,
            padding: '20px',
            boxSizing: 'border-box',
            overflowY: 'auto'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '480px',
              background: 'var(--bg-card)',
              color: 'var(--text)',
              borderRadius: '20px',
              boxShadow: '0 30px 70px -15px rgba(15, 23, 42, 0.45)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              maxHeight: 'calc(100vh - 40px)',
              animation: 'modalScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div className="modal-header">
              <h2>{editing ? 'Edit Holiday' : 'Add New Holiday'}</h2>
              <button
                className="modal-close"
                onClick={() => !submitting && setShowModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
            >
              <div
                className="modal-body"
                style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div className="form-group">
                  <label className="form-label" htmlFor="holiday-title">
                    Holiday Title *
                  </label>
                  <input
                    className="form-input"
                    id="holiday-title"
                    value={form.title}
                    placeholder="e.g. Independence Day, Diwali"
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="holiday-date">
                    Date *
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    id="holiday-date"
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="holiday-description">
                    Description / Remarks
                  </label>
                  <textarea
                    className="form-textarea"
                    id="holiday-description"
                    rows={3}
                    placeholder="Optional notes or details about this holiday..."
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>

              <div
                className="modal-footer"
                style={{
                  flexShrink: 0,
                  padding: '16px 24px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 12
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editing ? 'Update Holiday' : 'Create Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Holiday"
          message={`Are you sure you want to delete "${deleteTarget.title}" (${deleteTarget.date})?`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setDeleteTarget(null)}
        />
      )}
    </>
  )
}
