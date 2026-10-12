/**
 * Identificadores do Lichess e regras de normalização.
 *
 * - userId: o Lichess trata usernames sem distinção de caixa; o ID é o username em minúsculas.
 *   O nome original é preservado separadamente para exibição.
 * - tournamentId e gameId: 8 caracteres alfanuméricos, com distinção de caixa.
 * - teamId: slug (minúsculas, dígitos, hífen) ou ID alfanumérico de 8 caracteres com caixa mista
 *   (ex.: "ChfzrMPn"); nunca alterar a caixa.
 */

export type UserId = string & { readonly __brand: 'UserId' };
export type TournamentId = string & { readonly __brand: 'TournamentId' };
export type GameId = string & { readonly __brand: 'GameId' };
export type TeamId = string & { readonly __brand: 'TeamId' };

// Tolerante a contas antigas: uma linha de ranking rejeitada abriria lacuna e invalidaria o lote.
const USERNAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const EIGHT_ALNUM_RE = /^[A-Za-z0-9]{8}$/;
const GAME_WITH_PLAYER_RE = /^[A-Za-z0-9]{12}$/;
// Slugs reais podem começar com hífen (ex.: "----club-names-mikhail-chigorin").
const TEAM_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value.trim());
}

/** Normaliza um username para userId. Retorna null se o valor não é um username válido. */
export function normalizeUserId(value: unknown): UserId | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(trimmed)) return null;
  return trimmed.toLowerCase() as UserId;
}

export function asTournamentId(value: unknown): TournamentId | null {
  return typeof value === 'string' && EIGHT_ALNUM_RE.test(value) ? (value as TournamentId) : null;
}

/** Aceita gameId de 8 caracteres ou o ID de 12 (com sufixo do jogador), devolvendo os 8 primeiros. */
export function asGameId(value: unknown): GameId | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (EIGHT_ALNUM_RE.test(v)) return v as GameId;
  if (GAME_WITH_PLAYER_RE.test(v)) return v.slice(0, 8) as GameId;
  return null;
}

export function asTeamId(value: unknown): TeamId | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return TEAM_RE.test(v) ? (v as TeamId) : null;
}

/** Extrai um gameId de uma URL ou texto colado pelo operador (ex.: https://lichess.org/AbCdEfGh/black). */
export function parseGameIdInput(input: string): GameId | null {
  const text = input.trim();
  const direct = asGameId(text);
  if (direct) return direct;
  const match = /lichess\.org\/([A-Za-z0-9]{8,12})(?:[/?#]|$)/.exec(text);
  return match ? asGameId(match[1]) : null;
}

/** Iniciais para jogadores sem foto: até duas letras, a partir do nome de exibição. */
export function initialsOf(name: string): string {
  const parts = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/** Lista local de acompanhados sem team do Lichess associado. */
export const LOCAL_LIST_ID = '_local' as TeamId;
