// Shared Synth Sound Helpers

let sharedAudioCtx = null
let resumePromise = null
const pendingSounds = []

const getAudioContext = () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) throw new Error('Web Audio not supported')

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContextClass()
  }

  return sharedAudioCtx
}

const normalizeVolume = (volume = 1.0) => {
  const parsed = Number(volume)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(0, Math.min(1, parsed))
}

export const unlockAudio = async () => {
  const audioCtx = getAudioContext()
  if (audioCtx.state === 'running') {
    flushPendingSounds(audioCtx)
    return true
  }

  if (!resumePromise) {
    resumePromise = audioCtx.resume().finally(() => {
      resumePromise = null
    })
  }

  await resumePromise
  const unlocked = audioCtx.state === 'running'
  if (unlocked) flushPendingSounds(audioCtx)
  return unlocked
}

const flushPendingSounds = (audioCtx) => {
  if (audioCtx.state !== 'running') return

  const queued = pendingSounds.splice(0)
  queued.forEach((buildSound) => {
    try {
      buildSound(audioCtx)
    } catch {
      // Drop malformed queued sounds without blocking the rest.
    }
  })
}

const runWithAudio = (buildSound) => {
  const audioCtx = getAudioContext()

  if (audioCtx.state === 'suspended') {
    pendingSounds.push(buildSound)
    unlockAudio()
      .then((unlocked) => {
        if (unlocked) flushPendingSounds(audioCtx)
      })
      .catch(() => {})
    return
  }

  buildSound(audioCtx)
}

export const playToggleSound = (volume = 1.0) => {
  try {
    const safeVolume = normalizeVolume(volume)
    runWithAudio((audioCtx) => {
      const start = audioCtx.currentTime
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(440, start)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.55 * safeVolume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22)
      osc.start(start)
      osc.stop(start + 0.22)
    })
  } catch {
    throw new Error('Sound test failed')
  }
}

export const playToastSound = (type = 'info', volume = 1.0) => {
  try {
    const safeVolume = normalizeVolume(volume)
    runWithAudio((audioCtx) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'triangle'

      const start = audioCtx.currentTime
      const frequency = type === 'error' ? 280 : type === 'warning' ? 360 : 520
      const sustain = type === 'error' ? 0.7 : 0.45

      osc.frequency.setValueAtTime(frequency, start)
      osc.frequency.linearRampToValueAtTime(frequency * 1.5, start + 0.1)
      osc.frequency.linearRampToValueAtTime(frequency * 0.75, start + 0.2)

      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.65 * safeVolume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + sustain)

      osc.start(start)
      osc.stop(start + sustain)
    })
  } catch {
    throw new Error('Sound test failed')
  }
}

export const playNotifSound = (volume = 1.0) => {
  try {
    const safeVolume = normalizeVolume(volume)
    runWithAudio((audioCtx) => {
      const start = audioCtx.currentTime
      const gain = audioCtx.createGain()
      gain.connect(audioCtx.destination)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.8 * safeVolume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.75)

      const osc1 = audioCtx.createOscillator()
      osc1.connect(gain)
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(880, start)
      osc1.start(start)
      osc1.stop(start + 0.22)

      const osc2 = audioCtx.createOscillator()
      osc2.connect(gain)
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(1174.66, start + 0.22)
      osc2.start(start + 0.22)
      osc2.stop(start + 0.75)
    })
  } catch {
    throw new Error('Sound test failed')
  }
}

export const playWelcomeSound = (volume = 1.0) => {
  try {
    const safeVolume = normalizeVolume(volume)
    runWithAudio((audioCtx) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'sine'

      const start = audioCtx.currentTime
      osc.frequency.setValueAtTime(523.25, start)
      osc.frequency.setValueAtTime(659.25, start + 0.15)
      osc.frequency.setValueAtTime(783.99, start + 0.3)
      osc.frequency.setValueAtTime(1046.5, start + 0.45)

      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.15 * safeVolume, start + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2)

      osc.start(start)
      osc.stop(start + 1.2)
    })
  } catch {
    // silently ignore
  }
}

export const playLunchSound = (volume = 1.0) => {
  try {
    const safeVolume = normalizeVolume(volume)
    runWithAudio((audioCtx) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'triangle'

      const start = audioCtx.currentTime
      osc.frequency.setValueAtTime(329.63, start)
      osc.frequency.setValueAtTime(440.0, start + 0.15)
      osc.frequency.setValueAtTime(554.37, start + 0.3)
      osc.frequency.setValueAtTime(659.25, start + 0.45)

      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.2 * safeVolume, start + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.8)

      osc.start(start)
      osc.stop(start + 0.8)
    })
  } catch {
    // silently ignore
  }
}
