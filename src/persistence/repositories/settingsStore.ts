import type { SettingsStore } from '../../application/ports';
import type { Settings } from '../../shared/settings';
import { sanitizeSettings } from '../../shared/settings';

const KEY = 'settings';

/** Preferências em chrome.storage.local (nunca em storage.sync). */
export class ChromeSettingsStore implements SettingsStore {
  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async get(): Promise<Settings> {
    const data = await this.area.get(KEY);
    return sanitizeSettings(data[KEY]);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = sanitizeSettings({
      ...current,
      ...patch,
      retention: { ...current.retention, ...(patch.retention ?? {}) },
    });
    await this.area.set({ [KEY]: next });
    return next;
  }
}

/** Implementação em memória (testes e contextos sem chrome.storage). */
export class MemorySettingsStore implements SettingsStore {
  private value: Settings = sanitizeSettings({});
  async get() {
    return this.value;
  }
  async update(patch: Partial<Settings>) {
    this.value = sanitizeSettings({
      ...this.value,
      ...patch,
      retention: { ...this.value.retention, ...(patch.retention ?? {}) },
    });
    return this.value;
  }
}
