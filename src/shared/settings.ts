import type { ProgramTab } from './protocol/messages';
import { PROGRAM_TABS } from './protocol/messages';
import { isRecord } from './validate';

/** Preferências pequenas guardadas em chrome.storage.local (SPEC 9.3). */
export interface Settings {
  settingsVersion: 1;
  timezone: string;
  /** nb pedido ao endpoint de resultados (limita a cobertura). */
  rankingNb: number;
  rankingIntervalSec: number;
  teamsIntervalSec: number;
  autoSwitch: boolean;
  hideResultsDefault: boolean;
  activePresetId: string;
  retention: { maxSessions: number; maxDays: number; historyMb: number; photosMb: number };
  lastTeamId: string | null;
  lastTab: ProgramTab;
  /** Atalhos dentro da página de programa (além dos comandos remapeáveis do Chrome). */
  inPageShortcuts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 1,
  timezone: 'America/Sao_Paulo',
  rankingNb: 500,
  rankingIntervalSec: 30,
  teamsIntervalSec: 45,
  autoSwitch: false,
  hideResultsDefault: false,
  activePresetId: 'single-1080',
  retention: { maxSessions: 30, maxDays: 30, historyMb: 100, photosMb: 100 },
  lastTeamId: null,
  lastTab: 'team',
  inPageShortcuts: true,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Normaliza valores lidos do armazenamento ou de um backup. */
export function sanitizeSettings(value: unknown): Settings {
  const v = isRecord(value) ? value : {};
  const r = isRecord(v.retention) ? v.retention : {};
  const d = DEFAULT_SETTINGS;
  return {
    settingsVersion: 1,
    timezone: validTimezone(v.timezone) ?? d.timezone,
    rankingNb: clampInt(v.rankingNb, 10, 1000, d.rankingNb),
    rankingIntervalSec: clampInt(v.rankingIntervalSec, 15, 300, d.rankingIntervalSec),
    teamsIntervalSec: clampInt(v.teamsIntervalSec, 30, 300, d.teamsIntervalSec),
    autoSwitch: typeof v.autoSwitch === 'boolean' ? v.autoSwitch : d.autoSwitch,
    hideResultsDefault:
      typeof v.hideResultsDefault === 'boolean' ? v.hideResultsDefault : d.hideResultsDefault,
    activePresetId:
      typeof v.activePresetId === 'string' && v.activePresetId.length < 80
        ? v.activePresetId
        : d.activePresetId,
    retention: {
      maxSessions: clampInt(r.maxSessions, 1, 500, d.retention.maxSessions),
      maxDays: clampInt(r.maxDays, 1, 365, d.retention.maxDays),
      historyMb: clampInt(r.historyMb, 10, 1000, d.retention.historyMb),
      photosMb: clampInt(r.photosMb, 10, 1000, d.retention.photosMb),
    },
    lastTeamId: typeof v.lastTeamId === 'string' && v.lastTeamId.length <= 80 ? v.lastTeamId : null,
    lastTab:
      typeof v.lastTab === 'string' && (PROGRAM_TABS as readonly string[]).includes(v.lastTab)
        ? (v.lastTab as ProgramTab)
        : d.lastTab,
    inPageShortcuts: typeof v.inPageShortcuts === 'boolean' ? v.inPageShortcuts : d.inPageShortcuts,
  };
}
