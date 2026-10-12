/**
 * Popup da ação: apenas inicia, foca ou encerra a sessão (SPEC 8.2). Fechá-lo não interrompe
 * a transmissão, pois os streams vivem na janela de operação.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { recognizeUrl } from '../domain/entities/tournament';
import type { RuntimeMessage } from '../shared/protocol/messages';

interface TabStatus {
  tabId: number | null;
  recognition: 'tournament' | 'swiss' | 'incompatible' | 'unknown';
  active: boolean;
}

async function currentStatus(): Promise<TabStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return { tabId: null, recognition: 'unknown', active: false };
  const rec = recognizeUrl(tab.url);
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: 'lts:status' } satisfies RuntimeMessage)) as
      { active?: boolean } | undefined;
    return { tabId: tab.id, recognition: rec.kind, active: res?.active === true };
  } catch {
    return { tabId: tab.id, recognition: rec.kind, active: false };
  }
}

function Popup() {
  const [status, setStatus] = useState<TabStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void currentStatus().then(setStatus);
  useEffect(refresh, []);

  const send = async (msg: RuntimeMessage) => {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage(msg);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const version = chrome.runtime.getManifest().version;
  const canActivate =
    status?.tabId != null && (status.recognition === 'tournament' || status.recognition === 'swiss');

  return (
    <main>
      <h1>Lichess Team Studio</h1>
      <p class="muted">Versão {version}</p>
      {!status ? <p>Verificando a aba…</p> : null}
      {status && status.recognition === 'incompatible' ? (
        <p>Abra a página de um torneio Arena do Lichess para ativar o modo transmissão.</p>
      ) : null}
      {status && status.recognition === 'unknown' ? <p>Aba sem endereço acessível.</p> : null}
      {status && status.recognition === 'swiss' ? (
        <p>Torneio Swiss reconhecido — não suportado na versão 1.0.</p>
      ) : null}
      {canActivate ? (
        status!.active ? (
          <button
            disabled={busy}
            onClick={() => void send({ type: 'lts:setBroadcast', tabId: status!.tabId!, active: false })}
          >
            Desativar modo transmissão
          </button>
        ) : (
          <button
            class="primary"
            disabled={busy}
            onClick={() => void send({ type: 'lts:setBroadcast', tabId: status!.tabId!, active: true })}
          >
            Ativar modo transmissão
          </button>
        )
      ) : null}
      <button disabled={busy} onClick={() => void send({ type: 'lts:openStudio' })}>
        Abrir painel de operação
      </button>
      <button onClick={() => void chrome.runtime.openOptionsPage()}>Cadastro e configurações</button>
      <p class="muted small">
        Atalho: Alt+Shift+T alterna a transmissão (remapeável em chrome://extensions/shortcuts).
      </p>
    </main>
  );
}

render(<Popup />, document.getElementById('app')!);
