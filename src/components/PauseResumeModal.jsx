import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause } from 'lucide-react';

export default function PauseResumeModal({
  isOpen,
  isPaused,
  employeeName,
  onConfirm,
  onClose,
  loading = false,
}) {
  const [reason, setReason] = useState('');

  // Reset reason field when opening/closing
  useEffect(() => {
    if (isOpen) {
      setReason('');
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div onClick={() => !loading && onClose()} style={{ position:'fixed',inset:0,top:0,left:0,right:0,bottom:0,width:'100vw',height:'100vh',background:'rgba(15,23,42,0.65)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999999,padding:'20px',boxSizing:'border-box' }}>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'400px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.35)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',padding:'24px' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {isPaused ? <Play size={18} style={{ color: 'var(--success)' }} /> : <Pause size={18} style={{ color: 'var(--warning)' }} />}
            {isPaused ? 'Resume Employee Timer' : 'Pause Employee Timer'}
          </h2>
          <button className="modal-close" onClick={() => !loading && onClose()} disabled={loading} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
            {isPaused
              ? `Are you sure you want to resume the timer for ${employeeName}?`
              : `Specify a reason for pausing the timer for ${employeeName} (optional):`}
          </p>
          {!isPaused && (
            <textarea
              className="form-input"
              placeholder="Enter pause reason (optional)..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={loading}
              style={{ width: '100%', minHeight: 80, borderRadius: 8, padding: 10, fontSize: 13 }}
            />
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${isPaused ? 'btn-success' : 'btn-warning'}`}
            onClick={() => onConfirm(isPaused ? undefined : reason.trim())}
            disabled={loading}
          >
            {loading ? 'Processing...' : isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
