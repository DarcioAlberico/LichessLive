/**
 * Execução da janela de operação (SPEC 8.2): dona dos streams de longa duração, da fila REST e do
 * acesso aos dados locais. O content script recebe ViewModels por Port. Uma única janela é dona da
 * sessão no perfil (Web Locks); outras instâncias ficam em modo espelho informativo.
 */
import { LichessClient } from '../adapters/lichess/rest/lichessClient';
import { isAbortError, RateLimitedError, RestQueue } from '../adapters/lichess/rest/restQueue';
import { GameStreamHub } from '../adapters/lichess/streams/streamHub';
import type { Repositories } from '../application/ports';
import { SessionCoordinator } from '../application/session/sessionCoordinator';
import { createMetrics, DiagnosticsLog } from '../diagnostics';
import type { Metrics } from '../diagnostics';
import type { Persistence } from '../persistence';
import { openPersistence } from '../persistence';
import type { RuntimeMessage, StudioToProgram } from '../shared/protocol/messages';
import { StoragePause } from '../shared/extension';
import { PROGRAM_PORT, parseProgramMessage, parseRuntimeMessage } from '../shared/protocol/messages';
import type { Settings } from '../shared/settings';
import { newId } from '../shared/validate';
import { monotonicNow } from '../shared/time';

export interface StudioRuntime {
  persistence: Persistence;
  repos: Repositories;
  queue: RestQueue;
  client: LichessClient;
  hub: GameStreamHub;
  log: DiagnosticsLog;
  metrics: Metrics;
  coordinator: SessionCoordinator;
  settings: () => Settings;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  owner: boolean;
  version: string;
  dispose: () => void;
}

export async function startStudioRuntime(): Promise<StudioRuntime> {
  const version = chrome.runtime.getManifest().version;
  const log = new DiagnosticsLog();
  const metrics = createMetrics();
  const persistence = await openPersistence();
  if (persistence.open.migrationError) {
    log.error('persistence', 'falha de migração; dados preservados na versão anterior', {
      error: persistence.open.migrationError,
    });
  }
  const repos = persistence.repos;
  let settings = await repos.settings.get();
  const pause = new StoragePause();
  const queue = new RestQueue({ fetchImpl: (...a) => fetch(...a), sharedPause: pause });
  const client = new LichessClient(queue);
  const hub = new GameStreamHub({
    fetchImpl: (...a) => fetch(...a),
    pause: { until: () => pause.read(), set: (until) => pause.write(until) },
  });
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const coordinator = new SessionCoordinator({
    lichess: client,
    streams: hub,
    rest: {
      pausedUntil: () => Math.max(pause.read(), queue.state().pausedUntil ?? 0),
      frequencyFactor: () => queue.frequencyFactor(),
      lastError: () => queue.state().lastError,
      lastSuccessAt: () => queue.state().lastSuccessAt,
    },
    repos,
    log,
    metrics,
    now: Date.now,
    monotonic: monotonicNow,
    isRateLimitError: (e) => e instanceof RateLimitedError,
    isAbortError,
    getSettings: () => settings,
    appVersion: version,
    reducedMotion: () => reducedMotionQuery.matches,
  });
  coordinator.setCustomPresets(await repos.presets.list());

  // Uma única janela proprietária por perfil do Chrome.
  const owner = await new Promise<boolean>((resolve) => {
    if (!('locks' in navigator)) return resolve(true);
    void navigator.locks.request('lts-studio-owner', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      return new Promise<void>(() => undefined); // mantém o lock enquanto a janela existir
    });
  });

  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== PROGRAM_PORT) return;
    const sender = port.sender;
    if (sender?.id !== chrome.runtime.id || !sender.url?.startsWith('https://lichess.org/')) {
      port.disconnect();
      return;
    }
    const channelId = newId();
    let attached = false;
    const channel = {
      id: channelId,
      tabId: sender.tab?.id ?? null,
      post: (msg: StudioToProgram) => port.postMessage(msg),
    };
    port.onMessage.addListener((raw: unknown) => {
      const msg = parseProgramMessage(raw);
      if (!msg) {
        log.warn('protocol', 'mensagem do programa rejeitada');
        return;
      }
      if (msg.type === 'hello' && !attached) {
        attached = true;
        void coordinator
          .attachProgram(channel, msg.page)
          .catch((err: unknown) => log.error('session', 'falha ao anexar programa', { error: String(err) }));
        log.info('protocol', 'programa conectado', { detail: msg.page.url });
        return;
      }
      void coordinator.handleProgramMessage(channelId, msg);
    });
    port.onDisconnect.addListener(() => {
      coordinator.detachProgram(channelId);
      log.info('protocol', 'programa desconectado');
    });
  };

  const onMessage = (raw: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id) return false;
    const msg: RuntimeMessage | null = parseRuntimeMessage(raw);
    if (!msg) return false;
    if (msg.type === 'lts:tick') coordinator.tick();
    else if (msg.type === 'lts:command') {
      const s = coordinator.focused;
      if (s && msg.command === 'flip') s.flip();
      else if (s) s.pin();
    } else if (msg.type === 'lts:dataChanged') {
      void (async () => {
        if (msg.scope === 'settings' || msg.scope === 'all') {
          settings = await repos.settings.get();
          coordinator.updateSettings(settings);
        }
        if (msg.scope === 'presets' || msg.scope === 'all')
          coordinator.setCustomPresets(await repos.presets.list());
        await coordinator.reloadLocalData();
      })();
    }
    return false;
  };

  if (owner) {
    chrome.runtime.onConnect.addListener(onConnect);
    chrome.runtime.onMessage.addListener(onMessage);
  } else {
    log.warn('session', 'outra janela de operação já está ativa; esta janela não controla a sessão');
  }

  const ticker = setInterval(() => coordinator.tick(), 1000);
  const dispose = () => {
    clearInterval(ticker);
    chrome.runtime.onConnect.removeListener(onConnect);
    chrome.runtime.onMessage.removeListener(onMessage);
    coordinator.dispose();
    hub.closeAll();
    queue.dispose();
  };
  window.addEventListener('pagehide', dispose);

  return {
    persistence,
    repos,
    queue,
    client,
    hub,
    log,
    metrics,
    coordinator,
    settings: () => settings,
    setSettings: async (patch) => {
      settings = await repos.settings.update(patch);
      coordinator.updateSettings(settings);
      return settings;
    },
    owner,
    version,
    dispose,
  };
}
