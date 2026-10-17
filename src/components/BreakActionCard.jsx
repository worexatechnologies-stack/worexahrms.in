import React from 'react';

export default function BreakActionCard({
  title,
  isActive,
  isCompleted,
  completedTimeText,
  onAction,
  actionLabel = 'Request Extra',
  autoStartText = 'Auto starts',
  disabled = false,
}) {
  return (
    <div className="break-control-card" style={{
        background: isActive ? 'var(--warning-soft)' : 'var(--surface-2)',
        border: `1px solid ${isActive ? 'var(--warning)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        transition: 'all 0.2s',
        boxShadow: isActive ? '0 4px 12px rgba(245, 158, 11, 0.15)' : 'none'
    }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? 'var(--warning)' : 'var(--text-primary)', textAlign: 'center' }}>
          {title}
        </span>
        {isActive ? (
            <button
                type="button"
                className="btn btn-warning"
                onClick={onAction}
                disabled={disabled}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: 12 }}
            >
                {actionLabel}
            </button>
        ) : isCompleted ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span className="badge badge-success" style={{ padding: '5px 12px', fontSize: 12, background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 24, fontWeight: 700 }}>
                Completed
              </span>
              {completedTimeText && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  {completedTimeText}
                </span>
              )}
            </div>
        ) : (
            <span className="badge" style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 24, fontWeight: 500 }}>
              {autoStartText}
            </span>
        )}
    </div>
  );
}
