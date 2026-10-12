import { describe, expect, it, vi } from 'vitest';
import { RestQueue, NetworkError } from '../../src/adapters/lichess/rest/restQueue';
import { GameStreamConnection } from '../../src/adapters/lichess/streams/gameStream';
import type { ProgramChannel } from '../../src/application/session/sessionCoordinator';
import { SessionCoordinator } from '../../src/application/session/sessionCoordinator';
import type { StreamState } from '../../src/domain/entities/connection';
import type { GameId, TeamId } from '../../src/domain/entities/ids';
import { parseProgramMessage, PROTOCOL_VERSION } from '../../src/shared/protocol/messages';
import type { StudioToProgram } from '../../src/shared/protocol/messages';
import { sanitizeSettings } from '../../src/shared/settings';
import { TID, uid } from '../helpers';
import { descriptor, makeHarness, move, resolved, settle, START } from './harness';

const g = (s: string) => s as GameId;

describe('regressões da revisão de código', () => {
  it('sessão continuada mantém a geração (programas não descartam os ViewModels)', async () => {
    const h = await makeHarness();
    const s = h.session;
    for (const id of ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD']) s.selectGame(g(id));
    const before = s.selection.generation;
    await settle(10);
    s.dispose();
    const again = h.make(h.record);
    await again.start();
    await settle();
    expect(again.selection.generation).toBeGreaterThan(before);
    again.dispose();
  });

  it('fotos além de 4 MB seguem em vários lotes, sem marcar como ausentes', async () => {
    const h = await makeHarness();
    const coord = new SessionCoordinator({
      ...h.ctx,
      getSettings: () => sanitizeSettings({}),
      appVersion: '1',
      publishDelayMs: 1,
    });
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const photoId = `photo-${String(i).padStart(4, '0')}`;
      ids.push(photoId);
      await h.repos.photos.put({
        photoId,
        blob: new Blob([new Uint8Array(300 * 1024)], { type: 'image/webp' }),
        width: 512,
        height: 512,
        mime: 'image/webp',
        hash: 'x',
        createdAt: 0,
      });
    }
    const sent: StudioToProgram[] = [];
    const ch: ProgramChannel = { id: 'c', tabId: 1, post: (m) => sent.push(m) };
    await coord.attachProgram(ch, {
      url: `https://lichess.org/tournament/${TID}`,
      recognition: 'tournament',
      tournamentId: TID,
      domFormatHint: 'arena',
      viewport: { width: 1920, height: 1080, outerWidth: 1920, outerHeight: 1080, dpr: 1 },
    });
    await coord.handleProgramMessage('c', {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: null,
      tournamentId: TID,
      requestId: 'r',
      generation: 0,
      type: 'photoRequest',
      photoIds: ids,
    });
    const batches = sent.filter(
      (m): m is Extract<StudioToProgram, { type: 'photos' }> => m.type === 'photos',
    );
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b) => b.photos.map((p) => p.photoId)).sort()).toEqual(ids);
    expect(batches.flatMap((b) => b.missing)).toEqual([]);
    coord.dispose();
  });

  it('requisição REST parada expira e libera a fila', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))),
        ),
    );
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1000 });
    const p = q.request('a', 'https://lichess.org/api/a', async () => 1);
    const next = q.request('b', 'https://lichess.org/api/b', async () => 2);
    const assertion = expect(p).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(next).rejects.toBeInstanceOf(NetworkError);
    vi.useRealTimers();
  });

  it('stream sem bytes é relido em silêncio, sem alerta de desconexão', async () => {
    const states: StreamState[] = [];
    let calls = 0;
    const enc = new TextEncoder();
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      calls += 1;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              enc.encode(
                '{"id":"0u7534ir","players":{}}\n{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","wc":1,"bc":1}\n',
              ),
            );
            init?.signal?.addEventListener('abort', () => c.error(new DOMException('a', 'AbortError')));
          },
        }),
      );
    });
    const conn = new GameStreamConnection(
      g('0u7534ir'),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pause: { until: () => 0, set: () => undefined },
        idleTimeoutMs: 80,
      },
      {
        onMessage: () => undefined,
        onState: (s) => states.push(s),
        onDiagnostic: () => undefined,
      },
    );
    conn.start();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    conn.close();
    expect(states.some((s) => s.kind === 'reconnecting')).toBe(false);
    expect(states.filter((s) => s.kind === 'live').length).toBeGreaterThanOrEqual(3);
  });

  it('sessão descartada não abre streams; reinícios concorrentes não vazam conexões', async () => {
    const h = await makeHarness();
    h.session.dispose();
    h.session.selectGame(g('AAAAAAAA'));
    expect(h.streams.history).toEqual([]);

    const coord = new SessionCoordinator({
      ...h.ctx,
      getSettings: () => sanitizeSettings({}),
      appVersion: '1',
      publishDelayMs: 1,
    });
    const first = await coord.ensureSession(TID);
    first.selectGame(g('BBBBBBBB'));
    await settle(10);
    await Promise.all([
      coord.restartSession(TID, 'continue'),
      coord.restartSession(TID, 'continue'),
      coord.restartSession(TID, 'new'),
    ]);
    await settle(10);
    expect(coord.sessions.size).toBe(1);
    expect(h.streams.active()).toBeLessThanOrEqual(1);
    coord.dispose();
    expect(h.streams.active()).toBe(0);
  });

  it('falha ao carregar a partida de outro jogador restaura a intenção anterior (fixada)', async () => {
    const h = await makeHarness();
    const s = h.session;
    s.selectGame(g('XXXXXXXX'), { mode: 'pinned' });
    h.streams.emit(g('XXXXXXXX'), descriptor('XXXXXXXX', 'Xavier', 'Xuxa'));
    h.streams.emit(g('XXXXXXXX'), move(START));
    h.lichess.current.set('yuri', resolved('YYYYYYYY', 'Yuri', 'Yara', 'started'));
    await s.selectPlayer(uid('Yuri'), 'follow');
    h.streams.emit(g('YYYYYYYY'), descriptor('YYYYYYYY', 'Yuri', 'Yara', { variant: 'atomic' }));
    expect(s.game?.identity.gameId).toBe('XXXXXXXX');
    expect(s.selection).toMatchObject({ gameId: 'XXXXXXXX', mode: 'pinned', followedUserId: null });
  });

  it('aba Teams só aceita teams do Team Battle atual', async () => {
    const h = await makeHarness({
      info: { format: 'teamBattle', teams: [{ teamId: 'time-a' as TeamId, name: 'A' }] },
    });
    await h.session.refreshMeta();
    expect(await h.session.selectTournamentTeam('time-z' as TeamId)).toBe(false);
    expect(await h.session.selectTournamentTeam('time-a' as TeamId)).toBe(true);
    expect(h.session.record.teamId).toBe('time-a');
    const env = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's',
      tournamentId: TID,
      requestId: 'r',
      generation: 0,
    };
    expect(
      parseProgramMessage({ ...env, type: 'intent', intent: { type: 'selectTeam', teamId: '../x' } }),
    ).toBeNull();
    expect(
      parseProgramMessage({ ...env, type: 'intent', intent: { type: 'selectTeam', teamId: 'time-a' } }),
    ).toMatchObject({ intent: { teamId: 'time-a' } });
  });
});
