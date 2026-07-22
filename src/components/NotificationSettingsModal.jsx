import React, { useState, useEffect } from 'react'
import { X, Sliders, Volume2, Mic } from 'lucide-react'
import { useSelector, useDispatch } from 'react-redux'
import { setSoundEnabled, setVoiceEnabled, setVoiceVolume, setSelectedVoice } from '../store/authSlice'
import { useUpdateSoundSettingMutation } from '../store/apiSlice'
import { getVoices, selectPreferredVoice, voiceLabel } from '../utils/speechHelper'
import { notificationService } from '../services/notificationService'

export default function NotificationSettingsModal({ isOpen, onClose }) {
  const dispatch = useDispatch()
  const reduxSoundEnabled = useSelector(state => state.auth.soundEnabled)
  const reduxVoiceEnabled = useSelector(state => state.auth.voiceEnabled)
  const reduxVoiceVolume = useSelector(state => state.auth.voiceVolume)
  const reduxSelectedVoice = useSelector(state => state.auth.selectedVoice)

  const [updateSettings, { isLoading: isSaving }] = useUpdateSoundSettingMutation()
  const [soundEnabled, setLocalSoundEnabled] = useState(reduxSoundEnabled)
  const [voiceEnabled, setLocalVoiceEnabled] = useState(reduxVoiceEnabled)
  const [voiceVolume, setLocalVoiceVolume] = useState(reduxVoiceVolume)
  const [selectedVoice, setLocalSelectedVoice] = useState(reduxSelectedVoice)
  const [voices, setVoices] = useState([])
  const [testingSound, setTestingSound] = useState(false)
  const [testingVoice, setTestingVoice] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLocalSoundEnabled(reduxSoundEnabled)
    setLocalVoiceEnabled(reduxVoiceEnabled)
    setLocalVoiceVolume(reduxVoiceVolume)
    setLocalSelectedVoice(reduxSelectedVoice)

    let mounted = true
    getVoices().then(list => {
      if (!mounted) return
      setVoices(list)
      if (!reduxSelectedVoice) {
        setLocalSelectedVoice(selectPreferredVoice(list, '')?.name || '')
      }
    })

    const handleVoicesChanged = () => {
      getVoices().then(list => {
        if (mounted) setVoices(list)
      })
    }
    window.speechSynthesis?.addEventListener?.('voiceschanged', handleVoicesChanged)

    return () => {
      mounted = false
      window.speechSynthesis?.removeEventListener?.('voiceschanged', handleVoicesChanged)
    }
  }, [isOpen, reduxSoundEnabled, reduxVoiceEnabled, reduxVoiceVolume, reduxSelectedVoice])

  if (!isOpen) return null

  const handleSave = async () => {
    dispatch(setSoundEnabled(soundEnabled))
    dispatch(setVoiceEnabled(voiceEnabled))
    dispatch(setVoiceVolume(voiceVolume))
    dispatch(setSelectedVoice(selectedVoice))

    try {
      await updateSettings({
        sound_enabled: soundEnabled,
        voice_enabled: voiceEnabled,
        voice_volume: voiceVolume,
        selected_voice: selectedVoice
      }).unwrap()
    } catch (err) {
      console.warn('Backend settings sync failed, falling back to local storage:', err)
    }

    onClose()
  }

  const handleTestSound = () => {
    if (testingSound) return
    setTestingSound(true)
    try {
      notificationService.testSound(voiceVolume)
    } catch {}
    setTimeout(() => setTestingSound(false), 700)
  }

  const handleTestVoice = async () => {
    if (testingVoice) return
    setTestingVoice(true)
    try {
      await notificationService.testVoice('This is a test of the voice alert system.', {
        volume: voiceVolume,
        voiceName: selectedVoice
      })
    } catch {}
    setTestingVoice(false)
  }

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose} style={{ zIndex: 100 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)' }}>
            <Sliders size={20} className="primary" />
            Notification Settings
          </h2>
          <button className="modal-close" onClick={onClose} disabled={isSaving} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ── Volume ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <label htmlFor="volume-select" style={{ display: 'block', fontSize: '14px', color: 'var(--text)', fontWeight: 'bold' }}>Volume</label>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Controls both sound alerts and voice volume</span>
              </div>
              <span style={{
                fontSize: '14px', fontWeight: 700, fontFamily: 'Outfit,sans-serif',
                color: 'var(--primary)', background: 'var(--primary-light)',
                padding: '2px 10px', borderRadius: 8,
              }}>{Math.round(voiceVolume * 100)}%</span>
            </div>
            <input
              id="volume-select"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={voiceVolume}
              onChange={e => setLocalVoiceVolume(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border)', margin: 0 }} />

          {/* ── Alert Sounds ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <strong style={{ display: 'block', fontSize: '14px', color: 'var(--text)' }}>Alert Sounds</strong>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Play a sound when important notifications arrive</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={handleTestSound}
                disabled={testingSound}
                title="Test notification sound"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                <Volume2 size={13} /> {testingSound ? 'Playing…' : 'Test'}
              </button>
              <button
                className={`theme-toggle ${soundEnabled ? 'dark' : ''}`}
                onClick={() => setLocalSoundEnabled(v => !v)}
                title={soundEnabled ? 'Sound Enabled' : 'Sound Disabled'}
              >
                <span className="theme-toggle-label">{soundEnabled ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border)', margin: 0 }} />

          {/* ── Voice Alerts ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <strong style={{ display: 'block', fontSize: '14px', color: 'var(--text)' }}>Voice Alerts</strong>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Speak important notifications aloud</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={handleTestVoice}
                disabled={testingVoice || !voiceEnabled}
                title="Test voice alert"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                <Mic size={13} /> {testingVoice ? 'Speaking…' : 'Test'}
              </button>
              <button
                className={`theme-toggle ${voiceEnabled ? 'dark' : ''}`}
                onClick={() => setLocalVoiceEnabled(v => !v)}
                title={voiceEnabled ? 'Voice Enabled' : 'Voice Disabled'}
              >
                <span className="theme-toggle-label">{voiceEnabled ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>

          {/* ── Voice selector ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: voiceEnabled ? 1 : 0.45 }}>
            <label htmlFor="voice-select" style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Voice</label>
            <select
              id="voice-select"
              className="form-select"
              value={selectedVoice}
              disabled={!voiceEnabled || voices.length === 0}
              onChange={e => {
                const nextVoice = e.target.value
                setLocalSelectedVoice(nextVoice)
                // Preview voice immediately
                notificationService.speak('Voice preview.', {
                  voiceName: nextVoice,
                  volume: voiceVolume,
                  force: true,
                  dedupe: false
                })
              }}
            >
              {voices.length === 0 ? (
                <option value="">Browser default</option>
              ) : voices.map(voice => (
                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                  {voiceLabel(voice)}
                </option>
              ))}
            </select>
          </div>

        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
