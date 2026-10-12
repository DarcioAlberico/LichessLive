import { describe, expect, it } from 'vitest';
import { clocksFromCentis, clocksFromStream, formatClock } from '../../src/domain/entities/clock';
import { backoffDelay, BACKOFF_STEPS_MS, rateLimitPauseMs } from '../../src/domain/entities/connection';
import { computeCoverage, coverageLabel } from '../../src/domain/entities/coverage';
import { completeShortFen, INITIAL_FEN, parseFen, uciToSquares } from '../../src/domain/entities/fen';
import { isFinishedStatus, resultText } from '../../src/domain/entities/game';
import {
  asGameId,
  asTeamId,
  asTournamentId,
  initialsOf,
  normalizeUserId,
  parseGameIdInput,
} from '../../src/domain/entities/ids';
import { recognizeUrl } from '../../src/domain/entities/tournament';

describe('ids', () => {
  it('normaliza usernames sem distinção de caixa e preserva validação', () => {
    expect(normalizeUserId('DarcioAlberico')).toBe('darcioalberico');
    expect(normalizeUserId('  @Enxadrista_Heterodoxo ')).toBe('enxadrista_heterodoxo');
    expect(normalizeUserId('a b')).toBeNull();
    expect(normalizeUserId('x'.repeat(41))).toBeNull();
    expect(normalizeUserId('_old-account')).toBe('_old-account');
    expect(normalizeUserId(42)).toBeNull();
  });
  it('aceita gameId de 8 e de 12 caracteres e extrai de URLs', () => {
    expect(asGameId('6fwDn5JD')).toBe('6fwDn5JD');
    expect(asGameId('6fwDn5JDabcd')).toBe('6fwDn5JD');
    expect(asGameId('../etc')).toBeNull();
    expect(parseGameIdInput('https://lichess.org/6fwDn5JD/black')).toBe('6fwDn5JD');
    expect(parseGameIdInput('https://evil.example/6fwDn5JD')).toBeNull();
  });
  it('preserva a caixa de teamId e aceita slugs reais com hífen inicial', () => {
    expect(asTeamId('ChfzrMPn')).toBe('ChfzrMPn');
    expect(asTeamId('----club-names-mikhail-chigorin')).toBe('----club-names-mikhail-chigorin');
    expect(asTeamId('team/../x')).toBeNull();
    expect(asTournamentId('Gxx2vWUz')).toBe('Gxx2vWUz');
    expect(asTournamentId('short')).toBeNull();
  });
  it('gera iniciais para quem não tem foto', () => {
    expect(initialsOf('DarcioAlberico')).toBe('DA');
    expect(initialsOf('tom230')).toBe('TO');
    expect(initialsOf('Enxadrista_Heterodoxo')).toBe('EH');
    expect(initialsOf('')).toBe('?');
  });
});

describe('reconhecimento de URL (T02)', () => {
  it('distingue torneio, Swiss e páginas comuns', () => {
    expect(recognizeUrl('https://lichess.org/tournament/Gxx2vWUz')).toEqual({
      kind: 'tournament',
      tournamentId: 'Gxx2vWUz',
    });
    expect(recognizeUrl('https://lichess.org/swiss/B032EEeq').kind).toBe('swiss');
    expect(recognizeUrl('https://lichess.org/tournament').kind).toBe('incompatible');
    expect(recognizeUrl('https://lichess.org/@/thibault').kind).toBe('incompatible');
    expect(recognizeUrl('https://example.org/tournament/Gxx2vWUz').kind).toBe('incompatible');
    expect(recognizeUrl('not a url').kind).toBe('incompatible');
  });
});

describe('FEN', () => {
  it('valida seis campos, oito fileiras e oito casas', () => {
    const r = parseFen(INITIAL_FEN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.board.filter(Boolean)).toHaveLength(32);
      expect(r.board[0]).toBe('bR');
      expect(r.board[63]).toBe('wR');
    }
    expect(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -').ok).toBe(false);
    expect(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1').ok).toBe(false);
    expect(parseFen('rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').ok).toBe(false);
    expect(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1').ok).toBe(false);
    expect(parseFen('8/8/8/8/8/8/8/8 w - - 0 1').ok).toBe(false);
  });
  it('completa a FEN curta do destaque do torneio', () => {
    expect(completeShortFen('2knr1nr/pppb1pq1/3b4/7p/3PP1pN/2P1B1P1/PP1NQ1BP/R3K2R w')).toBe(
      '2knr1nr/pppb1pq1/3b4/7p/3PP1pN/2P1B1P1/PP1NQ1BP/R3K2R w - - 0 1',
    );
    expect(parseFen(completeShortFen('2knr1nr/pppb1pq1/3b4/7p/3PP1pN/2P1B1P1/PP1NQ1BP/R3K2R w')).ok).toBe(
      true,
    );
  });
  it('converte UCI em casas', () => {
    expect(uciToSquares('e2e4')).toEqual([52, 36]);
    expect(uciToSquares('e7e8q')).toEqual([12, 4]);
    expect(uciToSquares('zz')).toBeNull();
  });
});

describe('relógios', () => {
  it('não aplica o mesmo fator a segundos e centésimos', () => {
    expect(clocksFromStream(180, 173).whiteMs).toBe(180_000);
    expect(clocksFromStream(180, 173).blackMs).toBe(173_000);
    expect(clocksFromCentis(18000, 500).whiteMs).toBe(180_000);
    expect(clocksFromCentis(18000, 500).blackMs).toBe(5_000);
    expect(clocksFromStream(undefined, -1)).toMatchObject({ whiteMs: null, blackMs: null });
  });
  it('formata relógios', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(9_400)).toBe('0:09.4');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(null)).toBe('—');
  });
});

describe('estado e resultado da partida', () => {
  it('identifica partidas encerradas e resultado', () => {
    expect(isFinishedStatus('started')).toBe(false);
    expect(isFinishedStatus('mate')).toBe(true);
    expect(resultText({ status: 'mate', winner: 'black' })).toBe('0-1');
    expect(resultText({ status: 'draw', winner: null })).toBe('½-½');
    expect(resultText({ status: 'started', winner: null })).toBeNull();
  });
});

describe('cobertura', () => {
  it('nunca chama recorte parcial de completo', () => {
    expect(computeCoverage(200, 466).kind).toBe('partial');
    expect(computeCoverage(466, 466).kind).toBe('complete');
    expect(computeCoverage(3, null).kind).toBe('unknown');
    expect(computeCoverage(0, null).kind).toBe('unavailable');
    expect(coverageLabel(computeCoverage(200, 466))).toBe('Parcial: 200 de 466');
  });
});

describe('espera e limitação de acesso (RF13)', () => {
  it('usa degraus de 1, 2, 4, 8, 16 e 30 s com jitter', () => {
    expect(BACKOFF_STEPS_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffDelay(a, mid))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
  });
  it('pausa por pelo menos 60 s ou o Retry-After maior', () => {
    const now = 1_000_000;
    expect(rateLimitPauseMs(null, now)).toBe(60_000);
    expect(rateLimitPauseMs('10', now)).toBe(60_000);
    expect(rateLimitPauseMs('120', now)).toBe(120_000);
    expect(rateLimitPauseMs(new Date(now + 90_000).toUTCString(), now)).toBeGreaterThanOrEqual(89_000);
    expect(rateLimitPauseMs('lixo', now)).toBe(60_000);
    expect(rateLimitPauseMs('999999', now)).toBe(3_600_000);
  });
});
