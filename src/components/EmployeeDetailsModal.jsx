import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { createPortal } from 'react-dom'
import {
  X, Mail, Phone, MapPin, Briefcase, Calendar, IndianRupee,
  Edit2, Camera, User, Building2, BadgeCheck, Clock,
  ClipboardList, Home, CreditCard, Coffee, ChevronLeft,
  ChevronRight, FileText, LogIn, LogOut, Timer, CheckCircle2,
} from 'lucide-react'
import {
  useGetEmployeeAttendanceQuery,
  useGetEmployeeLeavesQuery,
  useGetEmployeeWFHQuery,
  useGetEmployeePayrollQuery,
} from '../store/apiSlice'

const EMP_TYPE_LABELS = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
}

const LEAVE_TYPE_LABELS = {
  sick_leave: 'Sick Leave',
  casual_leave: 'Casual Leave',
  annual_leave: 'Annual Leave',
  maternity_leave: 'Maternity Leave',
  paternity_leave: 'Paternity Leave',
  emergency_leave: 'Emergency Leave',
  unpaid_leave: 'Unpaid Leave',
  compensatory_leave: 'Compensatory Leave',
}

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const TABS = [
  { id: 'profile',    label: 'Profile',    Icon: User },
  { id: 'attendance', label: 'Attendance', Icon: Clock },
  { id: 'leaves',     label: 'Leaves',     Icon: ClipboardList },
  { id: 'wfh',        label: 'WFH',        Icon: Home },
  { id: 'payroll',    label: 'Payroll',    Icon: CreditCard },
  { id: 'breaks',     label: 'Breaks',     Icon: Coffee },
]

function fmtDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return d
  }
}

function fmtTime(t) {
  if (!t) return '—'
  const str = String(t).trim()
  const timePart = str.includes(' ') ? str.split(' ')[1] : str
  const [h, m] = timePart.split(':')
  const hour = parseInt(h, 10)
  if (isNaN(hour)) return t
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${m || '00'} ${ampm}`
}

function fmtCurrency(n) {
  return '₹' + parseFloat(n || 0).toLocaleString('en-IN')
}

function StatusPill({ status }) {
  const map = {
    active:         { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', border: 'rgba(16,185,129,0.3)',  label: 'Active' },
    inactive:       { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)',   label: 'Inactive' },
    present:        { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', border: 'rgba(16,185,129,0.3)',  label: 'Present' },
    absent:         { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)',   label: 'Absent' },
    late:           { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', border: 'rgba(245,158,11,0.3)',  label: 'Late' },
    half_day:       { bg: 'rgba(139,92,246,0.12)',  color: '#8b5cf6', border: 'rgba(139,92,246,0.3)',  label: 'Half Day' },
    early_checkout: { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', border: 'rgba(245,158,11,0.3)',  label: 'Early Checkout' },
    approved:       { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', border: 'rgba(16,185,129,0.3)',  label: 'Approved' },
    rejected:       { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)',   label: 'Rejected' },
    pending:        { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', border: 'rgba(245,158,11,0.3)',  label: 'Pending' },
    completed:      { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', border: 'rgba(16,185,129,0.3)',  label: 'Completed' },
    cancelled:      { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', border: 'rgba(107,114,128,0.3)', label: 'Cancelled' },
  }
  const s = map[status?.toLowerCase()] || { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', border: 'rgba(107,114,128,0.3)', label: status || '—' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 11,
      fontWeight: 700,
      padding: '3px 9px',
      borderRadius: 20,
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
      {s.label}
    </span>
  )
}

function TabLoader({ cols = 5 }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {[1, 2, 3, 4, 5].map(i => (
          <tr key={i}>
            {Array.from({ length: cols }).map((_, j) => (
              <td key={j} style={{ padding: '12px 14px' }}>
                <div className="dashboard-skeleton dashboard-skeleton-line" style={{ height: 14, borderRadius: 6, width: j === 0 ? '70%' : '90%' }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--text-muted)' }}>
      <Icon size={38} style={{ marginBottom: 12, opacity: 0.4 }} />
      <p style={{ fontSize: 13.5, margin: 0, fontWeight: 500 }}>{message}</p>
    </div>
  )
}

function Avatar({ emp, size = 88 }) {
  const src = emp.profile_image
  if (src) {
    const imgSrc = src.startsWith('data:') || src.startsWith('http') ? src : `/api/${src.replace(/^\/+/, '')}`
    return (
      <img
        src={imgSrc}
        alt={emp.name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '4px solid var(--bg-card)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          background: 'var(--bg-card)',
        }}
      />
    )
  }
  const initials = emp.name ? emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
  const hue = (emp.name?.charCodeAt(0) || 0) * 17 % 360
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue + 45) % 360},75%,45%))`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.36,
        fontFamily: 'Outfit, sans-serif',
        border: '4px solid var(--bg-card)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      }}
    >
      {initials}
    </div>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={14} style={{ color: 'var(--primary)' }} /> {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, children }) {
  return (
    <div>
      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>{children || '—'}</div>
    </div>
  )
}

function SimpleTable({ headers, children }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            {headers.map(h => (
              <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, style = {} }) {
  return <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'middle', ...style }}>{children ?? '—'}</td>
}

function TableRow({ i, children }) {
  const [hov, setHov] = useState(false)
  return (
    <tr
      style={{
        background: hov ? 'rgba(99,102,241,0.06)' : i % 2 === 0 ? 'transparent' : 'var(--surface-2)',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {children}
    </tr>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ emp, onEdit, onClose, isViyana }) {
  const personal = emp.personal_profile || {}
  const emergency = emp.emergency_contact || {}
  const work = emp.employment_details || {}
  const compensation = emp.compensation_details || {}
  const it = emp.it_profile || {}
  const DetailGrid = ({ fields }) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 15 }}>{fields.map(([label, value]) => value ? <InfoRow key={label} label={label}>{value}</InfoRow> : null)}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section icon={Mail} title="Contact Information">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <InfoRow label="Email Address">
            {emp.email ? (
              <a href={`mailto:${emp.email}`} style={{ color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, wordBreak: 'break-all' }}>
                <Mail size={13} />{emp.email}
              </a>
            ) : '—'}
          </InfoRow>
          <InfoRow label="Phone Number">
            {emp.phone ? (
              <a href={`tel:${emp.phone}`} style={{ color: 'var(--text)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={13} style={{ color: 'var(--primary)' }} />{emp.phone}
              </a>
            ) : '—'}
          </InfoRow>
        </div>
      </Section>

      {Object.values(personal).some(Boolean) && <Section icon={User} title="Personal & Address Details">
        <DetailGrid fields={[
          ['Preferred Name', personal.preferred_name], ['Gender', personal.gender], ['Pronouns', personal.pronouns],
          ['Nationality', personal.nationality], ['Marital Status', personal.marital_status], ['Blood Group', personal.blood_group],
          ['Personal Email', personal.personal_email], ['Alternate Phone', personal.alternate_phone],
          ['Address', [personal.address_line_1, personal.address_line_2, personal.city, personal.state, personal.postal_code, personal.country].filter(Boolean).join(', ')],
        ]} />
      </Section>}

      {Object.values(emergency).some(Boolean) && <Section icon={Phone} title="Emergency Contact">
        <DetailGrid fields={[["Contact Name", emergency.name], ['Relationship', emergency.relationship], ['Phone', emergency.phone], ['Email', emergency.email]]} />
      </Section>}

      {Object.values(work).some(Boolean) && <Section icon={Briefcase} title="Team & Work Setup">
        <DetailGrid fields={[
          ['Squad / Team', work.team], ['Reporting Manager', work.manager_name], ['Work Location', work.work_location],
          ['Work Mode', work.work_mode], ['Probation End', work.probation_end_date], ['Confirmation Date', work.confirmation_date],
          ['Notice Period', work.notice_period_days ? `${work.notice_period_days} days` : ''], ['Shift', work.shift], ['Time Zone', work.timezone],
        ]} />
      </Section>}

      {Object.values(it).some(Boolean) && <Section icon={Building2} title="Engineering Profile & Equipment">
        <DetailGrid fields={[
          ['GitHub', it.github], ['LinkedIn', it.linkedin], ['Skills / Tech Stack', it.skills], ['Certifications', it.certifications],
          ['Laptop Asset Tag', it.laptop_asset_tag], ['Laptop Model', it.laptop_model], ['Operating System', it.operating_system],
          ['Assigned Tools / Access', it.tools_access], ['Security Training', it.security_training_date],
        ]} />
      </Section>}

      <Section icon={Briefcase} title="Employment & Organization">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {!isViyana && (
            <InfoRow label="Department">{emp.department ? <><Building2 size={13} style={{ color: 'var(--primary)' }} />{emp.department}</> : '—'}</InfoRow>
          )}
          <InfoRow label="Designation">{emp.designation || '—'}</InfoRow>
          <InfoRow label="Branch / Location">{emp.branch ? <><MapPin size={13} style={{ color: 'var(--primary)' }} />{emp.branch}</> : '—'}</InfoRow>
          <InfoRow label="Employment Type"><BadgeCheck size={13} style={{ color: 'var(--primary)' }} />{EMP_TYPE_LABELS[emp.employment_type] || emp.employment_type || 'Full Time'}</InfoRow>
          <InfoRow label="Joining Date"><Calendar size={13} style={{ color: 'var(--primary)' }} />{fmtDate(emp.joining_date)}</InfoRow>
          <InfoRow label="Date of Birth"><User size={13} style={{ color: 'var(--primary)' }} />{fmtDate(emp.date_of_birth)}</InfoRow>
        </div>
      </Section>

      <Section icon={IndianRupee} title="Compensation Details">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>
              Basic Salary / Month (Used for Monthly Payroll)
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {fmtCurrency(emp.basic_salary)}
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 4 }}>/ month</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {Number(emp.basic_salary) > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Estimated Annual CTC
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>
                  {fmtCurrency(parseFloat(emp.basic_salary || 0) * 12)}
                </span>
              </div>
            )}
            {onEdit && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => { onClose(); onEdit(emp); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 12px' }}
              >
                <Edit2 size={13} /> Edit Salary
              </button>
            )}
          </div>
        </div>
        {Object.values(compensation).some(Boolean) && <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <DetailGrid fields={[
            ['Currency', compensation.currency], ['Pay Frequency', compensation.pay_frequency], ['Annual Variable Pay', compensation.variable_pay ? fmtCurrency(compensation.variable_pay) : ''],
            ['Bank Account Holder', compensation.bank_account_name], ['Bank Account Number', compensation.bank_account], ['IFSC / Routing Code', compensation.bank_ifsc],
            ['PAN / Tax ID', compensation.pan_number], ['UAN / Pension ID', compensation.uan],
          ]} />
        </div>}
      </Section>
    </div>
  )
}

// ── Attendance Tab ────────────────────────────────────────────────────────────
function AttendanceTab({ employeeId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [page, setPage] = useState(1)
  const { data, isFetching } = useGetEmployeeAttendanceQuery({ employee_id: employeeId, page, per_page: 50 })
  const records = data?.data?.records ?? []
  const pagination = data?.data?.pagination ?? null
  const totalPages = pagination ? Math.ceil(pagination.total / 50) : 1
  const filtered = records.filter(r => {
    if (!r.date) return false
    const [y, m] = r.date.split('-').map(Number)
    return y === year && m === month
  })
  const present = filtered.filter(r => r.status && r.status !== 'absent').length
  const absent = filtered.filter(r => r.status === 'absent').length
  const late = filtered.filter(r => r.status === 'late').length
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={month} onChange={e => { setMonth(+e.target.value); setPage(1) }} className="form-select" style={{ width: 130, fontSize: 13 }}>
          {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => { setYear(+e.target.value); setPage(1) }} className="form-select" style={{ width: 100, fontSize: 13 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {!isFetching && filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {[{ label: `${present} Present`, c: '#10b981' }, { label: `${absent} Absent`, c: '#ef4444' }, { label: `${late} Late`, c: '#f59e0b' }].map(({ label, c }) => (
              <span key={label} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${c}18`, color: c, border: `1px solid ${c}33` }}>
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {isFetching ? (
        <TabLoader cols={6} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Clock} message={`No attendance records for ${MONTH_NAMES[month]} ${year}`} />
      ) : (
        <SimpleTable headers={['Date', 'Check In', 'Check Out', 'Hours', 'Status', 'Daily Task']}>
          {filtered.map((r, i) => (
            <TableRow key={r.id || i} i={i}>
              <Td><span style={{ fontWeight: 600 }}>{fmtDate(r.date)}</span></Td>
              <Td>
                {r.check_in ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#10b981', fontWeight: 600 }}>
                    <LogIn size={12} />{fmtTime(r.check_in)}
                  </span>
                ) : '—'}
              </Td>
              <Td>
                {r.check_out ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#ef4444', fontWeight: 600 }}>
                    <LogOut size={12} />{fmtTime(r.check_out)}
                  </span>
                ) : r.check_in ? (
                  <span style={{ color: 'var(--primary)', fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                    Active
                  </span>
                ) : '—'}
              </Td>
              <Td>
                {(r.net_working_hours || r.working_hours) ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                    <Timer size={12} style={{ color: 'var(--primary)' }} />
                    {r.net_working_hours || r.working_hours}
                  </span>
                ) : '—'}
              </Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 160 }} title={r.daily_task_update}>
                  {r.daily_task_update || '—'}
                </span>
              </Td>
            </TableRow>
          ))}
        </SimpleTable>
      )}

      {pagination && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Page {page} of {totalPages} · {pagination.total} records</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={13} /></button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Leaves Tab ────────────────────────────────────────────────────────────────
function LeavesTab({ employeeId }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useGetEmployeeLeavesQuery({ employee_id: employeeId, page, per_page: 50 })
  const leaves = data?.data?.leaves ?? []
  const pagination = data?.data?.pagination ?? null
  const totalPages = pagination ? Math.ceil(pagination.total / 50) : 1

  if (isFetching) return <TabLoader cols={6} />
  if (leaves.length === 0) return <EmptyState icon={ClipboardList} message="No leave requests found for this employee" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SimpleTable headers={['Leave Type', 'From', 'To', 'Reason', 'Status', 'Applied On']}>
        {leaves.map((l, i) => (
          <TableRow key={l.id || i} i={i}>
            <Td>
              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                {LEAVE_TYPE_LABELS[l.leave_type] || (l.leave_type?.replace(/_/g, ' ') || '—')}
              </span>
            </Td>
            <Td>{fmtDate(l.start_date)}</Td>
            <Td>{fmtDate(l.end_date)}</Td>
            <Td>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }} title={l.reason}>
                {l.reason || '—'}
              </span>
            </Td>
            <Td><StatusPill status={l.status} /></Td>
            <Td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{l.created_at ? fmtDate(l.created_at.split(' ')[0]) : '—'}</Td>
          </TableRow>
        ))}
      </SimpleTable>

      {pagination && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Page {page} of {totalPages} · {pagination.total} records</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={13} /></button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── WFH Tab ───────────────────────────────────────────────────────────────────
function WFHTab({ employeeId }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useGetEmployeeWFHQuery({ employee_id: employeeId, page, per_page: 50 })
  const requests = data?.data?.wfh_requests ?? []
  const pagination = data?.data?.pagination ?? null
  const totalPages = pagination ? Math.ceil(pagination.total / 50) : 1

  if (isFetching) return <TabLoader cols={5} />
  if (requests.length === 0) return <EmptyState icon={Home} message="No WFH requests found for this employee" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SimpleTable headers={['From Date', 'To Date', 'Reason', 'Status', 'Requested On']}>
        {requests.map((r, i) => (
          <TableRow key={r.id || i} i={i}>
            <Td><span style={{ fontWeight: 600 }}>{fmtDate(r.start_date)}</span></Td>
            <Td>{fmtDate(r.end_date)}</Td>
            <Td>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }} title={r.reason}>
                {r.reason || '—'}
              </span>
            </Td>
            <Td><StatusPill status={r.status} /></Td>
            <Td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.created_at ? fmtDate(r.created_at.split(' ')[0]) : '—'}</Td>
          </TableRow>
        ))}
      </SimpleTable>

      {pagination && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={13} /></button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Payroll Tab ───────────────────────────────────────────────────────────────
function PayrollTab({ employeeId }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useGetEmployeePayrollQuery({ employee_id: employeeId, page, per_page: 50 })
  const records = data?.data?.payroll ?? []
  const pagination = data?.data?.pagination ?? null
  const totalPages = pagination ? Math.ceil(pagination.total / 50) : 1
  const totalNet = records.reduce((s, r) => s + parseFloat(r.net_salary || 0), 0)

  if (isFetching) return <TabLoader cols={6} />
  if (records.length === 0) return <EmptyState icon={CreditCard} message="No payroll records found for this employee" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Total Payslips', value: pagination?.total ?? records.length, icon: FileText, color: '#6366f1' },
          { label: 'Total Net Paid', value: fmtCurrency(totalNet), icon: IndianRupee, color: '#10b981' },
          { label: 'Latest Month', value: records[0] ? `${MONTH_NAMES[records[0].month]} ${records[0].year}` : '—', icon: Calendar, color: '#f59e0b' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} style={{ color }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: 'Outfit, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <SimpleTable headers={['Month', 'Year', 'Basic', 'Allowances', 'Deductions', 'Net Salary']}>
        {records.map((r, i) => (
          <TableRow key={r.id || i} i={i}>
            <Td><span style={{ fontWeight: 600 }}>{MONTH_NAMES[r.month] || r.month}</span></Td>
            <Td>{r.year}</Td>
            <Td>{fmtCurrency(r.basic_salary)}</Td>
            <Td style={{ color: '#10b981', fontWeight: 600 }}>+{fmtCurrency(r.allowances)}</Td>
            <Td style={{ color: '#ef4444', fontWeight: 600 }}>-{fmtCurrency(r.deductions)}</Td>
            <Td><span style={{ fontWeight: 800, fontSize: 13, color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>{fmtCurrency(r.net_salary)}</span></Td>
          </TableRow>
        ))}
      </SimpleTable>

      {pagination && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={13} /></button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Breaks Tab ────────────────────────────────────────────────────────────────
function BreaksTab({ employeeId }) {
  const { data, isFetching } = useGetEmployeeAttendanceQuery({ employee_id: employeeId, page: 1, per_page: 50 })
  const records = data?.data?.records ?? []
  const breakSessions = []

  records.forEach(rec => {
    if (Array.isArray(rec.breaks)) {
      rec.breaks.forEach(b => breakSessions.push({ date: rec.date, type: b.break_type || 'break', started_at: b.started_at, ended_at: b.ended_at }))
    } else if (rec.break_start_time) {
      breakSessions.push({ date: rec.date, type: 'break', started_at: rec.break_start_time, ended_at: rec.check_out || null })
    }
  })

  const BC = {
    lunch:   { c: '#f59e0b', label: 'Lunch' },
    evening: { c: '#8b5cf6', label: 'Evening' },
    manual:  { c: '#3b82f6', label: 'Manual' },
    break:   { c: '#06b6d4', label: 'Break' },
    meeting: { c: '#10b981', label: 'Meeting' },
  }

  function dur(s, e) {
    if (!s || !e) return null
    const sTime = String(s).includes(' ') ? String(s).split(' ')[1] : String(s)
    const eTime = String(e).includes(' ') ? String(e).split(' ')[1] : String(e)
    const diff = (new Date(`1970-01-01T${sTime.slice(0, 8)}`) - new Date(`1970-01-01T${eTime.slice(0, 8)}`))
    const m = Math.floor(Math.abs(diff) / 60000)
    if (m <= 0) return null
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
  }

  if (isFetching) return <TabLoader cols={5} />
  if (breakSessions.length === 0) return <EmptyState icon={Coffee} message="No break sessions recorded for this employee" />

  return (
    <SimpleTable headers={['Date', 'Break Type', 'Started', 'Ended', 'Duration']}>
      {breakSessions.map((b, i) => {
        const bc = BC[b.type] || BC.break
        const d = dur(b.started_at, b.ended_at)
        return (
          <TableRow key={i} i={i}>
            <Td><span style={{ fontWeight: 600 }}>{fmtDate(b.date)}</span></Td>
            <Td>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: `${bc.c}18`, color: bc.c, border: `1px solid ${bc.c}30` }}>
                {bc.label}
              </span>
            </Td>
            <Td>{b.started_at ? fmtTime(b.started_at) : '—'}</Td>
            <Td>
              {b.ended_at ? fmtTime(b.ended_at) : (
                <span style={{ color: 'var(--primary)', fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                  Ongoing
                </span>
              )}
            </Td>
            <Td>{d ? <span style={{ fontWeight: 700, color: bc.c }}>{d}</span> : '—'}</Td>
          </TableRow>
        )
      })}
    </SimpleTable>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function EmployeeDetailsModal({ employee, isOpen, onClose, onEdit, onUpdatePhoto }) {
  const [activeTab, setActiveTab] = useState('profile')
  const user = useSelector(state => state.auth?.user)
  const isViyana = user?.company_slug === 'viyana'
  const visibleTabs = TABS.filter(t => !isViyana || t.id !== 'breaks')

  useEffect(() => {
    if (isOpen) {
      setActiveTab('profile')
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen || !employee || typeof document === 'undefined') return null

  const emp = employee
  const hue = (emp.name?.charCodeAt(0) || 0) * 19 % 360
  const hue2 = (hue + 45) % 360

  return createPortal(
    /* ── Backdrop ── */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Modal Card ── */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 880,
          background: 'var(--bg-card)',
          borderRadius: 20,
          border: '1px solid var(--border)',
          boxShadow: '0 25px 60px -15px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 36px)',
          animation: 'modalScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* ══════════════════════════════════════════
            HERO BANNER
        ══════════════════════════════════════════ */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {/* Refined mesh banner with gentle lighting */}
          <div
            style={{
              height: 115,
              background: `
                radial-gradient(circle at 18% 45%, hsl(${hue},75%,38%) 0%, transparent 60%),
                radial-gradient(circle at 82% 35%, hsl(${hue2},80%,32%) 0%, transparent 55%),
                linear-gradient(135deg, hsl(${hue},65%,22%) 0%, hsl(${hue2},60%,14%) 100%)
              `,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Subtle ambient lighting */}
            <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: `hsl(${hue},80%,65%)`, opacity: 0.08, top: -70, right: 90 }} />
            <div style={{ position: 'absolute', width: 140, height: 140, borderRadius: '50%', background: `hsl(${hue2},80%,65%)`, opacity: 0.09, bottom: -40, left: '30%' }} />

            {/* Top Bar: Pill Badge + Close Button */}
            <div style={{
              position: 'absolute',
              top: 14,
              left: 20,
              right: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffffff' }}>
                  Employee Profile
                </span>
              </div>

              <button
                onClick={onClose}
                aria-label="Close"
                type="button"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.85)'
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)'
                  e.currentTarget.style.transform = 'scale(1.08)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── Identity Block (Cleanly below the banner, NO clipping!) ── */}
          <div
            style={{
              padding: '0 28px 18px',
              background: 'var(--bg-card)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 18,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {/* Left: Avatar + Full Name & Roles */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, minWidth: 0 }}>
              {/* Avatar cleanly straddles banner edge */}
              <div style={{ position: 'relative', marginTop: -46, flexShrink: 0, zIndex: 2 }}>
                <Avatar emp={emp} size={88} />
                {onUpdatePhoto && (
                  <button
                    type="button"
                    onClick={() => onUpdatePhoto(emp)}
                    title="Change employee photo"
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      right: 2,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      color: '#ffffff',
                      border: '2.5px solid var(--bg-card)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
                      transition: 'transform 0.15s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.12)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <Camera size={13} />
                  </button>
                )}
              </div>

              {/* Text Info: Sits completely inside the card body */}
              <div style={{ paddingTop: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 5 }}>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--text)',
                      fontFamily: 'Outfit, sans-serif',
                      letterSpacing: '-0.02em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {emp.name}
                  </h2>
                  <StatusPill status={emp.status} />
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: 'var(--text-secondary)',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      padding: '2px 8px',
                      borderRadius: 6,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {emp.employee_code || (emp.id ? `EMP-${emp.id.slice(-5)}` : 'EMP')}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Briefcase size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                    <span>{emp.designation || 'Role Not Assigned'}</span>
                  </span>
                  {!isViyana && emp.department && (
                    <>
                      <span style={{ opacity: 0.35 }}>•</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Building2 size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{emp.department}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Quick Info Chips */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 6,
                paddingTop: 8,
                marginLeft: 'auto',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {emp.joining_date && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Calendar size={12} style={{ color: 'var(--primary)' }} />
                    Joined {new Date(emp.joining_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </span>
                )}
                {emp.branch && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <MapPin size={12} style={{ color: 'var(--primary)' }} />
                    {emp.branch}
                  </span>
                )}
                {emp.employment_type && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <BadgeCheck size={12} style={{ color: 'var(--primary)' }} />
                    {EMP_TYPE_LABELS[emp.employment_type] || emp.employment_type}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════
            MODERN PILL TAB BAR
        ══════════════════════════════════════════ */}
        <div
          style={{
            flexShrink: 0,
            padding: '8px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {visibleTabs.map(({ id, label, Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '7px 14px',
                    borderRadius: 9,
                    border: active ? '1px solid var(--border)' : '1px solid transparent',
                    background: active ? 'var(--bg-card)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--text-secondary)',
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.color = 'var(--text)'
                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.color = 'var(--text-secondary)'
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <Icon size={14} style={{ color: active ? 'var(--primary)' : 'currentColor', flexShrink: 0 }} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            TAB CONTENT
        ══════════════════════════════════════════ */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px', minHeight: 0, background: 'var(--bg-card)' }}>
          {activeTab === 'profile'    && <ProfileTab emp={emp} onEdit={onEdit} onClose={onClose} isViyana={isViyana} />}
          {activeTab === 'attendance' && <AttendanceTab employeeId={emp.id} />}
          {activeTab === 'leaves'     && <LeavesTab employeeId={emp.id} />}
          {activeTab === 'wfh'        && <WFHTab employeeId={emp.id} />}
          {activeTab === 'payroll'    && <PayrollTab employeeId={emp.id} />}
          {activeTab === 'breaks'     && <BreaksTab employeeId={emp.id} />}
        </div>

        {/* ══════════════════════════════════════════
            FOOTER ACTIONS
        ══════════════════════════════════════════ */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 28px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--surface-2)',
          }}
        >
          {/* Left: Basic Salary Pill (Fix stray 0 bug!) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {Number(emp.basic_salary) > 0 ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: 8,
                  background: 'rgba(16,185,129,0.1)',
                  border: '1px solid rgba(16,185,129,0.22)',
                  color: '#10b981',
                }}
              >
                <IndianRupee size={13} />
                <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>
                  {parseFloat(emp.basic_salary).toLocaleString('en-IN')}
                  <span style={{ fontSize: 10.5, fontWeight: 500, marginLeft: 3, opacity: 0.8 }}>/mo</span>
                </span>
              </div>
            ) : null}

            {onUpdatePhoto && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { onClose(); onUpdatePhoto(emp) }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
              >
                <Camera size={13} /> Photo
              </button>
            )}

            {onEdit && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { onClose(); onEdit(emp) }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  background: 'var(--primary)',
                  border: 'none',
                  boxShadow: '0 3px 10px rgba(99,102,241,0.3)',
                }}
              >
                <Edit2 size={13} /> Edit Employee
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ fontSize: 12.5, minWidth: 70 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
