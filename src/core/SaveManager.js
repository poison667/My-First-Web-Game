import { CONFIG } from '../config.js';

// Handles localStorage persistence for game state and settings.
export const SaveManager = {
  save(state) {
    try {
      localStorage.setItem(CONFIG.saveKey, JSON.stringify(state));
      return true;
    } catch (e) { console.error('Save failed', e); return false; }
  },
  load() {
    try {
      const raw = localStorage.getItem(CONFIG.saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { console.error('Load failed', e); return null; }
  },
  hasSave() { return !!localStorage.getItem(CONFIG.saveKey); },
  clear() { localStorage.removeItem(CONFIG.saveKey); },

  loadSettings() {
    try {
      const raw = localStorage.getItem(CONFIG.settingsKey);
      return raw ? { ...CONFIG.defaultSettings, ...JSON.parse(raw) } : { ...CONFIG.defaultSettings };
    } catch { return { ...CONFIG.defaultSettings }; }
  },
  saveSettings(s) {
    try { localStorage.setItem(CONFIG.settingsKey, JSON.stringify(s)); } catch {}
  },
};
