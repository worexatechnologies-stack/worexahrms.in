export default function StatusBadge({ status, children, className = '' }) {
  const normalized = String(status || 'info').toLowerCase().replace(/\s+/g, '_')
  return (
    <span className={`status-badge status-${normalized} ${className}`.trim()}>
      {children || String(status || 'info').replace(/_/g, ' ')}
    </span>
  )
}
