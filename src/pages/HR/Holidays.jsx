import { useState, useRef } from 'react'
import {
  useGetHolidaysQuery,
  useCreateHolidayMutation,
  useUpdateHolidayMutation,
  useDeleteHolidayMutation
} from '../../store/apiSlice'
import { useToast, useAuth } from '../../App'
import { CalendarDays, Plus, RefreshCw, ChevronLeft, ChevronRight, Edit2, Trash2, X } from 'lucide-react'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function HrHolidays() {
  const { user } = useAuth()
  const isHr = user?.role === 'hr'
  
  const [showModal,  setShowModal]  = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [form,       setForm]       = useState({ title: '', date: '', description: '' })
  const [submitting, setSubmitting] = useState(false)
  const [calYear,    setCalYear]    = useState(new Date().getFullYear())
  const [calMonth,   setCalMonth]   = useState(new Date().getMonth())
  const [hovered,    setHovered]    = useState(null)
  const { toast } = useToast()

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
    if (!form.title || !form.date) { toast('Title and date required.', 'error'); return }
    setSubmitting(true)
    try {
      if (editing) {
        await updateHoliday({ id: editing.id, body: form }).unwrap()
        toast('Holiday updated.', 'success')
      } else {
        await createHoliday(form).unwrap()
        toast('Holiday created.', 'success')
      }
      setShowModal(false)
    } catch (err) {
      toast(err.data?.message || err.message || 'Failed.', 'error')
    } finally { setSubmitting(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this holiday?')) return
    try {
      await deleteHoliday(id).unwrap()
      toast('Deleted.', 'success')
    } catch {
      toast('Delete failed.', 'error')
    }
  }

  /* ── calendar helpers ── */
  const holidayMap = holidays.reduce((acc, h) => { acc[h.date] = h; return acc }, {})

  const prevMonth = () => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1) }
  const nextMonth = () => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1) }

  const firstDay  = new Date(calYear, calMonth, 1).getDay()
  const daysInMon = new Date(calYear, calMonth + 1, 0).getDate()
  const today     = new Date()
  const todayStr  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  /* upcoming list — next 6 months */
  const upcoming = holidays
    .filter(h => h.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)

  /* year grouped list */
  const grouped = holidays.reduce((acc, h) => {
    const yr = h.date.slice(0, 4)
    if (!acc[yr]) acc[yr] = []
    acc[yr].push(h)
    return acc
  }, {})

  if (loading && holidays.length === 0) return <div className="loading-container"><div className="spinner" /></div>

  return (
    <>
      {/* toolbar */}
      <div className="search-bar">
        {isHr && (
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Add Holiday
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => load()}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {holidays.length} holiday{holidays.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── main grid: calendar + upcoming ── */}
      <div className="hol-grid">

        {/* Calendar card */}
        <div className="card hol-cal-card">
          <div className="hol-cal-header">
            <button className="hol-nav-btn" onClick={prevMonth} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <div className="hol-cal-title">
              <CalendarDays size={18} />
              {MONTHS[calMonth]} {calYear}
            </div>
            <button className="hol-nav-btn" onClick={nextMonth} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>

          {/* day names */}
          <div className="hol-cal-days-row">
            {DAYS.map(d => <div key={d} className="hol-cal-day-name">{d}</div>)}
          </div>

          {/* date cells */}
          <div className="hol-cal-grid">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={'empty-' + i} className="hol-cal-cell hol-cal-empty" />
            ))}
            {Array.from({ length: daysInMon }).map((_, i) => {
              const day   = i + 1
              const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const hol   = holidayMap[dateStr]
              const isToday = dateStr === todayStr
              const isSun = (firstDay + i) % 7 === 0
              const isSat = (firstDay + i) % 7 === 6
              return (
                <div
                  key={day}
                  className={`hol-cal-cell ${hol ? 'hol-cal-holiday' : ''} ${isToday ? 'hol-cal-today' : ''} ${isSun || isSat ? 'hol-cal-weekend' : ''}`}
                  onMouseEnter={() => hol && setHovered(hol)}
                  onMouseLeave={() => setHovered(null)}
                  title={hol ? hol.title : ''}
                >
                  <span className="hol-cal-num">{day}</span>
                  {hol && <span className="hol-cal-dot" />}
                  {hol && hovered?.id === hol.id && (
                    <div className="hol-cal-tooltip">
                      <strong>{hol.title}</strong>
                      {hol.description && <span>{hol.description}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* legend */}
          <div className="hol-cal-legend">
            <span className="hol-legend-item"><span className="hol-legend-dot hol-legend-holiday" />Holiday</span>
            <span className="hol-legend-item"><span className="hol-legend-dot hol-legend-today" />Today</span>
            <span className="hol-legend-item"><span className="hol-legend-dot hol-legend-weekend" />Weekend</span>
          </div>
        </div>

        {/* Upcoming holidays */}
        <div className="card hol-upcoming-card">
          <div className="card-header">
            <h3 className="card-title">Upcoming Holidays</h3>
          </div>
          {upcoming.length === 0 ? (
            <div className="table-empty"><p>No upcoming holidays</p></div>
          ) : upcoming.map(h => {
            const d = new Date(h.date + 'T00:00:00')
            const dayName = d.toLocaleDateString([], { weekday: 'short' })
            const dayNum  = d.getDate()
            const mon     = d.toLocaleDateString([], { month: 'short' })
            return (
              <div key={h.id} className="hol-upcoming-item">
                <div className="hol-upcoming-date">
                  <span className="hol-udate-num">{dayNum}</span>
                  <span className="hol-udate-mon">{mon}</span>
                  <span className="hol-udate-day">{dayName}</span>
                </div>
                <div className="hol-upcoming-info">
                  <div className="hol-upcoming-title">{h.title}</div>
                  {h.description && <div className="hol-upcoming-desc">{h.description}</div>}
                </div>
                {isHr && (
                  <div className="hol-upcoming-actions">
                    <button className="btn btn-sm btn-secondary btn-icon" onClick={() => openEdit(h)} title="Edit" aria-label="Edit holiday">
                      <Edit2 size={13} />
                    </button>
                    <button className="btn btn-sm btn-danger btn-icon" onClick={() => handleDelete(h.id)} title="Delete" aria-label="Delete holiday">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Full list by year ── */}
      {Object.keys(grouped).length > 0 && (
        <div style={{ marginTop: 20 }}>
          {Object.entries(grouped).sort(([a],[b]) => b - a).map(([year, list]) => (
            <div className="card" style={{ marginBottom: 14 }} key={year}>
              <div className="card-header">
                <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CalendarDays size={16} style={{ color: 'var(--primary)' }} /> {year}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{list.length} holidays</span>
              </div>
              {list.sort((a,b) => a.date.localeCompare(b.date)).map(h => (
                <div key={h.id} className="holiday-item">
                  <div className="holiday-date">{h.date}</div>
                  <div style={{ flex: 1 }}>
                    <div className="holiday-title">{h.title}</div>
                    {h.description && <div className="holiday-desc">{h.description}</div>}
                  </div>
                  {isHr && (
                    <div className="table-actions">
                      <button className="btn btn-sm btn-secondary btn-icon" onClick={() => openEdit(h)} title="Edit" aria-label="Edit holiday">
                        <Edit2 size={13} />
                      </button>
                      <button className="btn btn-sm btn-danger btn-icon" onClick={() => handleDelete(h.id)} title="Delete" aria-label="Delete holiday">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !submitting && setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Edit Holiday' : 'Add Holiday'}</h2>
              <button className="modal-close" onClick={() => !submitting && setShowModal(false)} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="holiday-title">Title *</label>
                <input className="form-input" id="holiday-title" value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="holiday-date">Date *</label>
                <input type="date" className="form-input" id="holiday-date" value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="holiday-description">Description</label>
                <textarea className="form-textarea" id="holiday-description" value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary"
                  onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
