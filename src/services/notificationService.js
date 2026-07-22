import { store } from '../store';
import { addToast, setSelectedVoice, setSoundEnabled, setVoiceEnabled, setVoiceVolume } from '../store/authSlice';
import { playToastSound, playNotifSound } from '../utils/audioHelper';
import { getVoices, getSpeakText, isImportantMessage, selectPreferredVoice, speakMessage } from '../utils/speechHelper';

const SPOKEN_STORAGE_KEY = 'hrms_spoken_event_ids';
const MAX_SPOKEN_IDS = 300;
const recentText = new Map();
const speechQueue = [];
let speaking = false;

export const sanitizeErrorMessage = (message) => {
  if (!message || typeof message !== 'string') return 'Unable to complete the request. Please try again.';
  const msg = message.toLowerCase();

  if (
    msg.includes('mongodb') ||
    msg.includes('mongo') ||
    msg.includes('bulk write') ||
    msg.includes('e11000') ||
    msg.includes('php') ||
    msg.includes('stack trace') ||
    msg.includes('exception') ||
    msg.includes('fatal error') ||
    msg.includes('warning:') ||
    msg.includes('notice:') ||
    msg.includes('c:\\') ||
    msg.includes('/var/') ||
    msg.includes('/home/') ||
    msg.includes('vendor\\') ||
    msg.includes('vendor/') ||
    /\bhttp\s*(status)?\s*\d{3}\b/i.test(message) ||
    /\b(500|503|404|403|401)\b/.test(msg)
  ) {
    return 'Unable to complete the request. Please try again.';
  }

  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('socket') ||
    msg.includes('offline') ||
    msg.includes('network')
  ) {
    return 'Network issue. Please check your connection.';
  }

  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('access denied')) {
    return 'Permission denied.';
  }

  return message;
};

const getSpokenIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPOKEN_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hasSpoken = (eventId) => {
  if (!eventId) return false;
  return getSpokenIds().includes(eventId);
};

const markSpoken = (eventId) => {
  if (!eventId) return;
  const ids = getSpokenIds().filter(id => id !== eventId);
  ids.push(eventId);
  localStorage.setItem(SPOKEN_STORAGE_KEY, JSON.stringify(ids.slice(-MAX_SPOKEN_IDS)));
};

const shouldSkipRecentText = (text) => {
  const now = Date.now();
  const last = recentText.get(text);
  recentText.set(text, now);

  for (const [key, value] of recentText.entries()) {
    if (now - value > 15000) recentText.delete(key);
  }

  return last && now - last < 5000;
};

const processSpeechQueue = async () => {
  if (speaking) return;
  speaking = true;

  while (speechQueue.length > 0) {
    const item = speechQueue.shift();
    const state = store.getState().auth;
    if (!state.voiceEnabled && !item.force) continue;

    await speakMessage(
      item.text,
      item.volume ?? state.voiceVolume,
      true,
      item.voiceName ?? state.selectedVoice ?? ''
    );

    if (item.eventId) markSpoken(item.eventId);
  }

  speaking = false;
};

const enqueueSpeech = ({ text, eventId, force = false, dedupe = true, volume, voiceName }) => {
  if (!text) return;
  if (dedupe && eventId && hasSpoken(eventId)) return;
  if (dedupe && !eventId && shouldSkipRecentText(text)) return;

  if (eventId) markSpoken(eventId);

  speechQueue.push({ text, eventId, force, volume, voiceName });
  processSpeechQueue();
};

const playConfiguredSound = (type, volume, isNotification = false) => {
  if (isNotification || type === 'notif' || type === 'notification') playNotifSound(volume);
  else playToastSound(type, volume);
};

export const notificationService = {
  notify({
    type = 'info',
    message,
    speak = true,
    sound = true,
    toast = true,
    muteSound = false,
    muteVoice = false,
    eventId = '',
    speakText = '',
    forceSpeak = false,
    dedupe = true,
    title = '',
  } = {}) {
    const state = store.getState().auth;
    const cleanMessage = type === 'error' ? sanitizeErrorMessage(message) : String(message || '');
    let cleanSpeakText = type === 'error' ? sanitizeErrorMessage(speakText || message) : String(speakText || message || '');

    const isHr = state.user?.role === 'hr';
    cleanSpeakText = getSpeakText(title, cleanSpeakText, isHr);

    if (toast && cleanMessage) {
      store.dispatch(addToast(cleanMessage, type));
    }

    // Native OS notification (Windows toast)
    if (title && cleanMessage && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          new Notification(title, { body: cleanMessage, icon: '/logo.png' });
        } catch (e) {
          // silent
        }
      } else if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    if (sound && !muteSound && state.soundEnabled) {
      if (!dedupe || !eventId || !hasSpoken(eventId + '_sound')) {
        if (eventId) markSpoken(eventId + '_sound');
        try {
          playConfiguredSound(type, state.voiceVolume, Boolean(eventId));
        } catch (e) {
          if (e.message === 'AutoplayBlocked') {
            store.dispatch(addToast('Please click Test Sound once to enable notification sounds.', 'warning'));
          } else {
            console.warn('Audio play failed:', e);
          }
        }
      }
    }

    if (
      speak &&
      !muteVoice &&
      state.voiceEnabled &&
      cleanSpeakText &&
      (forceSpeak || isImportantMessage(cleanSpeakText))
    ) {
      enqueueSpeech({
        text: cleanSpeakText,
        eventId,
        dedupe,
        volume: state.voiceVolume,
        voiceName: state.selectedVoice,
      });
    }
  },

  notifySuccess(message, options = {}) {
    this.notify({ type: 'success', message, ...options });
  },

  notifyError(message, options = {}) {
    this.notify({ type: 'error', message, ...options });
  },

  notifyWarning(message, options = {}) {
    this.notify({ type: 'warning', message, ...options });
  },

  speak(message, options = {}) {
    const state = store.getState().auth;
    if (!state.voiceEnabled && !options.force) return;
    enqueueSpeech({
      text: sanitizeErrorMessage(message),
      eventId: options.eventId,
      force: options.force,
      dedupe: options.dedupe !== false,
      volume: options.volume ?? state.voiceVolume,
      voiceName: options.voiceName ?? state.selectedVoice,
    });
  },

  playSound(type = 'info') {
    const state = store.getState().auth;
    if (!state.soundEnabled) return;
    try {
      playConfiguredSound(type, state.voiceVolume);
    } catch (e) {
      if (e.message === 'AutoplayBlocked') {
        store.dispatch(addToast('Please click Test Sound once to enable notification sounds.', 'warning'));
      } else {
        console.warn('Audio play failed:', e);
      }
    }
  },

  async testVoice(text = 'Voice alerts are working correctly.', options = {}) {
    const state = store.getState().auth;
    enqueueSpeech({
      text,
      force: true,
      dedupe: false,
      volume: options.volume ?? state.voiceVolume,
      voiceName: options.voiceName ?? state.selectedVoice,
    });
  },

  testSound(volume) {
    const state = store.getState().auth;
    playNotifSound(volume ?? state.voiceVolume);
  },

  async getAvailableVoices() {
    return getVoices();
  },

  async getPreferredVoiceName(selectedVoice = '') {
    const voices = await getVoices();
    return selectPreferredVoice(voices, selectedVoice)?.name || '';
  },

  setPreferences({ soundEnabled, voiceEnabled, voiceVolume, selectedVoice }) {
    if (typeof soundEnabled !== 'undefined') store.dispatch(setSoundEnabled(soundEnabled));
    if (typeof voiceEnabled !== 'undefined') store.dispatch(setVoiceEnabled(voiceEnabled));
    if (typeof voiceVolume !== 'undefined') store.dispatch(setVoiceVolume(voiceVolume));
    if (typeof selectedVoice !== 'undefined') store.dispatch(setSelectedVoice(selectedVoice));
  },

  hasSpoken,
  markSpoken,

  /** Request native OS notification permission (Windows toast) */
  requestNativePermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },
};
