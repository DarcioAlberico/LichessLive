import { describe, expect, it } from 'vitest';
import type { RankingBatch } from '../../src/domain/ranking/batch';
import { rankAmongWatched, validateBatch } from '../../src/domain/ranking/batch';
import type { PlayerObservation } from '../../src/domain/ranking/progress';
import { computeProgress, deltaLabel } from '../../src/domain/ranking/progress';
import { ourTeamUserIds, resolveTournamentTeam } from '../../src/domain/ranking/teamBattle';
import { entry, TID, tid, uid } from '../helpers';

function batch(entries: ReturnType<typeof entry>[], extra: Partial<RankingBatch> = {}): RankingBatch {
  return {
    collectionId: 'c1',
    tournamentId: TID,
    entries,
    startedAt: 1000,
    endedAt: 1200,
    requestedNb: 500,
    totalPlayers: entries.length,
    final: false,
    invalidLines: 0,
    ...extra,
  };
}

describe('validação de lote de classificação (SPEC 6.4)', () => {
  it('publica lote válido como provisório e com cobertura', () => {
    const r = validateBatch(batch([entry(1, 'A', 10), entry(2, 'B', 8), entry(3, 'C', 8)]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.provisional).toBe(true);
      expect(r.snapshot.coverage.kind).toBe('complete');
      expect(r.snapshot.byUser.get(uid('B'))?.rank).toBe(2);
    }
  });
  it('lote final não é provisório', () => {
    const r = validateBatch(batch([entry(1, 'A', 10)], { final: true }));
    expect(r.ok && r.snapshot.provisional).toBe(false);
  });
  it('rejeita jogador repetido, posição repetida, lacunas e ordem contraditória', () => {
    expect(validateBatch(batch([entry(1, 'A', 10), entry(2, 'a', 9)])).ok).toBe(false);
    expect(validateBatch(batch([entry(1, 'A', 10), entry(1, 'B', 9)])).ok).toBe(false);
    expect(validateBatch(batch([entry(1, 'A', 10), entry(3, 'B', 9)])).ok).toBe(false);
    const contradictory = validateBatch(batch([entry(1, 'A', 5), entry(2, 'B', 9)]));
    expect(contradictory.ok).toBe(false);
    if (!contradictory.ok) expect(contradictory.problems.join()).toMatch(/contraditória/);
  });
  it('recorte limitado por nb é parcial; resposta menor que nb cobre todos', () => {
    const entries = Array.from({ length: 200 }, (_, i) => entry(i + 1, `p${i}`, 400 - i));
    const partial = validateBatch(batch(entries, { requestedNb: 200, totalPlayers: 466 }));
    expect(partial.ok && partial.snapshot.coverage).toMatchObject({
      kind: 'partial',
      received: 200,
      total: 466,
    });
    const complete = validateBatch(batch(entries.slice(0, 150), { requestedNb: 200, totalPlayers: 160 }));
    expect(complete.ok && complete.snapshot.coverage.kind).toBe('complete');
  });
  it('calcula posição entre acompanhados', () => {
    const r = validateBatch(batch([entry(1, 'A', 10), entry(2, 'B', 8), entry(3, 'C', 7), entry(4, 'D', 1)]));
    if (!r.ok) throw new Error('lote inválido');
    expect([...rankAmongWatched(r.snapshot, [uid('D'), uid('B'), uid('Z')])]).toEqual([
      [uid('B'), 1],
      [uid('D'), 2],
    ]);
  });
});

const obs = (
  collectionId: string,
  rank: number | null,
  endedAt: number,
  score: number | null = 0,
  inCut = rank !== null,
): PlayerObservation => ({
  collectionId,
  rank,
  score,
  inCut,
  endedAt,
});

describe('progresso de posição (T08)', () => {
  it('DarcioAlberico de 6º para 3º = +3 posições', () => {
    const row = computeProgress({
      userId: uid('DarcioAlberico'),
      history: [obs('c1', 6, 100, 10), obs('c2', 4, 200, 14), obs('c3', 3, 300, 17)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c3',
    });
    expect(row).toMatchObject({
      status: 'up',
      currentRank: 3,
      referenceRank: 6,
      deltaRank: 3,
      deltaScore: 7,
      confirmed: true,
    });
    expect(deltaLabel(row)).toBe('▲ +3 posições');
  });
  it('EnxadristaHeterodoxo de 4º para 5º = -1 posição', () => {
    const row = computeProgress({
      userId: uid('EnxadristaHeterodoxo'),
      history: [obs('c1', 4, 100), obs('c2', 5, 200)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c2',
    });
    expect(row).toMatchObject({ status: 'down', deltaRank: -1, confirmed: false });
    expect(deltaLabel(row)).toBe('▼ -1 posição');
  });
  it('primeira observação válida é "Novo" e não alega ganho', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 7, 100)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c1',
    });
    expect(row.status).toBe('new');
    expect(row.deltaRank).toBeNull();
    expect(deltaLabel(row)).toBe('Novo');
  });
  it('posição igual mostra 0 posições', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 7, 100), obs('c2', 7, 200)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c2',
    });
    expect(deltaLabel(row)).toBe('0 posições');
  });
  it('ausente do recorte não infere abandono nem posição', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 7, 100), obs('c2', null, 200)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c2',
    });
    expect(row.status).toBe('outOfCut');
    expect(row.currentRank).toBeNull();
    expect(row.deltaRank).toBeNull();
    expect(deltaLabel(row)).toBe('Fora do recorte');
  });
  it('dado antigo mantém o último valor marcado como sem atualização', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 7, 100), obs('c2', 5, 200)],
      mode: 'sessionStart',
      stale: true,
      latestCollectionId: 'c2',
    });
    expect(row).toMatchObject({ deltaRank: 2, stale: true });
  });
  it('referência "última atualização" compara com a coleta anterior', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 9, 100), obs('c2', 6, 200), obs('c3', 5, 300)],
      mode: 'lastUpdate',
      stale: false,
      latestCollectionId: 'c3',
    });
    expect(row).toMatchObject({ deltaRank: 1, referenceRank: 6, confirmed: true });
  });
  it('marcação manual reinicia em 0 após marcação', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('mark', 8, 500)],
      mode: 'manualMark',
      stale: false,
      latestCollectionId: 'c9',
    });
    expect(row.status).toBe('resetByMark');
    expect(deltaLabel(row)).toBe('0 após marcação');
  });
  it('destaque exige duas observações consecutivas na mesma direção', () => {
    const oneStep = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 10, 1), obs('c2', 8, 2)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c2',
    });
    expect(oneStep.confirmed).toBe(false);
    const flip = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 10, 1), obs('c2', 12, 2), obs('c3', 8, 3)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c3',
    });
    expect(flip.confirmed).toBe(false);
    const two = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 10, 1), obs('c2', 9, 2), obs('c3', 8, 3)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c3',
    });
    expect(two.confirmed).toBe(true);
  });
  it('separa deltaRank de deltaScore', () => {
    const row = computeProgress({
      userId: uid('x'),
      history: [obs('c1', 5, 1, 10), obs('c2', 5, 2, 13)],
      mode: 'sessionStart',
      stale: false,
      latestCollectionId: 'c2',
    });
    expect(row.deltaRank).toBe(0);
    expect(row.deltaScore).toBe(3);
  });
});

describe('Team Battle (T09)', () => {
  const snap = (() => {
    const r = validateBatch(
      batch([entry(1, 'A', 10, 'team-x'), entry(2, 'B', 8, 'team-y'), entry(3, 'C', 7, 'team-x')]),
    );
    if (!r.ok) throw new Error('lote');
    return r.snapshot;
  })();
  it('team no torneio tem precedência sobre o cadastro de membros', () => {
    expect(resolveTournamentTeam(uid('B'), snap, {}, [tid('team-x')])).toEqual({
      teamId: 'team-y',
      source: 'tournament',
    });
    expect(resolveTournamentTeam(uid('Z'), snap, { z: tid('team-z') }, [])).toEqual({
      teamId: 'team-z',
      source: 'duel',
    });
    expect(resolveTournamentTeam(uid('Z'), snap, {}, [tid('a'), tid('b')])).toEqual({
      teamId: null,
      source: 'none',
    });
  });
  it('Nosso team usa o vínculo do torneio e a lista local', () => {
    expect(ourTeamUserIds(tid('team-x'), snap, [uid('Q')], true).sort()).toEqual(['a', 'c', 'q']);
    expect(ourTeamUserIds(tid('team-x'), snap, [uid('Q')], false)).toEqual(['q']);
  });
});
