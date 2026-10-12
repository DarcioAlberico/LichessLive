import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LichessClient } from '../../src/adapters/lichess/rest/lichessClient';
import { HttpError, RateLimitedError, RestQueue } from '../../src/adapters/lichess/rest/restQueue';
import type { TournamentId, UserId } from '../../src/domain/entities/ids';
import { deferred, fixtureText, flush } from '../helpers';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('fila REST (RF13, T13)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('executa uma requisição por vez', async () => {
    let active = 0;
    let maxActive = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      const gate = gates[i++]!;
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      return json({ ok: true });
    });
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const ps = ['a', 'b', 'c'].map((k) =>
      q.request(k, `https://lichess.org/api/${k}`, async (r) => r.json()),
    );
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    gates[0]!.resolve();
    await flush();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(ps);
    expect(maxActive).toBe(1);
  });

  it('deduplica pedidos iguais e usa cache curto', async () => {
    const fetchImpl = vi.fn(async () => json({ n: 1 }));
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [a, b] = await Promise.all([
      q.request('k', 'https://lichess.org/api/x', async (r) => r.json(), { ttlMs: 5000 }),
      q.request('k', 'https://lichess.org/api/x', async (r) => r.json(), { ttlMs: 5000 }),
    ]);
    expect(a).toEqual(b);
    await q.request('k', 'https://lichess.org/api/x', async (r) => r.json(), { ttlMs: 5000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    await q.request('k', 'https://lichess.org/api/x', async (r) => r.json(), { ttlMs: 5000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('HTTP 429 impõe pausa global de pelo menos 60 s ou o Retry-After maior', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '90' } }))
      .mockResolvedValue(json({ ok: 1 }));
    const shared = {
      v: 0,
      read() {
        return this.v;
      },
      write(u: number) {
        this.v = u;
      },
    };
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, sharedPause: shared });
    const start = Date.now();
    await expect(q.request('a', 'https://lichess.org/api/a', async (r) => r.json())).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    expect(q.isPaused()).toBe(true);
    expect(shared.v - start).toBeGreaterThanOrEqual(90_000);
    const next = q.request('b', 'https://lichess.org/api/b', async (r) => r.json());
    await flush();
    vi.advanceTimersByTime(60_000);
    await flush();
    // Ainda dentro da pausa de 90 s: nenhuma nova requisição.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await expect(next).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(q.frequencyFactor()).toBeGreaterThan(1);
  });

  it('respeita pausa registrada por outro contexto', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const shared = { read: () => Date.now() + 60_000, write: () => undefined };
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, sharedPause: shared });
    void q.request('a', 'https://lichess.org/api/a', async (r) => r.json()).catch(() => undefined);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    q.dispose();
  });

  it('cancelamento retira o pedido da fila', async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(json({}));
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const first = q.request('a', 'https://lichess.org/api/a', async (r) => r.json());
    const ctrl = new AbortController();
    const second = q.request('b', 'https://lichess.org/api/b', async (r) => r.json(), {
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve(json({ ok: 1 }));
    await first;
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('nunca busca URL fora da API do Lichess', async () => {
    const fetchImpl = vi.fn();
    const q = new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(q.request('x', 'https://evil.example/api', async () => 1)).rejects.toThrow(/URL fora/);
    await expect(q.request('y', 'https://lichess.org/@/x', async () => 1)).rejects.toThrow(/URL fora/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('cliente do Lichess', () => {
  it('lê resultados NDJSON e current-game 404 como ausência', async () => {
    const ndjson = fixtureText('lichess/teambattle-results.ndjson');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/results')) return new Response(ndjson, { status: 200 });
      if (url.includes('current-game')) return new Response('', { status: 404 });
      return new Response('', { status: 500 });
    });
    const client = new LichessClient(new RestQueue({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    const r = await client.results('YVqdsK7c' as TournamentId, 5);
    expect(r.entries).toHaveLength(5);
    expect(r.requestedNb).toBe(5);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://lichess.org/api/tournament/YVqdsK7c/results?nb=5&sheet=false',
    );
    expect(await client.currentGame('ghost' as UserId)).toBeNull();
    await expect(client.teamStandings('YVqdsK7c' as TournamentId)).rejects.toBeInstanceOf(HttpError);
  });
});
