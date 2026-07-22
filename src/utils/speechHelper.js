let voiceLoadPromise = null;

const MALE_VOICE_HINTS = [
  'male',
  'man',
  'david',
  'mark',
  'george',
  'daniel',
  'alex',
  'fred',
  'tom',
  'ravi'
];

export const getVoices = () => {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  if (voiceLoadPromise) return voiceLoadPromise;

  voiceLoadPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 2000);
  });

  return voiceLoadPromise;
};

export const findVoice = (voices, voiceName) => {
  if (!voiceName) return null;
  return voices.find(v => v.name === voiceName) || null;
};

const isEnglish = (voice) => (voice.lang || '').toLowerCase().startsWith('en');
const isIndianEnglish = (voice) => (voice.lang || '').toLowerCase() === 'en-in';
const isLikelyMale = (voice) => {
  const name = (voice.name || '').toLowerCase();
  return MALE_VOICE_HINTS.some(hint => name.includes(hint));
};

export const selectPreferredVoice = (voices = [], selectedVoice = '') => {
  if (!voices.length) return null;

  const saved = findVoice(voices, selectedVoice);
  if (saved) return saved;

  return voices.find(v => isIndianEnglish(v) && isLikelyMale(v))
    || voices.find(v => isEnglish(v) && isLikelyMale(v))
    || voices.find(v => isIndianEnglish(v))
    || voices.find(v => isEnglish(v) && v.default)
    || voices.find(isEnglish)
    || voices.find(v => v.default)
    || voices[0]
    || null;
};

export const voiceLabel = (voice) => {
  if (!voice) return 'Browser default';
  const parts = [voice.name];
  if (voice.lang) parts.push(voice.lang);
  if (isLikelyMale(voice)) parts.push('likely male');
  return parts.join(' - ');
};

export const isImportantMessage = (message) => {
  if (!message) return false;
  const msg = message.toLowerCase();

  return [
    'login successful',
    'welcome back',
    'login failed',
    'logged out',
    'logout successful',
    'session has expired',
    'password changed',
    'otp sent',
    'otp verified',
    'permission denied',
    'access denied',
    'denied',
    'failed',
    'unable',
    'checked in',
    'checked out',
    'check-in',
    'check-out',
    'on time',
    'late',
    'early checkout',
    'checkout undo',
    'break',
    'lunch',
    'evening',
    'leave',
    'task update',
    'saved',
    'approved',
    'rejected',
    'approval',
    'request',
    'timer paused',
    'timer resumed',
    'paused',
    'resumed',
    'deactivated'
  ].some(term => msg.includes(term));
};

export const shouldSpeakNotification = (title, message, type) => {
  const text = `${title || ''} ${message || ''} ${type || ''}`.toLowerCase();
  return isImportantMessage(text)
    || text.includes('chat')
    || text.includes('message')
    || text.includes('call invitation');
};

export const cleanSpeakText = (message) => {
  if (!message) return '';
  const parts = String(message).split(';');
  const cleanParts = parts.filter(p => !p.includes('=') && p.trim() !== '');
  const cleanMsg = cleanParts.length > 0 ? cleanParts[cleanParts.length - 1] : message;
  return cleanMsg.trim();
};

export const getSpeakText = (title, message, isHr = false) => {
  if (!message) return '';

  const t = (title || '').toLowerCase();
  const m = (message || '').toLowerCase();

  if (t.includes('chat') || t.includes('message')) {
    const senderMatch = message.match(/sender=([^;]+)/);
    const sender = senderMatch ? senderMatch[1].trim() : 'Someone';
    const parts = message.split(';');
    const preview = parts[parts.length - 1]?.trim() || '';
    const colonIdx = preview.indexOf(':');
    const text = colonIdx !== -1 ? preview.slice(colonIdx + 1).trim() : preview;
    return text ? `New message from ${sender}: ${text.slice(0, 80)}` : `New message from ${sender}.`;
  }

  if (t.includes('call invitation')) {
    const hostMatch = message.match(/host=([^;]+)/);
    const host = hostMatch ? hostMatch[1].trim() : 'Someone';
    return `${host} invited you to join a call.`;
  }

  if (isHr) {
    if (m.includes('has requested') || m.includes('has submitted') || m.includes('requested') || m.includes('checked in') || m.includes('checked out')) {
      return cleanSpeakText(message);
    }
    if (t.includes('leave request')) return 'New leave request received.';
    if (t.includes('lunch') && (t.includes('extension') || m.includes('extension'))) return 'New lunch extension request received.';
    if (t.includes('evening') && (t.includes('extension') || m.includes('extension'))) return 'New evening extension request received.';
    if (t.includes('break request') || t.includes('extension request')) return 'New break request received.';
    if (t.includes('early checkout') || t.includes('checkout undo')) return 'Early checkout request received.';
    if (t.includes('late check-in approval') || t.includes('late checkin approval')) return 'Attendance approval required.';
    if (t.includes('late arrival') || t.includes('late check-in') || m.includes('checked in late')) return 'Employee checked in late.';
  }

  return cleanSpeakText(message);
};

export const speakMessage = async (message, volume = 1, voiceEnabled = true, voiceName = '') => {
  if (!voiceEnabled || !message || !('speechSynthesis' in window)) return false;

  const cleanText = String(message).trim();
  if (!cleanText) return false;

  try {
    const voices = await getVoices();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const requestedVolume = Number(volume);
    utterance.volume = Number.isFinite(requestedVolume)
      ? Math.max(0, Math.min(1, requestedVolume))
      : 1;
    utterance.rate = 1.08;
    utterance.pitch = 1;

    const voice = selectPreferredVoice(voices, voiceName);
    if (voice) utterance.voice = voice;

    return await new Promise((resolve) => {
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  } catch (err) {
    console.error('Speech synthesis error:', err);
    return false;
  }
};
