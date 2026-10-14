/**
 * Content script (mundo isolado) para /tournament/* e /swiss/*. Reconhece a página, monta a
 * composição sob demanda e troca mensagens com o painel de operação por um Port. Não acessa
 * variáveis internas do Lichess, não intercepta WebSocket e não faz requisições à API.
 */
import { render } from 'preact';
import { ProgramOverlay } from '../adapters/page/overlay';
import { recognizePage } from '../adapters/page/recognizePage';
import type { PanelLink } from '../presentation/components/ProgramApp';
import { ProgramApp } from '../presentation/components/ProgramApp';
import { ErrorBoundary } from '../presentation/components/ErrorBoundary';
import { ROOT_ID } from '../adapters/page/selectors';
import { PROGRAM_CSS } from '../presentation/components/programCss';
import type { ProgramViewModel } from '../presentation/viewModels/types';
import type {
  ProgramIntent,
  ProgramToStudio,
  RuntimeMessage,
  StudioToProgram,
} from '../shared/protocol/messages';
import {
  PROGRAM_PORT,
  PROTOCOL_VERSION,
  nextRequestId,
  parseRuntimeMessage,
  parseStudioMessage,
} from '../shared/protocol/messages';
import { base64ToBytes } from '../shared/encoding';

const VERSION = chrome.runtime.getManifest().version;
const RECONNECT_MS = 3000;

class ProgramController {
  private overlay = new ProgramOverlay(document, PROGRAM_CSS);
  private container: HTMLElement | null = null;
  private port: chrome.runtime.Port | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private vm: ProgramViewModel | null = null;
  private panel: PanelLink = 'connecting';
  private unsupported: string | null = null;
  private sessionId: string | null = null;
  private generation = 0;
  private readonly photoUrls = new Map<string, string>();
  private readonly requestedPhotos = new Set<string>();
  private renderSamples: number[] = [];
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUrl = location.href;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  active = false;
  /** Último erro de ativação ou desenho (mostrado no popup e no console). */
  lastError: string | null = null;

  private reportError(stage: string, err: unknown): void {
    this.lastError = `${stage}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
    console.error('[Lichess Team Studio]', stage, err);
  }

  activate(): void {
    if (this.active) {
      // Ativo mas sem composição na página (root removido ou desenho falhou): remonta.
      if (document.getElementById(ROOT_ID)) return;
      this.deactivate(false);
    }
    this.lastError = null;
    try {
      const { container } = this.overlay.mount(() => this.draw());
      this.container = container;
    } catch (err) {
      this.reportError('montagem', err);
      try {
        this.overlay.unmount();
      } catch {
        /* nada a restaurar */
      }
      void chrome.runtime
        .sendMessage({ type: 'lts:setTabActive', active: false } satisfies RuntimeMessage)
        .catch(() => undefined);
      return;
    }
    this.active = true;
    this.panel = 'connecting';
    this.draw();
    this.connect();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey, true);
    this.metricsTimer = setInterval(() => this.flushMetrics(), 10_000);
    this.urlTimer = setInterval(() => this.checkUrl(), 1000);
    void chrome.runtime
      .sendMessage({ type: 'lts:setTabActive', active: true } satisfies RuntimeMessage)
      .catch(() => undefined);
  }

  deactivate(notify = true): void {
    if (!this.active) return;
    this.active = false;
    this.send({ type: 'bye' });
    this.disconnect();
    if (this.container) render(null, this.container);
    this.container = null;
    this.overlay.unmount();
    for (const url of this.photoUrls.values()) URL.revokeObjectURL(url);
    this.photoUrls.clear();
    this.requestedPhotos.clear();
    this.vm = null;
    this.unsupported = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey, true);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.urlTimer) clearInterval(this.urlTimer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.metricsTimer = null;
    this.urlTimer = null;
    if (notify)
      void chrome.runtime
        .sendMessage({ type: 'lts:setTabActive', active: false } satisfies RuntimeMessage)
        .catch(() => undefined);
  }

  private connect(): void {
    if (!this.active || this.port) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PROGRAM_PORT });
    } catch {
      // Contexto da extensão invalidado (atualização/recarga): não há como reconectar.
      this.panel = 'disconnected';
      this.draw();
      return;
    }
    this.port = port;
    port.onMessage.addListener((raw: unknown) => this.onStudioMessage(raw));
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      this.port = null;
      this.panel = 'disconnected';
      this.draw();
      this.scheduleReconnect();
    });
    this.send({ type: 'hello', page: recognizePage(document, window) });
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.port?.disconnect();
    } catch {
      /* já desconectado */
    }
    this.port = null;
  }

  private send(
    body: DistributiveOmit<
      ProgramToStudio,
      'protocolVersion' | 'sessionId' | 'tournamentId' | 'requestId' | 'generation'
    >,
  ): void {
    if (!this.port) return;
    const page = recognizePage(document, window);
    const msg = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      tournamentId: page.tournamentId,
      requestId: nextRequestId(),
      generation: this.generation,
      ...body,
    };
    try {
      this.port.postMessage(msg);
    } catch {
      this.port = null;
      this.panel = 'disconnected';
      this.scheduleReconnect();
    }
  }

  private onStudioMessage(raw: unknown): void {
    const msg: StudioToProgram | null = parseStudioMessage(raw);
    if (!msg) return;
    const t0 = performance.now();
    switch (msg.type) {
      case 'welcome':
        // Nova conexão com o painel: a geração recomeça a partir do que o painel enviar.
        this.panel = 'connected';
        this.sessionId = null;
        this.generation = 0;
        break;
      case 'unsupported':
        this.panel = 'connected';
        this.unsupported = msg.message;
        break;
      case 'vm': {
        // Ignora mensagens atrasadas de uma seleção anterior.
        if (!msg.full && msg.sessionId === this.sessionId && msg.generation < this.generation) return;
        this.panel = 'connected';
        this.unsupported = null;
        this.sessionId = msg.sessionId;
        this.generation = msg.generation;
        this.vm =
          msg.full || !this.vm
            ? ({ ...(this.vm ?? {}), ...msg.patch } as ProgramViewModel)
            : { ...this.vm, ...msg.patch };
        this.requestMissingPhotos();
        break;
      }
      case 'photos':
        for (const p of msg.photos) {
          const old = this.photoUrls.get(p.photoId);
          if (old) URL.revokeObjectURL(old);
          const bytes = base64ToBytes(p.base64);
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: p.mime }));
          this.photoUrls.set(p.photoId, url);
        }
        break;
    }
    this.draw();
    requestAnimationFrame(() => {
      this.renderSamples.push(performance.now() - t0);
      if (this.renderSamples.length > 500) this.renderSamples.shift();
    });
  }

  private requestMissingPhotos(): void {
    const vm = this.vm;
    if (!vm?.main || !vm.tabs) return;
    const ids = new Set<string>();
    if (vm.main.white?.photoId) ids.add(vm.main.white.photoId);
    if (vm.main.black?.photoId) ids.add(vm.main.black.photoId);
    for (const r of vm.tabs.team.rows) if (r.photoId) ids.add(r.photoId);
    for (const r of vm.tabs.progress.rows) if (r.photoId) ids.add(r.photoId);
    const missing = [...ids].filter((id) => !this.photoUrls.has(id) && !this.requestedPhotos.has(id));
    if (missing.length === 0) return;
    for (const id of missing) this.requestedPhotos.add(id);
    this.send({ type: 'photoRequest', photoIds: missing });
  }

  private photoUrl = (photoId: string | null): string | null =>
    photoId ? (this.photoUrls.get(photoId) ?? null) : null;

  private onIntent = (intent: ProgramIntent): void => {
    this.send({ type: 'intent', intent });
  };

  private draw(): void {
    if (!this.container || !this.active) return;
    const vmReady =
      this.vm && this.vm.main && this.vm.tabs && this.vm.layout && this.vm.top && this.vm.footer
        ? this.vm
        : null;
    try {
      render(
        <ErrorBoundary onError={(err) => this.reportError('desenho', err)}>
          <ProgramApp
            vm={vmReady}
            photoUrl={this.photoUrl}
            onIntent={this.onIntent}
            panel={this.panel}
            unsupported={this.unsupported}
            onOpenPanel={() =>
              void chrome.runtime
                .sendMessage({ type: 'lts:openStudio' } satisfies RuntimeMessage)
                .catch(() => undefined)
            }
            onExit={() => this.deactivate()}
            version={VERSION}
          />
        </ErrorBoundary>,
        this.container,
      );
    } catch (err) {
      this.reportError('desenho', err);
      this.container.textContent = `Lichess Team Studio — erro ao desenhar a composição: ${this.lastError ?? ''}`;
    }
  }

  private onResize = (): void => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(
      () => this.send({ type: 'viewport', page: recognizePage(document, window) }),
      300,
    );
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (this.vm?.layout && !this.vm.layout.inPageShortcuts) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      this.onIntent({ type: 'flip' });
    } else if (key === 'p') {
      e.preventDefault();
      this.onIntent({ type: 'pin' });
    }
  };

  private flushMetrics(): void {
    if (this.renderSamples.length === 0) return;
    this.send({ type: 'metrics', renderMs: this.renderSamples.splice(0) });
  }

  private checkUrl(): void {
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    // Mudança de URL por histórico: reapresenta a página ao painel (novo torneio ou página incompatível).
    this.vm = null;
    this.sessionId = null;
    this.generation = 0;
    this.disconnect();
    this.panel = 'connecting';
    this.draw();
    this.connect();
  }

  status() {
    const page = recognizePage(document, window);
    return {
      // "Ativo" só quando a composição está de fato na página.
      active: this.active && document.getElementById(ROOT_ID) !== null,
      error: this.lastError,
      recognition: page.recognition,
      tournamentId: page.tournamentId,
      panel: this.panel,
      diagnostic: this.active ? this.overlayDiagnostic() : null,
    };
  }

  /** Estado real da composição na página (exibido no popup para diagnóstico). */
  private overlayDiagnostic(): string {
    const host = document.getElementById(ROOT_ID);
    if (!host) return 'composição ausente da página';
    const r = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const shadow = host.shadowRoot;
    const app = shadow?.querySelector<HTMLElement>('.lts-app, .lts-center-msg');
    const ar = app?.getBoundingClientRect();
    const cx = Math.round(window.innerWidth / 2);
    const cy = Math.round(window.innerHeight / 2);
    const top = document.elementFromPoint(cx, cy);
    const topText =
      top === host
        ? 'composição'
        : top
          ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}${typeof top.className === 'string' && top.className ? '.' + top.className.split(' ')[0] : ''}`
          : 'nenhum';
    return [
      `camada ${Math.round(r.width)}×${Math.round(r.height)} ${cs.display}/${cs.visibility}/op ${cs.opacity}/z ${cs.zIndex}`,
      `estilos ${shadow?.adoptedStyleSheets.length ?? 0}`,
      app
        ? `conteúdo ${app.className.split(' ')[0]} ${Math.round(ar!.width)}×${Math.round(ar!.height)} fundo ${getComputedStyle(app).backgroundColor}`
        : 'conteúdo não desenhado',
      `no centro: ${topText}`,
      `filhos de <html>: ${[...document.documentElement.children].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')).join(',')}`,
    ].join(' · ');
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const controller = new ProgramController();

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const msg = parseRuntimeMessage(raw);
  if (!msg) return false;
  switch (msg.type) {
    case 'lts:activate':
      controller.activate();
      sendResponse(controller.status());
      return false;
    case 'lts:deactivate':
      controller.deactivate();
      sendResponse(controller.status());
      return false;
    case 'lts:status':
      sendResponse(controller.status());
      return false;
    default:
      return false;
  }
});

// Restaura o modo transmissão após atualizar a página (estado por aba no service worker).
chrome.runtime
  .sendMessage({ type: 'lts:getTabState' } satisfies RuntimeMessage)
  .then((res: unknown) => {
    if (res && typeof res === 'object' && (res as { active?: unknown }).active === true)
      controller.activate();
  })
  .catch(() => undefined);

window.addEventListener('pagehide', () => controller.deactivate(false));
