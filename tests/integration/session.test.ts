import { describe, expect, it } from 'vitest';
import { buildProgramViewModel } from '../../src/application/session/programViewModel';
import type { GameId, TeamId, UserId } from '../../src/domain/entities/ids';
import { DEFAULT_PRESET } from '../../src/presentation/layouts/presets';
import { deferred, entry, uid } from '../helpers';
import { AFTER_E4, descriptor, makeHarness, move, resolved, settle, START } from './harness';

const g = (s: string) => s as GameId;
const vm = (s: Parameters<typeof buildProgramViewModel>[0]) =>
  buildProgramViewModel(s, {
    timezone: 'America/Sao_Paulo',
    preset: DEFAULT_PRESET,
    now: Date.now(),
    reducedMotion: false,
  });

describe('troca consistente do tabuleiro (T04, RF04)', () => {
  it('cliques rápidos A, B, C: apenas C atualiza; eventos atrasados são descartados', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('AAAAAAAA'));
    s.selectGame(g('BBBBBBBB'));
    s.selectGame(g('CCCCCCCC'));
    // Streams antigos encerrados antes de abrir o próximo.
    expect(h.streams.unsubscribed).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(h.streams.active()).toBe(1);
    // Mensagens atrasadas de A e B (assinaturas encerradas) não chegam mais; C chega.
    h.streams.emit(g('CCCCCCCC'), descriptor('CCCCCCCC', 'Carla', 'Caio'));
    expect(s.game).toBeNull();
    h.streams.emit(g('CCCCCCCC'), move(START));
    expect(s.game?.identity.gameId).toBe('CCCCCCCC');
    expect(s.selection.pending).toBeNull();
  });

  it('nome, foto e relógio novos não aparecem sobre posição antiga', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('XXXXXXXX'));
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'Xavier', 'Xuxa'));
    h.streams.emit(g('XXXXXXXX'), move(AFTER_E4, 'e2e4', 170, 175));
    expect(vm(s).main.white?.name).toBe('Xavier');

    s.selectGame(g('YYYYYYYY'));
    h.streams.emit(g('YYYYYYYY'), descriptor('YYYYYYYY', 'Yara', 'Yuri'));
    // Pacote incompleto: continua mostrando X, com indicação discreta de carregamento.
    let v = vm(s);
    expect(v.main.board?.gameId).toBe('XXXXXXXX');
    expect(v.main.white?.name).toBe('Xavier');
    expect(v.main.board?.fen).toBe(AFTER_E4);
    expect(v.main.loadingLabel).toBeTruthy();
    h.streams.emit(g('YYYYYYYY'), move(START, null, 60, 61));
    v = vm(s);
    expect(v.main.board?.gameId).toBe('YYYYYYYY');
    expect(v.main.board?.packageId.startsWith('YYYYYYYY:')).toBe(true);
    expect(v.main.white?.name).toBe('Yara');
    expect(v.main.white?.clockText).toBe('1:00');
    expect(v.main.loadingLabel).toBeNull();
  });

  it('resolução de jogadores: resposta atrasada de A não substitui C', async () => {
    const h = await makeHarness();
    const s = h.session;
    const slowA = deferred<ReturnType<typeof resolved> | null>();
    h.lichess.current.set('ana', slowA.promise);
    h.lichess.current.set('bia', resolved('BBBBBBBB', 'Bia', 'Bob', 'started'));
    h.lichess.current.set('cid', resolved('CCCCCCCC', 'Cid', 'Caco', 'started'));
    const pa = s.selectPlayer(uid('ana'));
    const pb = s.selectPlayer(uid('bia'));
    const pc = s.selectPlayer(uid('cid'));
    await Promise.all([pb, pc]);
    slowA.resolve(resolved('AAAAAAAA', 'Ana', 'Alan', 'started'));
    await pa;
    await settle();
    expect(s.selection.gameId).toBe('CCCCCCCC');
    expect(h.streams.history.includes(g('AAAAAAAA'))).toBe(false);
  });

  it('girar não refaz conexões nem troca fichas', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('XXXXXXXX'));
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'Xavier', 'Xuxa'));
    h.streams.emit(g('XXXXXXXX'), move(START));
    const subs = h.streams.history.length;
    s.flip();
    const v = vm(s);
    expect(v.main.board?.orientation).toBe('black');
    expect(v.main.white?.name).toBe('Xavier');
    expect(h.streams.history.length).toBe(subs);
  });

  it('acompanhar pretas orienta o tabuleiro pelas pretas', async () => {
    const h = await makeHarness();
    h.lichess.current.set('xuxa', resolved('XXXXXXXX', 'Xavier', 'Xuxa', 'started'));
    await h.session.selectPlayer(uid('Xuxa'));
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'Xavier', 'Xuxa'));
    h.streams.emit(g('XXXXXXXX'), move(START));
    expect(h.session.selection.orientation).toBe('black');
  });
});

describe('seleção fora do destaque e vínculo com o torneio (T03, RF03)', () => {
  it('jogador fora do top inicial: resolve current-game e confirma o torneio', async () => {
    const h = await makeHarness();
    h.lichess.current.set('fundo', resolved('FFFFFFFF', 'Fundo', 'Rival', 'started'));
    await h.session.selectPlayer(uid('Fundo'));
    expect(h.session.selection.gameId).toBe('FFFFFFFF');
    expect(h.streams.history).toEqual(['FFFFFFFF']);
  });
  it('partida de outro torneio nunca é exibida', async () => {
    const h = await makeHarness();
    h.lichess.current.set('fora', resolved('OOOOOOOO', 'Fora', 'Rival', 'started', 'Other123'));
    await h.session.selectPlayer(uid('Fora'));
    expect(h.session.selection.notice).toMatchObject({ kind: 'otherTournament' });
    expect(h.streams.history).toEqual([]);
  });
  it('última partida encerrada é oferecida como replay, nunca como atual', async () => {
    const h = await makeHarness();
    h.lichess.current.set('fim', resolved('EEEEEEEE', 'Fim', 'Rival', 'mate'));
    await h.session.selectPlayer(uid('Fim'));
    expect(h.session.selection.notice).toMatchObject({ kind: 'noCurrentGame', lastGameId: 'EEEEEEEE' });
    expect(h.streams.history).toEqual([]);
    expect(vm(h.session).main.notice).toBe('Sem partida atual confirmada');
    h.session.acceptReplay();
    expect(h.session.selection.mode).toBe('replay');
    h.streams.emit(g('EEEEEEEE'), descriptor('EEEEEEEE', 'Fim', 'Rival'));
    h.streams.emit(g('EEEEEEEE'), move(START));
    expect(vm(h.session).main.modeLabel).toBe('Replay da última partida');
  });
  it('sem partida: informa ausência', async () => {
    const h = await makeHarness();
    await h.session.selectPlayer(uid('Ninguem'));
    expect(h.session.selection.notice).toMatchObject({ kind: 'notFound' });
  });
  it('stream de outro torneio é recusado e o tabuleiro anterior permanece', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('XXXXXXXX'));
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'Xavier', 'Xuxa'));
    h.streams.emit(g('XXXXXXXX'), move(START));
    s.selectGame(g('ZZZZZZZZ'), { explicit: true });
    h.streams.emit(g('ZZZZZZZZ'), descriptor('ZZZZZZZZ', 'Zeca', 'Zoe', { tournamentId: 'Other123' }));
    expect(s.game?.identity.gameId).toBe('XXXXXXXX');
    expect(s.selection.notice).toMatchObject({ kind: 'otherTournament' });
    // O tabuleiro anterior volta a ser acompanhado.
    expect(s.selection.gameId).toBe('XXXXXXXX');
  });
  it('partida sem vínculo: só com escolha explícita e com aviso', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('UUUUUUUU'), { explicit: false });
    h.streams.emit(g('UUUUUUUU'), descriptor('UUUUUUUU', 'U1', 'U2', { tournamentId: null }));
    expect(s.game).toBeNull();
    expect(s.selection.notice).toMatchObject({ kind: 'unlinked' });
    s.acceptUnlinked();
    h.streams.emit(g('UUUUUUUU'), descriptor('UUUUUUUU', 'U1', 'U2', { tournamentId: null }));
    h.streams.emit(g('UUUUUUUU'), move(START));
    expect(s.game?.identity.gameId).toBe('UUUUUUUU');
    expect(vm(s).main.notice).toBe('Partida sem vínculo confirmado com este torneio');
  });
  it('variante não suportada não usa o renderer padrão', async () => {
    const h = await makeHarness();
    h.session.selectGame(g('VVVVVVVV'));
    h.streams.emit(g('VVVVVVVV'), descriptor('VVVVVVVV', 'A', 'B', { variant: 'atomic' }));
    expect(h.session.game).toBeNull();
    expect(h.session.selection.notice).toMatchObject({ kind: 'unsupportedVariant', variant: 'atomic' });
  });
  it('FEN inválida é descartada sem trocar o tabuleiro', async () => {
    const h = await makeHarness();
    h.session.selectGame(g('XXXXXXXX'));
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'A', 'B'));
    h.streams.emit(g('XXXXXXXX'), move('lixo'));
    expect(h.session.game).toBeNull();
    h.streams.emit(g('XXXXXXXX'), move(START));
    expect(h.session.game?.position?.fen).toBe(START);
  });
});

describe('acompanhar jogador', () => {
  it('nova partida do mesmo torneio é sugerida (troca automática desligada)', async () => {
    const h = await makeHarness();
    const s = h.session;
    h.lichess.current.set('ana', resolved('AAAAAAAA', 'Ana', 'Alan', 'started'));
    await s.selectPlayer(uid('Ana'), 'follow');
    h.streams.emit(g('AAAAAAAA'), descriptor('AAAAAAAA', 'Ana', 'Alan'));
    h.streams.emit(g('AAAAAAAA'), move(START));
    h.lichess.info.duels = [
      {
        gameId: g('A2A2A2A2'),
        players: [
          { name: 'Ana', userId: uid('Ana'), rating: 1800, rank: 3 },
          { name: 'Zé', userId: uid('Ze'), rating: 1700, rank: 9 },
        ],
      },
    ];
    await s.refreshMeta();
    expect(s.selection.suggestion?.gameId).toBe('A2A2A2A2');
    expect(s.selection.gameId).toBe('AAAAAAAA');
    s.acceptSuggestion();
    expect(s.selection.gameId).toBe('A2A2A2A2');
  });
  it('com troca automática, troca para a nova partida', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.setAutoSwitch(true);
    h.lichess.current.set('ana', resolved('AAAAAAAA', 'Ana', 'Alan', 'started'));
    await s.selectPlayer(uid('Ana'), 'follow');
    h.lichess.info.duels = [
      {
        gameId: g('A2A2A2A2'),
        players: [
          { name: 'Ana', userId: uid('Ana'), rating: 1800, rank: 3 },
          { name: 'Zé', userId: uid('Ze'), rating: 1700, rank: 9 },
        ],
      },
    ];
    await s.refreshMeta();
    expect(s.selection.gameId).toBe('A2A2A2A2');
  });
});

describe('spoilers (T16)', () => {
  it('banner principal só aparece com a descrição final da fonte do tabuleiro', async () => {
    const h = await makeHarness();
    const s = h.session;
    h.lichess.current.set('ana', resolved('AAAAAAAA', 'Ana', 'Alan', 'started'));
    await s.selectPlayer(uid('Ana'), 'follow');
    h.streams.emit(g('AAAAAAAA'), descriptor('AAAAAAAA', 'Ana', 'Alan'));
    h.streams.emit(g('AAAAAAAA'), move(START));
    // A API sabe do resultado antes do tabuleiro atrasado.
    h.lichess.current.set('ana', resolved('AAAAAAAA', 'Ana', 'Alan', 'mate'));
    await (s as unknown as { followCheck(): Promise<void> }).followCheck();
    expect(s.earlyOutcome?.gameId).toBe('AAAAAAAA');
    expect(vm(s).main.resultBanner).toBeNull();
    h.streams.emit(
      g('AAAAAAAA'),
      descriptor('AAAAAAAA', 'Ana', 'Alan', { status: 'mate', winner: 'white', fen: AFTER_E4 }),
    );
    expect(vm(s).main.resultBanner).toMatch(/^1-0/);
    expect(s.earlyOutcome).toBeNull();
    s.setHideResults(true);
    expect(vm(s).main.resultBanner).toBe('Partida encerrada');
  });
});

describe('classificação e progresso (T07, T08)', () => {
  it('demonstração: DarcioAlberico 6º→3º (+3) e EnxadristaHeterodoxo 4º→5º (-1)', async () => {
    const h = await makeHarness({ teamId: 'meu-team' });
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('DarcioAlberico'), uid('EnxadristaHeterodoxo'), uid('Sumido')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    const s = h.session;
    await s.reloadLocalData();
    await s.refreshMeta();
    const ranking = (order: string[]) => order.map((n, i) => entry(i + 1, n, 100 - i * 3));
    // Coleta 1: Darcio 6º, Enxadrista 4º, Sumido 8º.
    h.lichess.resultsQueue.push(
      ranking(['A', 'B', 'C', 'EnxadristaHeterodoxo', 'D', 'DarcioAlberico', 'E', 'Sumido', 'F', 'G']),
    );
    await s.collectRanking();
    let rows = new Map((s.progress.get('general') ?? []).map((r) => [r.userId, r]));
    expect(rows.get(uid('DarcioAlberico'))?.status).toBe('new');
    // Coleta 2: Darcio 4º, Enxadrista 5º.
    h.lichess.resultsQueue.push(
      ranking(['A', 'B', 'C', 'DarcioAlberico', 'EnxadristaHeterodoxo', 'D', 'E', 'Sumido', 'F', 'G']),
    );
    await s.collectRanking();
    // Coleta 3: Darcio 3º; Sumido fora do recorte (nb limitado a 10 de 30 participantes).
    h.lichess.info.nbPlayers = 30;
    s.updateSettings({ ...h.settings, rankingNb: 10 });
    await s.refreshMeta();
    h.lichess.resultsQueue.push(
      ranking(['A', 'B', 'DarcioAlberico', 'C', 'EnxadristaHeterodoxo', 'D', 'E', 'F', 'G', 'H']),
    );
    await s.collectRanking();
    rows = new Map((s.progress.get('general') ?? []).map((r) => [r.userId, r]));
    expect(rows.get(uid('DarcioAlberico'))).toMatchObject({
      currentRank: 3,
      referenceRank: 6,
      deltaRank: 3,
      confirmed: true,
    });
    expect(rows.get(uid('EnxadristaHeterodoxo'))).toMatchObject({ currentRank: 5, deltaRank: -1 });
    expect(rows.get(uid('Sumido'))?.status).toBe('outOfCut');
    const v = vm(s);
    const darcio = v.tabs.progress.rows.find((r) => r.userId === 'darcioalberico');
    expect(darcio).toMatchObject({ rankText: '3º', deltaText: '▲ +3 posições', direction: 'up' });
    expect(v.tabs.progress.rows.find((r) => r.userId === 'enxadristaheterodoxo')?.deltaText).toBe(
      '▼ -1 posição',
    );
    expect(v.tabs.progress.rows.find((r) => r.userId === 'sumido')?.deltaText).toBe('Fora do recorte');
    expect(v.tabs.progress.referenceText).toMatch(/^Progresso desde \d\dh\d\d$/);
    // Cobertura parcial é informada; nunca chamada de completa.
    expect(v.tabs.ranking.coverageText).toBe('Cobertura: Parcial: 10 de 30');
    expect(v.tabs.ranking.title).toBe('Classificação provisória');
    expect(v.tabs.team.rows.find((r) => r.userId === 'sumido')?.statusText).toBe('Fora do recorte');
  });

  it('coleta inconsistente fica para diagnóstico e o último lote válido continua publicado', async () => {
    const h = await makeHarness({ teamId: 'meu-team' });
    const s = h.session;
    await s.refreshMeta();
    h.lichess.resultsQueue.push([entry(1, 'A', 10), entry(2, 'B', 8)]);
    await s.collectRanking();
    const valid = s.snapshot;
    h.lichess.resultsQueue.push([entry(1, 'A', 10), entry(1, 'B', 12)]);
    await s.collectRanking();
    expect(s.snapshot).toBe(valid);
    expect(s.rejectedBatches).toBe(1);
    expect(s.lastCollection?.ok).toBe(false);
    expect(s.isRankingStale()).toBe(true);
    expect(h.log.list().some((e) => e.channel === 'ranking' && e.level === 'warn')).toBe(true);
  });

  it('marcação manual registra o instante e reinicia em 0 após marcação', async () => {
    const h = await makeHarness({ teamId: 'meu-team' });
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('A')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    const s = h.session;
    await s.reloadLocalData();
    await s.refreshMeta();
    h.lichess.resultsQueue.push([entry(1, 'B', 10), entry(2, 'A', 8)]);
    await s.collectRanking();
    await s.markReference();
    expect(s.progress.get('general')?.[0]?.status).toBe('resetByMark');
    h.lichess.resultsQueue.push([entry(1, 'A', 12), entry(2, 'B', 10)]);
    await s.collectRanking();
    expect(s.progress.get('general')?.[0]).toMatchObject({ status: 'up', deltaRank: 1 });
    expect(s.record.referenceMarkedAt).not.toBeNull();
  });

  it('lista virtualizada recebe todas as linhas e a seleção é pelo ID', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.updateSettings({ ...h.settings, rankingNb: 1000 });
    h.lichess.info.nbPlayers = 1000;
    await s.refreshMeta();
    h.lichess.resultsQueue.push(Array.from({ length: 1000 }, (_, i) => entry(i + 1, `p${i}`, 5000 - i)));
    await s.collectRanking();
    const v = vm(s);
    expect(v.tabs.ranking.rows).toHaveLength(1000);
    expect(v.tabs.ranking.rows[499]?.userId).toBe('p499');
  });
});

describe('Team Battle (T09)', () => {
  it('usa o team do participante no torneio e o placar oficial', async () => {
    const h = await makeHarness({
      teamId: 'team-x',
      info: {
        format: 'teamBattle',
        teams: [
          { teamId: 'team-x' as TeamId, name: 'Time X' },
          { teamId: 'team-y' as TeamId, name: 'Time Y' },
        ],
        nbLeaders: 2,
      },
    });
    // "Duplo" pertence aos dois teams no cadastro, mas joga pelo team-y neste torneio.
    await h.repos.teams.put({
      teamId: 'team-x' as TeamId,
      name: 'Time X',
      logoId: null,
      rosterCoverage: { kind: 'complete', received: 2, total: 2 },
      rosterFetchedAt: 0,
      members: [{ userId: uid('Duplo'), username: 'Duplo', source: 'public-import' }],
    });
    await h.repos.watchlists.put({
      teamId: 'team-x' as TeamId,
      profileId: 'default',
      userIds: [uid('Duplo')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    const s = h.session;
    await s.reloadLocalData();
    await s.refreshMeta();
    h.lichess.resultsQueue.push([
      entry(1, 'A', 30, 'team-x'),
      entry(2, 'Duplo', 20, 'team-y'),
      entry(3, 'C', 10, 'team-x'),
      entry(4, 'D', 5, 'team-x'),
    ]);
    h.lichess.standings = [
      { rank: 1, teamId: 'team-x' as TeamId, name: 'team-x', score: 40, topPlayers: [] },
      { rank: 2, teamId: 'team-y' as TeamId, name: 'team-y', score: 20, topPlayers: [] },
    ];
    await s.collectRanking();
    await s.collectTeams();
    const v = vm(s);
    expect(v.tabs.available).toContain('teams');
    // Placar oficial (40), não a soma de todos os membros (45).
    expect(v.tabs.teams.rows[0]).toMatchObject({ name: 'Time X', scoreText: '40 pts', isOurs: true });
    const ids = v.tabs.team.rows.map((r) => r.userId).sort();
    expect(ids).toEqual(['a', 'c', 'd', 'duplo']);
    expect(v.tabs.team.rows.find((r) => r.userId === 'duplo')?.linkNote).toBe('No torneio pelo team Time Y');
  });
});

describe('recuperação de sessão (T14, RF14)', () => {
  it('reinício retoma a referência sem inventar posições; outra sessão não herda', async () => {
    const dbName = `lts-test-recover-${Date.now()}`;
    const h = await makeHarness({ teamId: 'meu-team', dbName });
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('A')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    let s = h.session;
    await s.start();
    await settle();
    h.lichess.resultsQueue.push([entry(1, 'B', 10), entry(2, 'C', 9), entry(3, 'A', 8)]);
    await s.collectRanking();
    s.selectGame(g('XXXXXXXX'));
    s.flip();
    await settle();
    s.dispose();
    expect(h.streams.active()).toBe(0);

    // "Reinício": nova instância com o mesmo registro.
    s = h.make(h.record);
    await s.start();
    await settle();
    expect(s.selection.gameId).toBe('XXXXXXXX');
    expect(s.selection.orientation).toBe('black');
    h.lichess.resultsQueue.push([entry(1, 'A', 12), entry(2, 'B', 10), entry(3, 'C', 9)]);
    await s.collectRanking();
    expect(s.progress.get('general')?.[0]).toMatchObject({ referenceRank: 3, currentRank: 1, deltaRank: 2 });
    s.dispose();

    // Nova sessão (outra referência): começa como "Novo".
    const other = h.make({ ...h.record, sessionId: 'outra', referenceId: 'ref-outra' });
    await other.start();
    await settle();
    h.lichess.resultsQueue.push([entry(1, 'A', 12), entry(2, 'B', 10), entry(3, 'C', 9)]);
    await other.collectRanking();
    expect(other.progress.get('general')?.[0]?.status).toBe('new');
    other.dispose();
  });

  it('referência não vaza entre torneios', async () => {
    const h = await makeHarness({ teamId: 'meu-team' });
    await h.repos.observations.addMany([
      {
        sessionId: h.record.sessionId,
        scope: 'general',
        referenceId: h.record.referenceId,
        rulesVersion: 'arena-rank-v1',
        collectionId: 'x',
        tournamentId: 'Outro123' as never,
        userId: uid('A') as UserId,
        rank: 50,
        score: 0,
        source: 'results-live',
        startedAt: 0,
        endedAt: 1,
        provisional: true,
        inCut: true,
      },
    ]);
    await h.repos.watchlists.put({
      teamId: 'meu-team' as TeamId,
      profileId: 'default',
      userIds: [uid('A')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    const s = h.make();
    await s.start();
    await settle();
    h.lichess.resultsQueue.push([entry(1, 'A', 12)]);
    await s.collectRanking();
    expect(s.progress.get('general')?.[0]?.status).toBe('new');
    s.dispose();
  });
});
