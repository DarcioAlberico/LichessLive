import { describe, expect, it } from 'vitest';
import type { ProgramChannel } from '../../src/application/session/sessionCoordinator';
import { SessionCoordinator } from '../../src/application/session/sessionCoordinator';
import type { GameId } from '../../src/domain/entities/ids';
import type { PageInfo, StudioToProgram } from '../../src/shared/protocol/messages';
import { PROTOCOL_VERSION } from '../../src/shared/protocol/messages';
import { sanitizeSettings } from '../../src/shared/settings';
import { TID } from '../helpers';
import { descriptor, makeHarness, move, settle, START } from './harness';

function page(p: Partial<PageInfo> = {}): PageInfo {
  return {
    url: `https://lichess.org/tournament/${TID}`,
    recognition: 'tournament',
    tournamentId: TID,
    domFormatHint: 'arena',
    viewport: { width: 1920, height: 1080, outerWidth: 1936, outerHeight: 1150, dpr: 1 },
    ...p,
  };
}

function channel(id: string) {
  const sent: StudioToProgram[] = [];
  const ch: ProgramChannel = {
    id,
    tabId: 1,
    post: (m) => sent.push(JSON.parse(JSON.stringify(m)) as StudioToProgram),
  };
  return { ch, sent };
}

async function setup() {
  const h = await makeHarness();
  const coord = new SessionCoordinator({
    ...h.ctx,
    getSettings: () => sanitizeSettings({}),
    appVersion: '1.0.0',
    publishDelayMs: 1,
  });
  return { h, coord };
}

describe('SessionCoordinator', () => {
  it('uma sessão por torneio; segunda aba espelha a mesma sessão', async () => {
    const { coord } = await setup();
    const a = channel('a');
    const b = channel('b');
    await coord.attachProgram(a.ch, page());
    await coord.attachProgram(b.ch, page());
    expect(coord.sessions.size).toBe(1);
    await settle();
    const vmA = a.sent.find((m) => m.type === 'vm');
    const vmB = b.sent.find((m) => m.type === 'vm');
    expect(vmA && vmA.type === 'vm' && vmA.full).toBe(true);
    expect(vmB && vmB.sessionId).toBe(vmA && vmA.sessionId);
    coord.dispose();
  });

  it('envia só as seções alteradas, com generation da seleção', async () => {
    const { h, coord } = await setup();
    const a = channel('a');
    await coord.attachProgram(a.ch, page());
    await settle();
    const session = coord.sessions.get(TID)!;
    a.sent.length = 0;
    session.selectGame('XXXXXXXX' as GameId);
    h.streams.emit('XXXXXXXX' as GameId, descriptor('XXXXXXXX', 'A', 'B'));
    h.streams.emit('XXXXXXXX' as GameId, move(START));
    await new Promise((r) => setTimeout(r, 30));
    const vms = a.sent.filter((m): m is Extract<StudioToProgram, { type: 'vm' }> => m.type === 'vm');
    expect(vms.length).toBeGreaterThan(0);
    const last = vms.at(-1)!;
    expect(last.full).toBe(false);
    expect(last.generation).toBe(session.selection.generation);
    expect(Object.keys(last.patch)).toContain('main');
    expect(Object.keys(last.patch)).not.toContain('layout');
    coord.dispose();
  });

  it('Swiss e páginas incompatíveis recebem aviso, sem sessão', async () => {
    const { coord } = await setup();
    const s = channel('s');
    await coord.attachProgram(
      s.ch,
      page({ recognition: 'swiss', tournamentId: null, domFormatHint: 'swiss' }),
    );
    expect(s.sent.map((m) => m.type)).toEqual(['welcome', 'unsupported']);
    const o = channel('o');
    await coord.attachProgram(o.ch, page({ recognition: 'incompatible', tournamentId: null }));
    expect(o.sent.at(-1)?.type).toBe('unsupported');
    expect(coord.sessions.size).toBe(0);
  });

  it('intenção de sessão antiga é ignorada; intenção válida seleciona pelo ID', async () => {
    const { h, coord } = await setup();
    const a = channel('a');
    await coord.attachProgram(a.ch, page());
    const session = coord.sessions.get(TID)!;
    const env = { protocolVersion: PROTOCOL_VERSION, tournamentId: TID, requestId: 'r', generation: 0 };
    await coord.handleProgramMessage('a', {
      ...env,
      sessionId: 'sessao-velha',
      type: 'intent',
      intent: { type: 'selectGame', gameId: 'AAAAAAAA' },
    });
    expect(session.selection.gameId).toBeNull();
    await coord.handleProgramMessage('a', {
      ...env,
      sessionId: session.sessionId,
      type: 'intent',
      intent: { type: 'selectGame', gameId: 'AAAAAAAA' },
    });
    expect(session.selection.gameId).toBe('AAAAAAAA');
    expect(h.streams.history).toEqual(['AAAAAAAA']);
    coord.dispose();
  });

  it('entrega fotos normalizadas uma vez por programa', async () => {
    const { h, coord } = await setup();
    await h.repos.photos.put({
      photoId: 'photo-0001',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
      width: 512,
      height: 512,
      mime: 'image/webp',
      hash: 'x',
      createdAt: 0,
    });
    const a = channel('a');
    await coord.attachProgram(a.ch, page());
    const env = {
      protocolVersion: PROTOCOL_VERSION,
      tournamentId: TID,
      requestId: 'r',
      generation: 0,
      sessionId: null,
    };
    await coord.handleProgramMessage('a', {
      ...env,
      type: 'photoRequest',
      photoIds: ['photo-0001', 'photo-9999'],
    });
    const photos = a.sent.find((m) => m.type === 'photos');
    expect(photos && photos.type === 'photos' && photos.photos[0]).toMatchObject({
      photoId: 'photo-0001',
      base64: 'AQID',
    });
    expect(photos && photos.type === 'photos' && photos.missing).toEqual(['photo-9999']);
    a.sent.length = 0;
    await coord.handleProgramMessage('a', { ...env, type: 'photoRequest', photoIds: ['photo-0001'] });
    expect(a.sent.filter((m) => m.type === 'photos')).toHaveLength(0);
    coord.dispose();
  });

  it('continuar ou iniciar nova sessão para o mesmo torneio', async () => {
    const { h, coord } = await setup();
    const first = await coord.ensureSession(TID);
    const id1 = first.sessionId;
    const cont = await coord.restartSession(TID, 'continue');
    expect(cont.sessionId).toBe(id1);
    const fresh = await coord.restartSession(TID, 'new');
    expect(fresh.sessionId).not.toBe(id1);
    expect(fresh.record.referenceId).not.toBe(first.record.referenceId);
    expect(coord.sessions.size).toBe(1);
    coord.dispose();
    expect(h.streams.active()).toBe(0);
  });
});
