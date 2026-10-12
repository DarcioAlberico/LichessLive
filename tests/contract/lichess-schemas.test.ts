import { describe, expect, it } from 'vitest';
import {
  parseExportedGame,
  parsePublicUser,
  parseResultLine,
  parseStreamMessage,
  parseTeamMember,
  parseTeamStandings,
  parseTournament,
} from '../../src/adapters/lichess/schemas';
import type { GameId, TournamentId } from '../../src/domain/entities/ids';
import { parseFen } from '../../src/domain/entities/fen';
import { ContractError } from '../../src/shared/validate';
import { fixtureJson, ndjsonLines } from '../helpers';

/**
 * Contratos conferidos com respostas reais da API pública do Lichess capturadas em 12/10/2026
 * (origem e data em tests/fixtures/README.md).
 */

describe('GET /api/tournament/{id}', () => {
  it('Arena ao vivo: formato, duelos, destaque e tempo restante', () => {
    const t = parseTournament(fixtureJson('lichess/tournament-arena-live.json'), 1_000);
    expect(t.tournamentId).toBe('Gxx2vWUz');
    expect(t.format).toBe('arena');
    expect(t.status).toBe('started');
    expect(t.variant).toBe('standard');
    expect(t.nbPlayers).toBe(466);
    expect(t.secondsToFinish).toBe(4293);
    expect(t.duels.length).toBeGreaterThan(0);
    expect(t.duels[0]!.players[0]).toMatchObject({ name: 'tom230', userId: 'tom230', rank: 2 });
    expect(t.featured?.gameId).toBe('DZAX889v');
    expect(parseFen(t.featured!.fen).ok).toBe(true);
    expect(t.teams).toEqual([]);
  });
  it('Team Battle encerrado: teams oficiais e líderes', () => {
    const t = parseTournament(fixtureJson('lichess/tournament-teambattle-finished.json'), 1_000);
    expect(t.format).toBe('teamBattle');
    expect(t.status).toBe('finished');
    expect(t.teams.length).toBeGreaterThan(5);
    expect(t.teams.find((x) => x.teamId === 'trchess')).toBeTruthy();
    expect(t.teams.some((x) => x.teamId.startsWith('-'))).toBe(true);
    expect(t.nbLeaders).toBeGreaterThan(0);
  });
  it('rejeita resposta sem id e tolera campos ausentes', () => {
    expect(() => parseTournament({ fullName: 'x' }, 0)).toThrow(ContractError);
    const t = parseTournament({ id: 'Abcd1234' }, 0);
    expect(t).toMatchObject({
      format: 'arena',
      status: 'unknown',
      nbPlayers: null,
      duels: [],
      featured: null,
    });
  });
});

describe('GET /api/tournament/{id}/results (NDJSON)', () => {
  it('linhas com posição, pontos, desempenho e team', () => {
    const rows = ndjsonLines('lichess/teambattle-results.ndjson').map(parseResultLine);
    expect(rows.every(Boolean)).toBe(true);
    expect(rows[0]).toMatchObject({
      rank: 1,
      username: 'Meyzler_Boris',
      userId: 'meyzler_boris',
      score: 109,
      teamId: 'trchess',
      performance: 2208,
    });
  });
  it('linha sem campos obrigatórios é descartada', () => {
    expect(parseResultLine({ rank: 1, username: 'x' })).toBeNull();
    expect(parseResultLine({ rank: 'a', username: 'x', score: 1 })).toBeNull();
    expect(parseResultLine(null)).toBeNull();
  });
});

describe('GET /api/tournament/{id}/teams', () => {
  it('placar oficial com principais pontuadores', () => {
    const teams = parseTeamStandings(
      fixtureJson('lichess/teambattle-teams.json'),
      'YVqdsK7c' as TournamentId,
    );
    expect(teams[0]).toMatchObject({ rank: 1, teamId: 'trchess', score: 125 });
    expect(teams[0]!.topPlayers[0]).toMatchObject({ userId: 'meyzler_boris', score: 109 });
    // O placar oficial não é a soma de todos os membros.
    const sum = teams[0]!.topPlayers.reduce((s, p) => s + p.score, 0);
    expect(sum).toBe(125);
  });
  it('rejeita placar de outro torneio', () => {
    expect(() =>
      parseTeamStandings(fixtureJson('lichess/teambattle-teams.json'), 'Other123' as TournamentId),
    ).toThrow(ContractError);
  });
});

describe('GET /api/team/{teamId}/users (NDJSON)', () => {
  it('formato atual {name, id, joinedTeamAt} e formatos antigos', () => {
    const members = ndjsonLines('lichess/team-users.ndjson').map(parseTeamMember);
    expect(members[0]).toEqual({ userId: 'kingstrike', username: 'KingStrike' });
    expect(parseTeamMember({ user: { id: 'abc', name: 'Abc' } })).toEqual({ userId: 'abc', username: 'Abc' });
    expect(parseTeamMember({ username: 'Def', id: 'def' })).toEqual({ userId: 'def', username: 'Def' });
    expect(parseTeamMember({})).toBeNull();
  });
});

describe('GET /api/user/{username}/current-game (JSON)', () => {
  it('partida em andamento com vínculo do torneio em arenaTour', () => {
    const g = parseExportedGame(fixtureJson('lichess/current-game-started.json'));
    expect(g).toMatchObject({
      gameId: '6fwDn5JD',
      status: 'started',
      tournamentId: 'Gxx2vWUz',
      whiteUserId: 'tom230',
      blackUserId: 'ntsonyane2004',
    });
  });
  it('partida contra IA encerrada sem torneio', () => {
    const g = parseExportedGame(fixtureJson('lichess/current-game-ai-finished.json'));
    expect(g.status).toBe('outoftime');
    expect(g.tournamentId).toBeNull();
    expect(g.black.isAnonymous).toBe(true);
    expect(g.winner).toBe('black');
  });
});

describe('GET /api/user/{username}', () => {
  it('confirma identidade', () => {
    expect(parsePublicUser({ id: 'thibault', username: 'thibault', title: null })).toMatchObject({
      userId: 'thibault',
      disabled: false,
    });
    expect(() => parsePublicUser({})).toThrow(ContractError);
  });
});

describe('GET /api/stream/game/{id} (NDJSON)', () => {
  const live = ndjsonLines('lichess/stream-game-live.ndjson');
  const finished = ndjsonLines('lichess/stream-game-finished.ndjson');
  it('primeira linha descreve a partida sem status; segue posição com relógios em segundos', () => {
    const d = parseStreamMessage(live[0], '6fwDn5JD' as GameId);
    expect(d.kind).toBe('descriptor');
    if (d.kind === 'descriptor') {
      expect(d.status).toBeNull();
      expect(d.identity.tournamentId).toBe('Gxx2vWUz');
      expect(d.identity.variant).toBe('standard');
      expect(d.identity.white.userId).toBe('tom230');
    }
    const m = parseStreamMessage(live[2], '6fwDn5JD' as GameId);
    expect(m).toMatchObject({ kind: 'move', lastMove: 'd2d4' });
    if (m.kind === 'move') expect(m.clocks.whiteMs).toBe(180_000);
  });
  it('descrição final traz status e vencedor', () => {
    const last = parseStreamMessage(finished[finished.length - 1], '0u7534ir' as GameId);
    expect(last).toMatchObject({ kind: 'descriptor', status: 'mate', winner: 'black' });
  });
  it('descrição de outra partida no mesmo stream é erro de contrato', () => {
    expect(() => parseStreamMessage(live[0], 'XXXXXXXX' as GameId)).toThrow(ContractError);
    expect(() => parseStreamMessage({ lm: 'e2e4' }, '6fwDn5JD' as GameId)).toThrow(ContractError);
  });
});
