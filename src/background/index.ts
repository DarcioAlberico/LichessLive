/**
 * Service worker (SPEC 8.2): tarefas curtas, roteamento e restauração de estado persistido.
 * Não mantém streams nem estado em variáveis globais — o Chrome pode encerrá-lo por inatividade.
 * O alarme nominal de 30 s desperta o painel de operação para as coletas (Chrome 120+).
 */
import type { RuntimeMessage } from '../shared/protocol/messages';
import { parseRuntimeMessage } from '../shared/protocol/messages';

const STUDIO_PATH = 'studio.html';
const ALARM = 'lts-tick';
const tabKey = (tabId: number) => `tab:${tabId}`;

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

async function findStudioWindow(): Promise<number | null> {
  const url = chrome.runtime.getURL(STUDIO_PATH);
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.TAB],
      documentUrls: [url],
    });
    const ctx = contexts.find((c) => typeof c.windowId === 'number' && c.windowId >= 0);
    return ctx ? ctx.windowId : null;
  } catch {
    return null;
  }
}

async function openOrFocusStudio(): Promise<void> {
  const windowId = await findStudioWindow();
  if (windowId !== null) {
    await chrome.windows.update(windowId, { focused: true, state: 'normal' }).catch(() => undefined);
    return;
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL(STUDIO_PATH),
    type: 'popup',
    width: 1180,
    height: 900,
    focused: true,
  });
}

async function setTabActive(tabId: number, active: boolean): Promise<void> {
  if (active) await chrome.storage.session.set({ [tabKey(tabId)]: { active: true, since: Date.now() } });
  else await chrome.storage.session.remove(tabKey(tabId));
}

async function isTabActive(tabId: number): Promise<boolean> {
  const data = await chrome.storage.session.get(tabKey(tabId));
  const v = data[tabKey(tabId)] as { active?: boolean } | undefined;
  return v?.active === true;
}

async function setBroadcast(tabId: number, active: boolean): Promise<unknown> {
  await setTabActive(tabId, active);
  if (active) await openOrFocusStudio();
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: active ? 'lts:activate' : 'lts:deactivate',
    } satisfies RuntimeMessage);
  } catch {
    // Aba sem content script (página não suportada ou recarregando).
    if (active) await setTabActive(tabId, false);
    return { active: false, recognition: 'incompatible' };
  }
}

async function activeLichessTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://lichess.org/')) return null;
  return tab.id;
}

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  // Desperta o painel de operação; sem painel aberto, nada a fazer.
  chrome.runtime.sendMessage({ type: 'lts:tick' } satisfies RuntimeMessage).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    if (command === 'toggle-broadcast') {
      const tabId = await activeLichessTabId();
      if (tabId === null) return;
      await setBroadcast(tabId, !(await isTabActive(tabId)));
    } else if (command === 'flip-board' || command === 'pin-game') {
      const cmd = command === 'flip-board' ? 'flip' : 'pin';
      chrome.runtime
        .sendMessage({ type: 'lts:command', command: cmd } satisfies RuntimeMessage)
        .catch(() => undefined);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(tabKey(tabId));
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  // Apenas contextos desta extensão; mensagens só acionam operações permitidas com IDs validados.
  if (sender.id !== chrome.runtime.id) return false;
  const msg = parseRuntimeMessage(raw);
  if (!msg) return false;
  const respond = (p: Promise<unknown>) => {
    p.then(sendResponse, (err: unknown) =>
      sendResponse({ error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  };
  switch (msg.type) {
    case 'lts:openStudio':
      return respond(openOrFocusStudio().then(() => ({ ok: true })));
    case 'lts:toggleBroadcast':
      return respond(isTabActive(msg.tabId).then((a) => setBroadcast(msg.tabId, !a)));
    case 'lts:setBroadcast':
      return respond(setBroadcast(msg.tabId, msg.active));
    case 'lts:getTabState': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      return respond(isTabActive(tabId).then((active) => ({ active })));
    }
    case 'lts:setTabActive': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      return respond(setTabActive(tabId, msg.active).then(() => ({ ok: true })));
    }
    case 'lts:resizeProgramWindow':
      return respond(
        (async () => {
          const tab = await chrome.tabs.get(msg.tabId);
          if (!tab.url?.startsWith('https://lichess.org/')) throw new Error('Aba não é do Lichess');
          await chrome.windows.update(tab.windowId, {
            state: 'normal',
            width: msg.width,
            height: msg.height,
          });
          return { ok: true };
        })(),
      );
    default:
      return false;
  }
});
