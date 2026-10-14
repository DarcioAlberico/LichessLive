import type { TournamentId } from '../../domain/entities/ids';
import { asTournamentId } from '../../domain/entities/ids';
import type { LayoutPreset, TournamentSessionRecord } from '../../domain/entities/profiles';
import { RULES_VERSION } from '../../domain/ranking/progress';
import { DEFAULT_PRESET, builtInPreset } from '../../presentation/layouts/presets';
import type { ProgramViewModel } from '../../presentation/viewModels/types';
import { PROGRAM_VM_SECTIONS } from '../../presentation/viewModels/types';
import type {
  PageInfo,
  PhotoPayload,
  ProgramToStudio,
  StudioToProgram,
} from '../../shared/protocol/messages';
import { PROTOCOL_VERSION, nextRequestId } from '../../shared/protocol/messages';
import type { Settings } from '../../shared/settings';
import { bytesToBase64 } from '../../shared/encoding';
import { newId } from '../../shared/validate';
import { buildProgramViewModel } from './programViewModel';
import type { SessionContext } from './tournamentSession';
import { TournamentSession } from './tournamentSession';

/**
 * SessionCoordinator (SPEC 8.3): uma única sessão proprietária por torneio no perfil do Chrome;
 * contextos adicionais (outras abas do mesmo torneio) espelham a sessão. Publica ViewModels por
 * seção alterada, com coalescência, e entrega fotos já normalizadas sob demanda.
 */

export interface ProgramChannel {
  readonly id: string;
  post(msg: StudioToProgram): void;
  /** ID da aba (para redimensionar a janela de programa). */
  readonly tabId: number | null;
}

interface ProgramEntry {
  channel: ProgramChannel;
  tournamentId: TournamentId | null;
  page: PageInfo;
  lastSent: Map<string, string>;
  sentPhotos: Set<string>;
  connectedAt: number;
}

export type SessionChoice = 'auto' | 'continue' | 'new';

export interface CoordinatorDeps extends SessionContext {
  getSettings: () => Settings;
  appVersion: string;
  /** Sessões com mais de 12 h sem continuidade iniciam nova sessão no modo automático. */
  autoContinueMaxAgeMs?: number;
  publishDelayMs?: number;
  reducedMotion?: () => boolean;
}

export class SessionCoordinator {
  readonly sessions = new Map<TournamentId, TournamentSession>();
  readonly programs = new Map<string, ProgramEntry>();
  private readonly publishTimers = new Map<TournamentId, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly starting = new Map<TournamentId, Promise<TournamentSession>>();
  private customPresets = new Map<string, LayoutPreset>();
  /** Torneio mostrado no painel de operação. */
  focusedTournamentId: TournamentId | null = null;
  lastRenderSamples: number[] = [];

  constructor(private readonly deps: CoordinatorDeps) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  setCustomPresets(presets: LayoutPreset[]): void {
    this.customPresets = new Map(presets.map((p) => [p.presetId, p]));
    for (const id of this.sessions.keys()) this.schedulePublish(id, true);
  }

  presetFor(id: string): LayoutPreset {
    return this.customPresets.get(id) ?? builtInPreset(id) ?? DEFAULT_PRESET;
  }

  get focused(): TournamentSession | null {
    return this.focusedTournamentId ? (this.sessions.get(this.focusedTournamentId) ?? null) : null;
  }

  // ------------------------------------------------------------------ sessões

  async ensureSession(
    tournamentId: TournamentId,
    choice: SessionChoice = 'auto',
  ): Promise<TournamentSession> {
    const existing = this.sessions.get(tournamentId);
    if (existing && choice === 'auto') return existing;
    const pending = this.starting.get(tournamentId);
    if (pending) return pending;
    const promise = this.createSession(tournamentId, choice).finally(() =>
      this.starting.delete(tournamentId),
    );
    this.starting.set(tournamentId, promise);
    return promise;
  }

  private async createSession(tournamentId: TournamentId, choice: SessionChoice): Promise<TournamentSession> {
    const settings = this.deps.getSettings();
    const previous = await this.deps.repos.sessions.latestForTournament(tournamentId);
    const maxAge = this.deps.autoContinueMaxAgeMs ?? 12 * 3_600_000;
    let record: TournamentSessionRecord;
    const canContinue = previous && previous.rulesVersion === RULES_VERSION;
    const continueIt =
      choice === 'continue'
        ? !!canContinue
        : choice === 'auto'
          ? !!canContinue && this.deps.now() - previous!.startedAt < maxAge
          : false;
    if (continueIt && previous) {
      record = previous;
      this.deps.log.info('session', 'sessão anterior continuada', { detail: previous.sessionId });
    } else {
      const teamId = previous?.teamId ?? null;
      record = {
        sessionId: newId(),
        tournamentId,
        type: 'unknown',
        teamId: teamId ?? null,
        startedAt: this.deps.now(),
        referenceMode: 'sessionStart',
        referenceId: newId(),
        referenceMarkedAt: null,
        rulesVersion: RULES_VERSION,
        finishedAt: null,
      };
      await this.deps.repos.sessions.put(record);
      this.deps.log.info('session', 'nova sessão iniciada', { detail: record.sessionId });
    }
    const old = this.sessions.get(tournamentId);
    old?.dispose();
    const session = new TournamentSession(this.deps, record, settings);
    this.sessions.set(tournamentId, session);
    session.onChange((kind) => {
      this.schedulePublish(tournamentId, kind === 'board' || kind === 'selection');
      this.notify();
    });
    if (!this.focusedTournamentId) this.focusedTournamentId = tournamentId;
    // Recomeça a entrega de seções para os programas deste torneio.
    for (const p of this.programs.values()) if (p.tournamentId === tournamentId) p.lastSent.clear();
    await session.start();
    this.notify();
    return session;
  }

  /** Reinicia a sessão do torneio: continuar a referência anterior ou iniciar outra. */
  async restartSession(tournamentId: TournamentId, choice: 'continue' | 'new'): Promise<TournamentSession> {
    // Serializado com outras criações do mesmo torneio (duplo clique, reinício durante a abertura).
    const pending = this.starting.get(tournamentId);
    if (pending) await pending.catch(() => undefined);
    const promise = this.createSession(tournamentId, choice).finally(() =>
      this.starting.delete(tournamentId),
    );
    this.starting.set(tournamentId, promise);
    return promise;
  }

  closeSession(tournamentId: TournamentId): void {
    const s = this.sessions.get(tournamentId);
    if (!s) return;
    s.dispose();
    this.sessions.delete(tournamentId);
    if (this.focusedTournamentId === tournamentId)
      this.focusedTournamentId = this.sessions.keys().next().value ?? null;
    this.notify();
  }

  focus(tournamentId: TournamentId): void {
    if (this.sessions.has(tournamentId)) {
      this.focusedTournamentId = tournamentId;
      this.notify();
    }
  }

  tick(): void {
    for (const s of this.sessions.values()) s.tick();
  }

  updateSettings(settings: Settings): void {
    for (const s of this.sessions.values()) s.updateSettings(settings);
  }

  async reloadLocalData(): Promise<void> {
    for (const s of this.sessions.values()) await s.reloadLocalData();
    for (const p of this.programs.values()) p.sentPhotos.clear();
    for (const id of this.sessions.keys()) this.schedulePublish(id, true);
  }

  dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    for (const t of this.publishTimers.values()) clearTimeout(t);
    this.publishTimers.clear();
  }

  // ------------------------------------------------------------------ programas (content scripts)

  async attachProgram(channel: ProgramChannel, page: PageInfo): Promise<void> {
    const tournamentId = page.recognition === 'tournament' ? asTournamentId(page.tournamentId) : null;
    const entry: ProgramEntry = {
      channel,
      tournamentId,
      page,
      lastSent: new Map(),
      sentPhotos: new Set(),
      connectedAt: this.deps.now(),
    };
    this.programs.set(channel.id, entry);
    channel.post({
      ...this.envelope(tournamentId, null, 0),
      type: 'welcome',
      studioVersion: this.deps.appVersion,
    });
    if (page.recognition === 'swiss') {
      channel.post({
        ...this.envelope(null, null, 0),
        type: 'unsupported',
        message: 'Torneios Swiss não são suportados na versão 1.0.',
      });
      this.notify();
      return;
    }
    if (!tournamentId) {
      channel.post({
        ...this.envelope(null, null, 0),
        type: 'unsupported',
        message: 'Esta página não é um torneio Arena reconhecido.',
      });
      this.notify();
      return;
    }
    const session = await this.ensureSession(tournamentId);
    this.focusedTournamentId = tournamentId;
    this.publishNow(tournamentId, true);
    void session;
    this.notify();
  }

  detachProgram(channelId: string): void {
    this.programs.delete(channelId);
    this.notify();
  }

  programsFor(tournamentId: TournamentId): ProgramEntry[] {
    return [...this.programs.values()].filter((p) => p.tournamentId === tournamentId);
  }

  async handleProgramMessage(channelId: string, msg: ProgramToStudio): Promise<void> {
    const entry = this.programs.get(channelId);
    if (!entry) return;
    const session = entry.tournamentId ? this.sessions.get(entry.tournamentId) : undefined;
    switch (msg.type) {
      case 'viewport':
        entry.page = msg.page;
        this.notify();
        return;
      case 'intent':
        if (!session) return;
        if (msg.sessionId !== null && msg.sessionId !== session.sessionId) return;
        switch (msg.intent.type) {
          case 'selectGame':
            session.selectGame(msg.intent.gameId as never, { mode: 'pinned', explicit: false });
            return;
          case 'selectPlayer':
            void session.selectPlayer(msg.intent.userId as never, 'follow');
            return;
          case 'setTab':
            session.setTab(msg.intent.tab);
            return;
          case 'selectTeam':
            void session.selectTournamentTeam(msg.intent.teamId as never);
            return;
          case 'flip':
            session.flip();
            return;
          case 'pin':
            session.pin();
            return;
          case 'nextTeamGame':
            void session.nextTeamGame();
            return;
        }
        return;
      case 'photoRequest':
        await this.sendPhotos(entry, msg.photoIds);
        return;
      case 'metrics':
        for (const v of msg.renderMs) this.deps.metrics.eventToRender.add(v);
        return;
      case 'bye':
        this.detachProgram(channelId);
        return;
      case 'hello':
        entry.page = msg.page;
        return;
    }
  }

  private async sendPhotos(entry: ProgramEntry, photoIds: string[]): Promise<void> {
    // Mensagens de até ~4 MB, quantas forem necessárias. "missing" = foto inexistente ou inválida.
    const BATCH_BYTES = 4 * 1024 * 1024;
    let photos: PhotoPayload[] = [];
    let missing: string[] = [];
    let size = 0;
    const flush = () => {
      if (photos.length === 0 && missing.length === 0) return;
      entry.channel.post({ ...this.envelope(entry.tournamentId, null, 0), type: 'photos', photos, missing });
      photos = [];
      missing = [];
      size = 0;
    };
    for (const id of photoIds) {
      if (entry.sentPhotos.has(id)) continue;
      const asset = await this.deps.repos.photos.get(id).catch(() => undefined);
      if (!asset) {
        missing.push(id);
        continue;
      }
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      if (bytes.length > 1024 * 1024) {
        missing.push(id);
        continue;
      }
      if (size + bytes.length > BATCH_BYTES) flush();
      size += bytes.length;
      photos.push({ photoId: id, mime: asset.mime, base64: bytesToBase64(bytes) });
      entry.sentPhotos.add(id);
    }
    flush();
  }

  // ------------------------------------------------------------------ publicação de ViewModels

  private envelope(tournamentId: TournamentId | null, sessionId: string | null, generation: number) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      tournamentId,
      requestId: nextRequestId(),
      generation,
    };
  }

  schedulePublish(tournamentId: TournamentId, urgent = false): void {
    if (this.publishTimers.has(tournamentId)) return;
    const delay = urgent ? 16 : (this.deps.publishDelayMs ?? 120);
    this.publishTimers.set(
      tournamentId,
      setTimeout(() => {
        this.publishTimers.delete(tournamentId);
        this.publishNow(tournamentId, false);
      }, delay),
    );
  }

  buildViewModel(tournamentId: TournamentId): ProgramViewModel | null {
    const session = this.sessions.get(tournamentId);
    if (!session) return null;
    const settings = this.deps.getSettings();
    return buildProgramViewModel(session, {
      timezone: settings.timezone,
      preset: this.presetFor(session.presetId),
      now: this.deps.now(),
      reducedMotion: this.deps.reducedMotion?.() ?? false,
    });
  }

  publishNow(tournamentId: TournamentId, full: boolean): void {
    const targets = this.programsFor(tournamentId);
    if (targets.length === 0) return;
    const session = this.sessions.get(tournamentId);
    const vm = this.buildViewModel(tournamentId);
    if (!session || !vm) return;
    const serialized = new Map<string, string>();
    for (const key of PROGRAM_VM_SECTIONS) serialized.set(key, JSON.stringify(vm[key]));
    for (const p of targets) {
      const patch: Record<string, unknown> = {};
      let changed = false;
      // A primeira entrega a um programa é sempre completa.
      const fullForProgram = full || p.lastSent.size === 0;
      for (const key of PROGRAM_VM_SECTIONS) {
        const json = serialized.get(key)!;
        if (fullForProgram || p.lastSent.get(key) !== json) {
          patch[key] = vm[key];
          p.lastSent.set(key, json);
          changed = true;
        }
      }
      if (!changed) continue;
      try {
        p.channel.post({
          ...this.envelope(tournamentId, session.sessionId, session.selection.generation),
          type: 'vm',
          patch: patch as Partial<ProgramViewModel>,
          full: fullForProgram,
        });
      } catch {
        this.detachProgram(p.channel.id);
      }
    }
  }
}
