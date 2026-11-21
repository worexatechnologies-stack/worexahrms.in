import { useMemo, useState } from 'react'
import { FileText, Printer, UserRound, CalendarDays, ShieldCheck, BriefcaseBusiness, ChevronRight, FileCheck2, AlertTriangle } from 'lucide-react'
import { useGetEmployeesQuery } from '../../store/apiSlice'
import { useAuth } from '../../App'
import logo from '../../assets/logo.png'

const todayISO = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
const templates = [
  { id: 'offer', label: 'Offer letter', description: 'Employment offer and joining terms', Icon: BriefcaseBusiness },
  { id: 'experience', label: 'Experience letter', description: 'Employment and service confirmation', Icon: FileCheck2 },
  { id: 'termination', label: 'Termination letter', description: 'Employment separation notice', Icon: AlertTriangle },
]
const formatDate = value => {
  if (!value) return '________________'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}
const currency = value => value === '' || value == null ? '________________' : `₹${Number(value).toLocaleString('en-IN')}`

function employeeDefaults(employee, template) {
  const date = todayISO()
  const hired = employee?.joining_date || date
  const location = employee?.employment_details?.work_location || employee?.branch || '________________'
  const base = {
    letter_date: date,
    role: employee?.designation || '',
    department: employee?.department || '',
    joining_date: hired,
    salary: employee?.basic_salary == null ? '' : String(employee.basic_salary),
    employment_type: employee?.employment_type || 'full_time',
    work_location: location,
    reporting_manager: employee?.employment_details?.manager_name || '',
    probation_months: '3',
    offer_expiry: '',
    start_date: hired,
    end_date: date,
    last_working_date: date,
    effective_date: date,
    reason: '',
    notice_period: employee?.employment_details?.notice_period_days || '30',
    settlement_date: '',
    property_return: 'Please return all company-issued devices, access cards, and other property.',
    signatory: '',
    signatory_title: 'Human Resources',
  }
  if (template === 'experience') base.end_date = employee?.exit_date || employee?.last_working_date || date
  return base
}

function letterCopy(template, employee, values, company) {
  const name = employee?.name || '________________'
  const role = values.role || '________________'
  const department = values.department || '________________'
  const location = values.work_location || '________________'
  const manager = values.reporting_manager || '________________'
  if (template === 'offer') return {
    subject: 'Offer of Employment',
    paragraphs: [
      `Dear ${name},`,
      `We are pleased to offer you the position of ${role} in the ${department} team at ${company}. This is a ${String(values.employment_type || 'full_time').replaceAll('_', ' ')} position based at ${location}. You will report to ${manager}.`,
      `Your proposed start date is ${formatDate(values.joining_date)}. Your monthly basic salary will be ${currency(values.salary)} gross, subject to applicable deductions, company policies, and the detailed compensation terms issued separately by Human Resources.`,
      `Your initial probation period will be ${values.probation_months || '3'} months from your joining date. Continued employment is subject to satisfactory completion of onboarding, verification of employment documents, and acceptance of the company’s policies and information security requirements.`,
      values.offer_expiry ? `Please confirm your acceptance of this offer by ${formatDate(values.offer_expiry)}. This offer is subject to the final employment agreement and applicable company policies.` : 'Please confirm your acceptance of this offer by replying to Human Resources. This offer is subject to the final employment agreement and applicable company policies.',
      'We look forward to having you join the team.',
    ],
  }
  if (template === 'experience') return {
    subject: 'Experience Certificate',
    paragraphs: [
      `To Whom It May Concern,`,
      `This is to certify that ${name} was employed with ${company} as ${role} in the ${department} team from ${formatDate(values.start_date)} to ${formatDate(values.end_date)}.`,
      `During this period, ${name} contributed to the team’s work and carried out the responsibilities assigned to them.`,
      'We thank them for their service and wish them success in their future professional endeavors.',
    ],
  }
  return {
    subject: 'Notice of Employment Termination',
    paragraphs: [
      `Dear ${name},`,
      `This letter confirms that your employment with ${company} as ${role} in the ${department} team will end effective ${formatDate(values.effective_date)}. Your last working day is ${formatDate(values.last_working_date)}.`,
      values.reason ? `Reason for separation: ${values.reason}` : 'Reason for separation: ________________________________',
      `Your notice period is recorded as ${values.notice_period || '________________'} days, subject to the terms of your employment agreement and applicable policy. Human Resources will coordinate final compensation, benefits, and return-of-property steps.`,
      values.settlement_date ? `The expected final settlement date is ${formatDate(values.settlement_date)}.` : 'Human Resources will confirm the expected final settlement timeline separately.',
      values.property_return || 'Please return all company-issued property and coordinate access handover with your manager.',
      'Please contact Human Resources if you have questions about the separation process or outstanding documentation.',
    ],
  }
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  return <label className="letter-field"><span>{label}</span><input type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>
}

export default function LetterStudio() {
  const { user } = useAuth()
  const { data: employeeResponse, isLoading } = useGetEmployeesQuery({ per_page: 100, status: 'active' })
  const raw = employeeResponse?.data?.employees || employeeResponse?.data || []
  const employees = Array.isArray(raw) ? raw : []
  const [template, setTemplate] = useState('offer')
  const [employeeId, setEmployeeId] = useState('')
  const employee = useMemo(() => employees.find(item => String(item.id) === String(employeeId)), [employees, employeeId])
  const [values, setValues] = useState(() => employeeDefaults(null, 'offer'))
  const [reviewed, setReviewed] = useState(false)
  const selectedTemplate = templates.find(item => item.id === template) || templates[0]
  const letter = letterCopy(template, employee, values, user?.company_name || 'Company')
  const setField = key => value => setValues(current => ({ ...current, [key]: value }))
  const changeTemplate = id => { setTemplate(id); setValues(current => ({ ...employeeDefaults(employee, id), signatory: current.signatory, signatory_title: current.signatory_title })); setReviewed(false) }
  const changeEmployee = id => { setEmployeeId(id); const next = employees.find(item => String(item.id) === String(id)); setValues(current => ({ ...employeeDefaults(next, template), signatory: current.signatory, signatory_title: current.signatory_title })); setReviewed(false) }
  const printLetter = () => {
    if (template === 'termination' && !reviewed) return
    window.print()
  }

  return <main className="letter-studio">
    <header className="letter-page-header"><div><span className="people-eyebrow"><FileText size={14}/> PEOPLE OPERATIONS</span><h1>HR Letter Studio</h1><p>Prepare employee letters from verified HR records and print or save as PDF.</p></div><button className="people-primary" onClick={printLetter} disabled={!employee || (template === 'termination' && !reviewed)}><Printer size={16}/> Print / Save PDF</button></header>
    <div className="letter-template-grid">{templates.map(item => <button type="button" key={item.id} className={`letter-template-card ${template === item.id ? 'active' : ''}`} onClick={() => changeTemplate(item.id)}><span className="letter-template-icon"><item.Icon size={19}/></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={16}/></button>)}</div>
    <div className="letter-workspace">
      <section className="letter-controls">
        <div className="letter-section-heading"><span className="letter-step">01</span><div><h2>Employee & document details</h2><p>Choose an employee, then review or adjust the letter fields.</p></div></div>
        <label className="letter-field"><span>Employee record</span><select value={employeeId} onChange={event => changeEmployee(event.target.value)} disabled={isLoading}><option value="">{isLoading ? 'Loading employees…' : 'Select employee'}</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.employee_code || item.email}</option>)}</select></label>
        {!isLoading && employees.length === 0 && <div className="letter-inline-note">No active employees found. Add an employee first in Employee Directory.</div>}
        {employee && <div className="letter-employee-chip"><span className="letter-employee-avatar">{employee.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong>{employee.name}</strong><small>{employee.employee_code || 'No employee ID'} · {employee.email}</small></span><UserRound size={15}/></div>}
        <div className="letter-fields-grid">
          <Field label="Letter date" type="date" value={values.letter_date} onChange={setField('letter_date')} />
          <Field label="Job title" value={values.role} onChange={setField('role')} />
          <Field label="Department" value={values.department} onChange={setField('department')} />
          {template === 'offer' && <>
            <Field label="Joining date" type="date" value={values.joining_date} onChange={setField('joining_date')} />
            <Field label="Monthly basic salary (₹)" type="number" value={values.salary} onChange={setField('salary')} />
            <Field label="Employment type" value={values.employment_type} onChange={setField('employment_type')} />
            <Field label="Work location" value={values.work_location} onChange={setField('work_location')} />
            <Field label="Reporting manager" value={values.reporting_manager} onChange={setField('reporting_manager')} />
            <Field label="Probation (months)" type="number" value={values.probation_months} onChange={setField('probation_months')} />
            <Field label="Offer valid until" type="date" value={values.offer_expiry} onChange={setField('offer_expiry')} />
          </>}
          {template === 'experience' && <>
            <Field label="Employment start date" type="date" value={values.start_date} onChange={setField('start_date')} />
            <Field label="Employment end date" type="date" value={values.end_date} onChange={setField('end_date')} />
          </>}
          {template === 'termination' && <>
            <Field label="Effective date" type="date" value={values.effective_date} onChange={setField('effective_date')} />
            <Field label="Last working day" type="date" value={values.last_working_date} onChange={setField('last_working_date')} />
            <Field label="Notice period (days)" type="number" value={values.notice_period} onChange={setField('notice_period')} />
            <Field label="Final settlement date" type="date" value={values.settlement_date} onChange={setField('settlement_date')} />
            <label className="letter-field letter-field-wide"><span>Reason for separation</span><textarea rows="3" value={values.reason} onChange={event => setField('reason')(event.target.value)} placeholder="Enter the approved reason for separation" /></label>
            <label className="letter-field letter-field-wide"><span>Return of property / handover</span><textarea rows="2" value={values.property_return} onChange={event => setField('property_return')(event.target.value)} /></label>
          </>}
          <Field label="Authorized signatory" value={values.signatory} onChange={setField('signatory')} placeholder="Name" />
          <Field label="Signatory title" value={values.signatory_title} onChange={setField('signatory_title')} />
        </div>
        {template === 'termination' && <div className="letter-review-box"><ShieldCheck size={18}/><div><strong>Review before issuing</strong><p>Confirm the decision, notice period, dates, final settlement, and applicable company policy with authorized HR and management before sending this letter.</p><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I have reviewed and approved these details.</label></div></div>}
      </section>

      <section className="letter-preview-panel"><div className="letter-preview-toolbar"><div><strong>Live document preview</strong><span><CalendarDays size={13}/>{selectedTemplate.label}</span></div><button className="people-secondary" onClick={printLetter} disabled={!employee || (template === 'termination' && !reviewed)}><Printer size={14}/> Print</button></div>
        {!employee ? <div className="letter-empty-preview"><FileText size={26}/><strong>Your letter preview appears here</strong><span>Select an employee record to draft the {selectedTemplate.label.toLowerCase()}.</span></div> : <article className="hr-letter-print-root"><div className="hr-letter-paper"><div className="hr-letter-brand"><img src={logo} alt=""/><div><strong>{user?.company_name || 'Company'}</strong><span>PEOPLE & CULTURE</span></div></div><div className="hr-letter-date">{formatDate(values.letter_date)}</div><div className="hr-letter-address"><strong>{employee.name}</strong><span>{employee.employee_code || ''}</span><span>{employee.email || ''}</span></div><h2>{letter.subject}</h2><div className="hr-letter-body">{letter.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><div className="hr-letter-signature"><span>Sincerely,</span><div className="hr-letter-sign-line"/><strong>{values.signatory || '____________________________'}</strong><span>{values.signatory_title || 'Human Resources'}</span><span>{user?.company_name || 'Company'}</span></div><footer>This document was prepared by the Human Resources team. Keep a copy for your records.</footer></div></article>}
      </section>
    </div>
  </main>
}
