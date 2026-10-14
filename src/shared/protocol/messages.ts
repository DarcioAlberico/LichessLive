/**
 * Protocolo versionado entre contextos (SPEC 8.3). Toda mensagem de sessão inclui protocolVersion,
 * sessionId, tournamentId, requestId e generation. O consumidor ignora mensagens atrasadas de uma
 * seleção anterior. Mensagens recebidas só acionam operações permitidas, com IDs validados — nunca
 * fetch de URL arbitrária.
 */
import { asGameId, asTeamId, asTournamentId, normalizeUserId } from '../../domain/entities/ids';
import type { ProgramViewModel } from '../../presentation/viewModels/types';
import { isRecord } from '../validate';

export const PROTOCOL_VERSION = 1;
export const PROGRAM_PORT = 'lts-program';

export type ProgramTab = 'games' | 'team' | 'ranking' | 'progress' | 'teams';
export const PROGRAM_TABS: readonly ProgramTab[] = ['games', 'team', 'ranking', 'progress', 'teams'];

export interface Envelope {
  protocolVersion: number;
  sessionId: string | null;
  tournamentId: string | null;
  requestId: string;
  generation: number;
}

export interface PageInfo {
  url: string;
  recognition: 'tournament' | 'swiss' | 'incompatible';
  tournamentId: string | null;
  domFormatHint: 'arena' | 'teamBattle' | 'swiss' | 'unknown';
  viewport: { width: number; height: number; outerWidth: number; outerHeight: number; dpr: number };
}

// ---------------------------------------------------------------- programa → painel (Port)

export type ProgramIntent =
  | { type: 'selectGame'; gameId: string }
  | { type: 'selectPlayer'; userId: string }
  | { type: 'selectTeam'; teamId: string }
  | { type: 'setTab'; tab: ProgramTab }
  | { type: 'flip' }
  | { type: 'pin' }
  | { type: 'nextTeamGame' };

export type ProgramToStudio =
  | (Envelope & { type: 'hello'; page: PageInfo })
  | (Envelope & { type: 'viewport'; page: PageInfo })
  | (Envelope & { type: 'intent'; intent: ProgramIntent })
  | (Envelope & { type: 'photoRequest'; photoIds: string[] })
  | (Envelope & { type: 'metrics'; renderMs: number[] })
  | (Envelope & { type: 'bye' });

// ---------------------------------------------------------------- painel → programa (Port)

export interface PhotoPayload {
  photoId: string;
  mime: string;
  /** Imagem já normalizada (≤512 px), em base64. */
  base64: string;
}

export type StudioToProgram =
  | (Envelope & { type: 'welcome'; studioVersion: string })
  /** Apenas as seções alteradas são enviadas; `full` substitui o estado inteiro. */
  | (Envelope & { type: 'vm'; patch: Partial<ProgramViewModel>; full: boolean })
  | (Envelope & { type: 'photos'; photos: PhotoPayload[]; missing: string[] })
  | (Envelope & { type: 'unsupported'; message: string });

// ---------------------------------------------------------------- mensagens curtas (runtime.sendMessage)

export type RuntimeMessage =
  | { type: 'lts:openStudio' }
  | { type: 'lts:toggleBroadcast'; tabId: number }
  | { type: 'lts:setBroadcast'; tabId: number; active: boolean }
  | { type: 'lts:getTabState' }
  | { type: 'lts:setTabActive'; active: boolean }
  | { type: 'lts:resizeProgramWindow'; tabId: number; width: number; height: number }
  | { type: 'lts:tick' }
  | { type: 'lts:command'; command: 'flip' | 'pin' | 'nextTeam' }
  | { type: 'lts:activate' }
  | { type: 'lts:deactivate' }
  | { type: 'lts:status' }
  | {
      type: 'lts:dataChanged';
      scope: 'profiles' | 'photos' | 'settings' | 'presets' | 'watchlists' | 'teams' | 'all';
    };

const RUNTIME_TYPES = new Set([
  'lts:openStudio',
  'lts:toggleBroadcast',
  'lts:setBroadcast',
  'lts:getTabState',
  'lts:setTabActive',
  'lts:resizeProgramWindow',
  'lts:tick',
  'lts:command',
  'lts:activate',
  'lts:deactivate',
  'lts:status',
  'lts:dataChanged',
]);

function isTabId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Valida mensagens curtas; qualquer outra forma é rejeitada. */
export function parseRuntimeMessage(value: unknown): RuntimeMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !RUNTIME_TYPES.has(value.type)) return null;
  switch (value.type) {
    case 'lts:toggleBroadcast':
      return isTabId(value.tabId) ? { type: value.type, tabId: value.tabId } : null;
    case 'lts:setBroadcast':
      return isTabId(value.tabId) && typeof value.active === 'boolean'
        ? { type: value.type, tabId: value.tabId, active: value.active }
        : null;
    case 'lts:setTabActive':
      return typeof value.active === 'boolean' ? { type: value.type, active: value.active } : null;
    case 'lts:resizeProgramWindow': {
      const w = value.width;
      const h = value.height;
      const ok =
        isTabId(value.tabId) &&
        typeof w === 'number' &&
        typeof h === 'number' &&
        w >= 640 &&
        w <= 7680 &&
        h >= 360 &&
        h <= 4320;
      return ok
        ? { type: value.type, tabId: value.tabId as number, width: Math.round(w), height: Math.round(h) }
        : null;
    }
    case 'lts:command':
      return value.command === 'flip' || value.command === 'pin' || value.command === 'nextTeam'
        ? { type: value.type, command: value.command }
        : null;
    case 'lts:dataChanged': {
      const scopes = ['profiles', 'photos', 'settings', 'presets', 'watchlists', 'teams', 'all'];
      return typeof value.scope === 'string' && scopes.includes(value.scope)
        ? ({ type: value.type, scope: value.scope } as RuntimeMessage)
        : null;
    }
    default:
      return { type: value.type } as RuntimeMessage;
  }
}

function isEnvelope(v: Record<string, unknown>): boolean {
  return (
    v.protocolVersion === PROTOCOL_VERSION &&
    (v.sessionId === null || typeof v.sessionId === 'string') &&
    (v.tournamentId === null || asTournamentId(v.tournamentId) !== null) &&
    typeof v.requestId === 'string' &&
    typeof v.generation === 'number'
  );
}

function parsePageInfo(v: unknown): PageInfo | null {
  if (!isRecord(v) || typeof v.url !== 'string' || !isRecord(v.viewport)) return null;
  const vp = v.viewport;
  const nums = ['width', 'height', 'outerWidth', 'outerHeight', 'dpr'].every(
    (k) => typeof vp[k] === 'number',
  );
  if (!nums) return null;
  const recognition = v.recognition;
  if (recognition !== 'tournament' && recognition !== 'swiss' && recognition !== 'incompatible') return null;
  const hint = v.domFormatHint;
  if (hint !== 'arena' && hint !== 'teamBattle' && hint !== 'swiss' && hint !== 'unknown') return null;
  const tid = v.tournamentId === null ? null : asTournamentId(v.tournamentId);
  if (v.tournamentId !== null && !tid) return null;
  return {
    url: v.url.slice(0, 500),
    recognition,
    tournamentId: tid,
    domFormatHint: hint,
    viewport: {
      width: vp.width as number,
      height: vp.height as number,
      outerWidth: vp.outerWidth as number,
      outerHeight: vp.outerHeight as number,
      dpr: vp.dpr as number,
    },
  };
}

function parseIntent(v: unknown): ProgramIntent | null {
  if (!isRecord(v)) return null;
  switch (v.type) {
    case 'selectGame': {
      const id = asGameId(v.gameId);
      return id ? { type: 'selectGame', gameId: id } : null;
    }
    case 'selectPlayer': {
      const id = normalizeUserId(v.userId);
      return id ? { type: 'selectPlayer', userId: id } : null;
    }
    case 'selectTeam': {
      const id = asTeamId(v.teamId);
      return id ? { type: 'selectTeam', teamId: id } : null;
    }
    case 'setTab':
      return typeof v.tab === 'string' && (PROGRAM_TABS as readonly string[]).includes(v.tab)
        ? { type: 'setTab', tab: v.tab as ProgramTab }
        : null;
    case 'flip':
      return { type: 'flip' };
    case 'pin':
      return { type: 'pin' };
    case 'nextTeamGame':
      return { type: 'nextTeamGame' };
    default:
      return null;
  }
}

/** Valida mensagens do programa (content script) recebidas pelo painel. */
export function parseProgramMessage(value: unknown): ProgramToStudio | null {
  if (!isRecord(value) || !isEnvelope(value)) return null;
  const env: Envelope = {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: value.sessionId as string | null,
    tournamentId: value.tournamentId as string | null,
    requestId: value.requestId as string,
    generation: value.generation as number,
  };
  switch (value.type) {
    case 'hello':
    case 'viewport': {
      const page = parsePageInfo(value.page);
      return page ? { ...env, type: value.type, page } : null;
    }
    case 'intent': {
      const intent = parseIntent(value.intent);
      return intent ? { ...env, type: 'intent', intent } : null;
    }
    case 'photoRequest': {
      if (!Array.isArray(value.photoIds)) return null;
      const ids = value.photoIds.filter(
        (x): x is string => typeof x === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(x),
      );
      return { ...env, type: 'photoRequest', photoIds: ids.slice(0, 200) };
    }
    case 'metrics': {
      if (!Array.isArray(value.renderMs)) return null;
      const renderMs = value.renderMs
        .filter((x): x is number => typeof x === 'number' && x >= 0 && x < 60_000)
        .slice(0, 500);
      return { ...env, type: 'metrics', renderMs };
    }
    case 'bye':
      return { ...env, type: 'bye' };
    default:
      return null;
  }
}

/** Valida mensagens do painel recebidas pelo programa (defesa em profundidade). */
export function parseStudioMessage(value: unknown): StudioToProgram | null {
  if (!isRecord(value) || !isEnvelope(value)) return null;
  switch (value.type) {
    case 'welcome':
    case 'vm':
    case 'photos':
    case 'unsupported':
      return value as unknown as StudioToProgram;
    default:
      return null;
  }
}

let counter = 0;
export function nextRequestId(): string {
  counter = (counter + 1) % 1_000_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}
