import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function ConfirmModal({
  title = 'Confirm action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div onClick={() => !loading && onClose?.()} style={{ position:'fixed',inset:0,top:0,left:0,right:0,bottom:0,width:'100vw',height:'100vh',background:'rgba(15,23,42,0.65)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999999,padding:'20px',boxSizing:'border-box' }}>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative',width:'100%',maxWidth:'460px',background:'var(--bg-card)',color:'var(--text)',borderRadius:'18px',boxShadow:'0 25px 60px -15px rgba(15,23,42,0.35)',border:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={() => !loading && onClose?.()} disabled={loading} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
