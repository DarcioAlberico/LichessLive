import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgramViewModel, lowTimeThresholdMs } from '../../src/application/session/programViewModel';
import type { GameId, TeamId } from '../../src/domain/entities/ids';
import { DEFAULT_PRESET } from '../../src/presentation/layouts/presets';
import {
  parseProgramMessage,
  parseRuntimeMessage,
  PROTOCOL_VERSION,
} from '../../src/shared/protocol/messages';
import { sanitizeSettings } from '../../src/shared/settings';
import { entry, TID, uid } from '../helpers';
import { descriptor, makeHarness, move, resolved, START } from './harness';

const g = (s: string) => s as GameId;
const vm = (s: Parameters<typeof buildProgramViewModel>[0]) =>
  buildProgramViewModel(s, {
    timezone: 'America/Sao_Paulo',
    preset: DEFAULT_PRESET,
    now: Date.now(),
    reducedMotion: false,
  });

const FOOLS = {
  f3: 'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1',
  e5: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2',
  g4: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
  qh4: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
};

afterEach(() => vi.useRealTimers());

describe('fichas: último lance, alerta de tempo e material', () => {
  it('mostra o último lance na ficha de quem jogou e marca o mate só com a fonte do tabuleiro', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('MMMMMMMM'));
    h.streams.emit(g('MMMMMMMM'), descriptor('MMMMMMMM', 'Branco', 'Preto'));
    h.streams.emit(g('MMMMMMMM'), move(START));
    h.streams.emit(g('MMMMMMMM'), move(FOOLS.f3, 'f2f3'));
    expect(vm(s).main.white?.lastMoveText).toBe('1. f3');
    expect(vm(s).main.black?.lastMoveText).toBeNull();
    h.streams.emit(g('MMMMMMMM'), move(FOOLS.e5, 'e7e5'));
    h.streams.emit(g('MMMMMMMM'), move(FOOLS.g4, 'g2g4'));
    h.streams.emit(g('MMMMMMMM'), move(FOOLS.qh4, 'd8h4'));
    let v = vm(s);
    expect(v.main.black?.lastMoveText).toBe('2… Dh4+');
    expect(v.main.white?.lastMoveText).toBeNull();
    h.streams.emit(
      g('MMMMMMMM'),
      descriptor('MMMMMMMM', 'Branco', 'Preto', { status: 'mate', winner: 'black', fen: FOOLS.qh4 }),
    );
    v = vm(s);
    expect(v.main.black?.lastMoveText).toBe('2… Dh4#');
  });

  it('não inventa notação quando a posição seguinte não confere', async () => {
    const h = await makeHarness();
    h.session.selectGame(g('MMMMMMMM'));
    h.streams.emit(g('MMMMMMMM'), descriptor('MMMMMMMM', 'Branco', 'Preto'));
    h.streams.emit(g('MMMMMMMM'), move(START));
    // Lance declarado não corresponde à FEN recebida.
    h.streams.emit(g('MMMMMMMM'), move(FOOLS.f3, 'e2e4'));
    expect(vm(h.session).main.white?.lastMoveText).toBeNull();
  });

  it('alerta de tempo proporcional ao ritmo e vantagem material', async () => {
    expect(lowTimeThresholdMs(60_000)).toBe(6_000);
    expect(lowTimeThresholdMs(180_000)).toBe(18_000);
    expect(lowTimeThresholdMs(3_600_000)).toBe(30_000);
    expect(lowTimeThresholdMs(null)).toBe(20_000);
    const h = await makeHarness(); // ritmo 3+0
    h.session.selectGame(g('MMMMMMMM'));
    h.streams.emit(g('MMMMMMMM'), descriptor('MMMMMMMM', 'Branco', 'Preto'));
    // Pretas sem o cavalo de g8; brancas com 15 s, pretas com 40 s.
    h.streams.emit(
      g('MMMMMMMM'),
      move('rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 5', null, 15, 40),
    );
    const v = vm(h.session);
    expect(v.main.white).toMatchObject({ lowTime: true, materialPieces: ['bN'], materialPlus: 3 });
    expect(v.main.black).toMatchObject({ lowTime: false, materialPieces: [], materialPlus: 0 });
  });
});

describe('rotação automática das abas', () => {
  it('troca de aba no intervalo, pula abas vazias e reinicia com escolha manual', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z'));
    const h = await makeHarness({ teamId: 'meu-team' });
    const s = h.session;
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('A')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    await s.reloadLocalData();
    await s.refreshMeta();
    h.lichess.resultsQueue.push([entry(1, 'A', 10), entry(2, 'B', 8)]);
    await s.collectRanking();
    s.updateSettings({ ...h.settings, rotateTabsSec: 10 });
    s.setTab('team');
    // Sem partidas em andamento: a rotação passa por team → ranking → progress.
    expect(s.rotationTabs()).toEqual(['team', 'ranking', 'progress']);
    vi.setSystemTime(new Date('2026-10-14T20:00:05Z'));
    s.tick();
    expect(s.activeTab).toBe('team');
    vi.setSystemTime(new Date('2026-10-14T20:00:11Z'));
    s.tick();
    expect(s.activeTab).toBe('ranking');
    vi.setSystemTime(new Date('2026-10-14T20:00:15Z'));
    s.setTab('team');
    vi.setSystemTime(new Date('2026-10-14T20:00:22Z'));
    s.tick();
    expect(s.activeTab).toBe('team');
    vi.setSystemTime(new Date('2026-10-14T20:00:26Z'));
    s.tick();
    expect(s.activeTab).toBe('ranking');
    s.dispose();
  });
});

describe('partidas do team', () => {
  async function teamHarness() {
    const h = await makeHarness({ teamId: 'meu-team' });
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('Ana'), uid('Bia'), uid('Cid')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    const s = h.session;
    await s.reloadLocalData();
    h.lichess.info.duels = [
      {
        gameId: g('GAMEANA1'),
        players: [
          { name: 'Ana', userId: uid('Ana'), rating: 1800, rank: 5 },
          { name: 'Xis', userId: uid('Xis'), rating: 1700, rank: 9 },
        ],
      },
      {
        gameId: g('GAMEBIA1'),
        players: [
          { name: 'Bia', userId: uid('Bia'), rating: 1900, rank: 2 },
          { name: 'Yuri', userId: uid('Yuri'), rating: 1950, rank: 1 },
        ],
      },
      {
        gameId: g('GAMEOUT1'),
        players: [
          { name: 'Zeca', userId: uid('Zeca'), rating: 2000, rank: 3 },
          { name: 'Wil', userId: uid('Wil'), rating: 2000, rank: 4 },
        ],
      },
    ];
    await s.refreshMeta();
    h.lichess.resultsQueue.push([
      entry(1, 'Yuri', 20),
      entry(2, 'Bia', 18),
      entry(3, 'Zeca', 15),
      entry(4, 'Wil', 14),
      entry(5, 'Ana', 12),
      entry(6, 'Cid', 10),
    ]);
    await s.collectRanking();
    return { h, s };
  }

  it('"próxima partida do team" alterna pelas partidas com acompanhados, na ordem da melhor posição', async () => {
    const { h, s } = await teamHarness();
    expect(await s.nextTeamGame()).toBe('switched');
    expect(s.selection).toMatchObject({ gameId: 'GAMEBIA1', mode: 'follow', followedUserId: 'bia' });
    expect(await s.nextTeamGame()).toBe('switched');
    expect(s.selection).toMatchObject({ gameId: 'GAMEANA1', followedUserId: 'ana' });
    expect(await s.nextTeamGame()).toBe('switched');
    expect(s.selection.gameId).toBe('GAMEBIA1');
    expect(h.streams.history).toEqual(['GAMEBIA1', 'GAMEANA1', 'GAMEBIA1']);
  });

  it('sem partidas do team conhecidas: informa e antecipa a descoberta', async () => {
    const h = await makeHarness({ teamId: 'meu-team' });
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('Ana')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    await h.session.reloadLocalData();
    expect(await h.session.nextTeamGame()).toBe('none');
  });

  it('descoberta leve encontra a partida de um acompanhado fora dos duelos e percebe o fim', async () => {
    const { h, s } = await teamHarness();
    h.lichess.current.set('cid', resolved('GAMECID1', 'Cid', 'Rival', 'started'));
    const scan = () => (s as unknown as { teamScanStep(): Promise<void> }).teamScanStep();
    // Ana e Bia estão nos duelos (pulados); Cid é verificado.
    await scan();
    expect(h.lichess.calls).toContain('current:cid');
    expect(h.lichess.calls).not.toContain('current:ana');
    let cid = vm(s).tabs.team.rows.find((r) => r.userId === 'cid');
    expect(cid).toMatchObject({ playing: true, opponentText: 'vs Rival' });
    expect(s.teamScanAt.has(uid('Cid'))).toBe(true);
    // A partida terminou: deixa de aparecer como "jogando".
    h.lichess.current.set('cid', resolved('GAMECID1', 'Cid', 'Rival', 'mate'));
    await scan();
    cid = vm(s).tabs.team.rows.find((r) => r.userId === 'cid');
    expect(cid?.playing).toBe(false);
  });

  it('filtro da aba Partidas e partida no ar no topo', async () => {
    const { h, s } = await teamHarness();
    s.selectGame(g('GAMEOUT1'));
    h.streams.emit(g('GAMEOUT1'), descriptor('GAMEOUT1', 'Zeca', 'Wil'));
    h.streams.emit(g('GAMEOUT1'), move(START));
    let v = vm(s);
    expect(v.tabs.games.rows.map((r) => r.gameId)).toEqual(['GAMEOUT1', 'GAMEBIA1', 'GAMEANA1']);
    expect(v.tabs.games.onAirText).toBe('No ar: Zeca × Wil');
    s.updateSettings({ ...h.settings, gamesOnlyTracked: true });
    v = vm(s);
    // Só partidas com acompanhados — a do ar continua visível.
    expect(v.tabs.games.rows.map((r) => r.gameId)).toEqual(['GAMEOUT1', 'GAMEBIA1', 'GAMEANA1']);
    s.selectGame(g('GAMEBIA1'));
    h.streams.emit(g('GAMEBIA1'), descriptor('GAMEBIA1', 'Bia', 'Yuri'));
    h.streams.emit(g('GAMEBIA1'), move(START));
    v = vm(s);
    expect(v.tabs.games.rows.map((r) => r.gameId)).toEqual(['GAMEBIA1', 'GAMEANA1']);
    expect(v.tabs.games.summaryText).toContain('filtro ativo');
  });

  it('partida em destaque que também está nos duelos mantém a colocação dos jogadores', async () => {
    const h = await makeHarness();
    const s = h.session;
    h.lichess.info.duels = [
      {
        gameId: g('GAMETOP1'),
        players: [
          { name: 'Yuri', userId: uid('Yuri'), rating: 1950, rank: 1 },
          { name: 'Bia', userId: uid('Bia'), rating: 1900, rank: 2 },
        ],
      },
    ];
    h.lichess.info.featured = {
      gameId: g('GAMETOP1'),
      fen: START,
      lastMove: null,
      white: { name: 'Yuri', userId: uid('Yuri'), rating: 1950 },
      black: { name: 'Bia', userId: uid('Bia'), rating: 1900 },
    };
    // Sem classificação coletada: a colocação só pode vir dos duelos.
    await s.refreshMeta();
    let row = vm(s).tabs.games.rows.find((r) => r.gameId === 'GAMETOP1');
    expect([row?.whiteRank, row?.blackRank]).toEqual([1, 2]);
    // Na consulta seguinte a partida saiu dos duelos e ficou só no destaque: a colocação conhecida fica.
    h.lichess.info.duels = [];
    await s.refreshMeta();
    row = vm(s).tabs.games.rows.find((r) => r.gameId === 'GAMETOP1');
    expect([row?.whiteRank, row?.blackRank]).toEqual([1, 2]);
  });
});

describe('Team Battle e início do torneio', () => {
  it('posição do nosso team no topo, distância para o vizinho e pontuadores', async () => {
    const h = await makeHarness({
      teamId: 'team-x',
      info: {
        format: 'teamBattle',
        teams: [
          { teamId: 'team-x' as TeamId, name: 'Time X' },
          { teamId: 'team-y' as TeamId, name: 'Time Y' },
          { teamId: 'team-z' as TeamId, name: 'Time Z' },
        ],
      },
    });
    const s = h.session;
    await s.refreshMeta();
    h.lichess.standings = [
      { rank: 1, teamId: 'team-y' as TeamId, name: 'team-y', score: 52, topPlayers: [] },
      {
        rank: 2,
        teamId: 'team-x' as TeamId,
        name: 'team-x',
        score: 40,
        topPlayers: [
          { userId: uid('Ana'), name: 'Ana', score: 25 },
          { userId: uid('Bia'), name: 'Bia', score: 15 },
        ],
      },
      { rank: 3, teamId: 'team-z' as TeamId, name: 'team-z', score: 39, topPlayers: [] },
    ];
    await s.collectTeams();
    let v = vm(s);
    expect(v.top.teamStatusText).toBe('2º de 3 · 40 pts');
    const rows = new Map(v.tabs.teams.rows.map((r) => [r.teamId, r.detailText]));
    expect(rows.get('team-x')).toBe('a 12 pts do 1º · Ana 25 · Bia 15');
    expect(rows.get('team-y')).toBe('12 pts à frente do nosso team');
    expect(rows.get('team-z')).toBe('1 pt atrás do nosso team');
    s.setHideResults(true);
    v = vm(s);
    expect(v.top.teamStatusText).toBe('2º de 3');
    expect(v.tabs.teams.rows.find((r) => r.teamId === 'team-y')?.detailText).toBeNull();
  });

  it('contagem regressiva e horário de início antes do torneio começar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T22:50:00Z'));
    const h = await makeHarness({ info: { status: 'created', secondsToStart: 600, secondsToFinish: null } });
    await h.session.refreshMeta();
    const v = vm(h.session);
    expect(v.top.startsAt).toBe(Date.parse('2026-10-14T23:00:00Z'));
    expect(v.top.statusText).toBe('Aguardando início');
    expect(v.main.notice).toBe('O torneio começa às 20:00');
    expect(v.top.finishesAt).toBeNull();
  });
});

describe('protocolo e preferências das melhorias', () => {
  it('aceita a intenção e o comando de próxima partida do team', () => {
    const env = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's',
      tournamentId: TID,
      requestId: 'r',
      generation: 1,
    };
    expect(parseProgramMessage({ ...env, type: 'intent', intent: { type: 'nextTeamGame' } })).toMatchObject({
      intent: { type: 'nextTeamGame' },
    });
    expect(parseRuntimeMessage({ type: 'lts:command', command: 'nextTeam' })).toEqual({
      type: 'lts:command',
      command: 'nextTeam',
    });
    expect(parseRuntimeMessage({ type: 'lts:command', command: 'other' })).toBeNull();
  });
  it('sanitiza rotação e filtro', () => {
    expect(sanitizeSettings({}).rotateTabsSec).toBe(0);
    expect(sanitizeSettings({ rotateTabsSec: 3 }).rotateTabsSec).toBe(10);
    expect(sanitizeSettings({ rotateTabsSec: 9999 }).rotateTabsSec).toBe(600);
    expect(sanitizeSettings({ rotateTabsSec: -5 }).rotateTabsSec).toBe(0);
    expect(sanitizeSettings({ gamesOnlyTracked: true }).gamesOnlyTracked).toBe(true);
  });
});
