import { describe, expect, it, vi } from 'vitest';
import { GameStreamConnection } from '../../src/adapters/lichess/streams/gameStream';
import { GameStreamHub } from '../../src/adapters/lichess/streams/streamHub';
import type { StreamState } from '../../src/domain/entities/connection';
import type { GameStreamMessage } from '../../src/domain/entities/game';
import type { GameId } from '../../src/domain/entities/ids';
import { fixtureText, streamOf } from '../helpers';

const GID = '0u7534ir' as GameId;
const finished = fixtureText('lichess/stream-game-finished.ndjson');

function collect() {
  const messages: GameStreamMessage[] = [];
  const states: StreamState[] = [];
  const diags: string[] = [];
  return {
    messages,
    states,
    diags,
    handlers: {
      onMessage: (m: GameStreamMessage) => messages.push(m),
      onState: (s: StreamState) => states.push(s),
      onDiagnostic: (k: string, m: string) => diags.push(`${k}:${m}`),
    },
  };
}

const noPause = { until: () => 0, set: () => undefined };

describe('stream de lances', () => {
  it('fim normal após o resultado não é falha', async () => {
    const c = collect();
    const fetchImpl = vi.fn(
      async () => new Response(streamOf([finished.slice(0, 100), finished.slice(100)])),
    );
    const conn = new GameStreamConnection(
      GID,
      { fetchImpl: fetchImpl as unknown as typeof fetch, pause: noPause },
      c.handlers,
    );
    conn.start();
    await vi.waitFor(() => expect(c.states.at(-1)?.kind).toBe('ended'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.messages[0]?.kind).toBe('descriptor');
    expect(c.messages.at(-1)).toMatchObject({ kind: 'descriptor', status: 'mate' });
  });

  it('reconecta com espera após erro transitório (T05)', async () => {
    vi.useFakeTimers();
    const c = collect();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(streamOf([finished])));
    const conn = new GameStreamConnection(GID, { fetchImpl, pause: noPause, random: () => 0.5 }, c.handlers);
    conn.start();
    await vi.waitFor(() => expect(c.states.some((s) => s.kind === 'reconnecting')).toBe(true));
    const rec = c.states.find((s) => s.kind === 'reconnecting');
    expect(rec).toMatchObject({ attempt: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(c.states.at(-1)?.kind).toBe('ended'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('429 registra pausa global e não reconecta durante a pausa', async () => {
    vi.useFakeTimers();
    const c = collect();
    let pausedUntil = 0;
    const pause = { until: () => pausedUntil, set: (u: number) => (pausedUntil = u) };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValue(new Response(streamOf([finished])));
    const conn = new GameStreamConnection(GID, { fetchImpl, pause }, c.handlers);
    conn.start();
    await vi.waitFor(() => expect(c.states.some((s) => s.kind === 'paused')).toBe(true));
    expect(pausedUntil - Date.now()).toBeGreaterThanOrEqual(59_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    conn.close();
  });

  it('erro de contrato crítico interrompe o canal', async () => {
    const c = collect();
    const fetchImpl = vi.fn(async () => new Response(streamOf(['{"id":"XXXXXXXX"}\n'])));
    const conn = new GameStreamConnection(
      GID,
      { fetchImpl: fetchImpl as unknown as typeof fetch, pause: noPause },
      c.handlers,
    );
    conn.start();
    await vi.waitFor(() => expect(c.states.at(-1)?.kind).toBe('error'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.diags.join()).toMatch(/contract/);
  });

  it('hub deduplica o mesmo gameId e encerra sem assinantes (nenhum stream órfão)', async () => {
    const aborted: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => aborted.push('x'));
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(finished.split('\n').slice(0, 3).join('\n') + '\n'));
            init?.signal?.addEventListener('abort', () =>
              ctrl.error(new DOMException('abort', 'AbortError')),
            );
          },
        }),
      );
    });
    const hub = new GameStreamHub({ fetchImpl: fetchImpl as unknown as typeof fetch, pause: noPause });
    const a = collect();
    const b = collect();
    const offA = hub.subscribe(GID, a.handlers);
    await vi.waitFor(() => expect(a.messages.length).toBeGreaterThan(1));
    const offB = hub.subscribe(GID, b.handlers);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(b.messages.length).toBeGreaterThan(0);
    offA();
    expect(hub.activeCount()).toBe(1);
    offB();
    expect(hub.activeCount()).toBe(0);
    await vi.waitFor(() => expect(aborted.length).toBe(1));
  });
});
