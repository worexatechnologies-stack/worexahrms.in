import { createSlice } from '@reduxjs/toolkit';

// Sanitize user structure
function sanitizeUser(userData) {
  if (!userData || typeof userData !== 'object') return null;
  return {
    id: userData.id || userData._id || '',
    name: userData.name || '',
    email: userData.email || '',
    role: userData.role || '',
    profile_image: userData.profile_image || userData.profileImage || '',
    company_name: userData.company_name || 'Worexa',
    company_slug: userData.company_slug || 'worexa',
    ...(userData.branch ? { branch: userData.branch } : {}),
  };
}

const getStoredTheme = () => {
  try {
    const saved = localStorage.getItem('hrms_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
};
const getStoredSound = () => localStorage.getItem('hrms_sound_enabled') !== 'false';
const getStoredVoice = () => localStorage.getItem('hrms_voice_enabled') !== 'false';
const clampVoiceVolume = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.85, Math.min(1, parsed)) : 1;
};
const getStoredVoiceVolume = () => {
  const v = localStorage.getItem('hrms_voice_volume');
  // Ensure a minimum audible volume of 0.85; default to 1 if no preference saved
  return v !== null ? clampVoiceVolume(v) : 1;
};
const getStoredSelectedVoice = () => localStorage.getItem('hrms_selected_voice') || '';

const getStoredUser = () => {
  try {
    const stored = localStorage.getItem('hrms_user');
    return stored ? sanitizeUser(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
};

const initialState = {
  user: getStoredUser(),
  theme: getStoredTheme(),
  soundEnabled: getStoredSound(),
  voiceEnabled: getStoredVoice(),
  voiceVolume: getStoredVoiceVolume(),
  selectedVoice: getStoredSelectedVoice(),
  toasts: [],
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      const { user } = action.payload;
      const safeUser = sanitizeUser(user);
      state.user = safeUser;
      if (safeUser) localStorage.setItem('hrms_user', JSON.stringify(safeUser));
      if (typeof user?.sound_enabled !== 'undefined') {
        state.soundEnabled = user.sound_enabled === true || user.sound_enabled === 'true';
        localStorage.setItem('hrms_sound_enabled', state.soundEnabled ? 'true' : 'false');
      }
      if (typeof user?.voice_enabled !== 'undefined') {
        state.voiceEnabled = user.voice_enabled === true || user.voice_enabled === 'true';
        localStorage.setItem('hrms_voice_enabled', state.voiceEnabled ? 'true' : 'false');
      }
      if (typeof user?.voice_volume !== 'undefined') {
        state.voiceVolume = clampVoiceVolume(user.voice_volume);
        localStorage.setItem('hrms_voice_volume', String(state.voiceVolume));
      }
      if (typeof user?.selected_voice !== 'undefined') {
        state.selectedVoice = String(user.selected_voice || '');
        localStorage.setItem('hrms_selected_voice', state.selectedVoice);
      }
    },
    logoutSuccess: (state) => {
      state.user = null;
      localStorage.removeItem('hrms_user');
    },
    toggleTheme: (state) => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      state.theme = nextTheme;
      try {
        localStorage.setItem('hrms_theme', nextTheme);
      } catch {}
      if (typeof document !== 'undefined') {
        if (nextTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    },
    setTheme: (state, action) => {
      const nextTheme = action.payload === 'dark' ? 'dark' : 'light';
      state.theme = nextTheme;
      try {
        localStorage.setItem('hrms_theme', nextTheme);
      } catch {}
      if (typeof document !== 'undefined') {
        if (nextTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    },
    toggleNotificationSound: (state) => {
      state.soundEnabled = !state.soundEnabled;
      localStorage.setItem('hrms_sound_enabled', state.soundEnabled ? 'true' : 'false');
    },
    setSoundEnabled: (state, action) => {
      state.soundEnabled = action.payload === true || action.payload === 'true';
      localStorage.setItem('hrms_sound_enabled', state.soundEnabled ? 'true' : 'false');
    },
    setVoiceEnabled: (state, action) => {
      state.voiceEnabled = action.payload === true || action.payload === 'true';
      localStorage.setItem('hrms_voice_enabled', state.voiceEnabled ? 'true' : 'false');
    },
    setVoiceVolume: (state, action) => {
      state.voiceVolume = clampVoiceVolume(action.payload);
      localStorage.setItem('hrms_voice_volume', String(state.voiceVolume));
    },
    setSelectedVoice: (state, action) => {
      state.selectedVoice = String(action.payload || '');
      localStorage.setItem('hrms_selected_voice', state.selectedVoice);
    },
    showToast: (state, action) => {
      const { message, type = 'info', id = Date.now() } = action.payload;
      state.toasts.push({ id, message, type });
    },
    hideToast: (state, action) => {
      const id = action.payload;
      state.toasts = state.toasts.filter(t => t.id !== id);
    },
  },
});

export const {
  loginSuccess,
  logoutSuccess,
  toggleTheme,
  setTheme,
  toggleNotificationSound,
  setSoundEnabled,
  setVoiceEnabled,
  setVoiceVolume,
  setSelectedVoice,
  showToast,
  hideToast
} = authSlice.actions;

// Async thunk action to handle auto-expiring toasts
export const addToast = (message, type = 'info') => (dispatch) => {
  const id = Date.now();
  dispatch(showToast({ id, message, type }));
  setTimeout(() => {
    dispatch(hideToast(id));
  }, 3000);
};

export default authSlice.reducer;
