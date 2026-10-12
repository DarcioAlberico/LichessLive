/** Utilitários de páginas da extensão (painel e configurações). */
import type { RuntimeMessage } from './protocol/messages';

const PAUSE_KEY = 'restPauseUntil';

/** Pausa global compartilhada entre contextos (painel e configurações) via storage.local. */
export class StoragePause {
  private value = 0;
  constructor() {
    void chrome.storage.local.get(PAUSE_KEY).then((d) => {
      const v = d[PAUSE_KEY];
      if (typeof v === 'number') this.value = Math.max(this.value, v);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[PAUSE_KEY] && typeof changes[PAUSE_KEY].newValue === 'number') {
        this.value = Math.max(this.value, changes[PAUSE_KEY].newValue as number);
      }
    });
  }
  read(): number {
    return this.value;
  }
  write(until: number): void {
    if (until <= this.value) return;
    this.value = until;
    void chrome.storage.local.set({ [PAUSE_KEY]: until });
  }
}

export function notifyDataChanged(
  scope: Extract<RuntimeMessage, { type: 'lts:dataChanged' }>['scope'],
): void {
  void chrome.runtime
    .sendMessage({ type: 'lts:dataChanged', scope } satisfies RuntimeMessage)
    .catch(() => undefined);
}

export function downloadBytes(bytes: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([typeof bytes === 'string' ? bytes : (bytes as BlobPart)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
