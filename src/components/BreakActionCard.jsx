import React from 'react';

export default function BreakActionCard({
  title,
  isActive,
  isCompleted,
  onAction,
  actionLabel = 'Request Extra',
  autoStartText = 'Auto starts',
  disabled = false,
}) {
  return (
    <div className="break-control-card" style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'center'
    }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'center' }}>{title}</span>
        {isActive ? (
            <button
                type="button"
                className="btn btn-warning"
                onClick={onAction}
                disabled={disabled}
                style={{ width: '100%', padding: '6px 12px', fontSize: 12, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
                {actionLabel}
            </button>
        ) : isCompleted ? (
            <span className="badge badge-success" style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 20 }}>Completed</span>
        ) : (
            <span className="badge" style={{ padding: '4px 10px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 20 }}>{autoStartText}</span>
        )}
    </div>
  );
}
