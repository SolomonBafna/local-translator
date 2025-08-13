import { browser } from 'wxt/browser';

export interface StoredSettings {
  enabled: boolean;
  displayMode: 'overlay' | 'replace';
  textDecoration: 'normal' | 'underline' | 'underline dashed' | 'underline dotted';
}

const DEFAULT_SETTINGS: StoredSettings = {
  enabled: true, // Enable by default
  displayMode: 'overlay',
  textDecoration: 'normal',
};

export const storage = {
  async getSettings(): Promise<StoredSettings> {
    try {
      const result = await browser.storage.local.get('settings');
      if (result.settings) {
        return { ...DEFAULT_SETTINGS, ...result.settings };
      }
      return DEFAULT_SETTINGS;
    } catch (error) {
      console.error('[Storage] Failed to get settings:', error);
      return DEFAULT_SETTINGS;
    }
  },

  async saveSettings(settings: Partial<StoredSettings>): Promise<void> {
    try {
      const current = await this.getSettings();
      const updated = { ...current, ...settings };
      await browser.storage.local.set({ settings: updated });
      console.log('[Storage] Settings saved:', updated);
    } catch (error) {
      console.error('[Storage] Failed to save settings:', error);
    }
  },

  async updateSetting<K extends keyof StoredSettings>(
    key: K,
    value: StoredSettings[K]
  ): Promise<void> {
    await this.saveSettings({ [key]: value });
  },

  // Listen for storage changes
  onChanged(callback: (settings: StoredSettings) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.settings) {
        callback(changes.settings.newValue || DEFAULT_SETTINGS);
      }
    });
  },
};