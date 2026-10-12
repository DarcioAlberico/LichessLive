import { describe, expect, it } from 'vitest';
import { NdjsonOverflowError, NdjsonParser, readNdjsonBody } from '../../src/adapters/lichess/streams/ndjson';
import { fixtureText, streamOf } from '../helpers';

const enc = new TextEncoder();

function records(events: ReturnType<NdjsonParser['push']>) {
  return events.filter((e) => e.kind === 'record').map((e) => (e as { value: unknown }).value);
}

describe('parser NDJSON incremental (T15)', () => {
  it('recompõe linhas cortadas em qualquer byte, inclusive UTF-8 multibyte', () => {
    const text =
      fixtureText('lichess/teambattle-teams.json').replace(/\n/g, '') +
      '\n' +
      '{"name":"Клуб имени Михаила Чигорина ♞"}\n';
    const bytes = enc.encode(text);
    for (const step of [1, 2, 3, 7, 64]) {
      const p = new NdjsonParser();
      const out: unknown[] = [];
      for (let i = 0; i < bytes.length; i += step) out.push(...records(p.push(bytes.subarray(i, i + step))));
      out.push(...records(p.end()));
      expect(out).toHaveLength(2);
      expect((out[1] as { name: string }).name).toBe('Клуб имени Михаила Чигорина ♞');
    }
  });
  it('ignora linhas vazias de heartbeat e aceita CRLF', () => {
    const p = new NdjsonParser();
    const ev = p.push(enc.encode('\n\n{"a":1}\r\n\n{"b":2}\n'));
    expect(ev.filter((e) => e.kind === 'heartbeat')).toHaveLength(3);
    expect(records(ev)).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('linha inválida gera diagnóstico sem derrubar o canal', () => {
    const p = new NdjsonParser();
    const ev = p.push(enc.encode('{"a":1}\n{quebrado\n{"b":2}\n'));
    expect(ev.map((e) => e.kind)).toEqual(['record', 'invalidLine', 'record']);
  });
  it('última linha sem quebra é processada no fim', () => {
    const p = new NdjsonParser();
    expect(records(p.push(enc.encode('{"a":1}')))).toEqual([]);
    expect(records(p.end())).toEqual([{ a: 1 }]);
  });
  it('limita buffer e tamanho de mensagem', () => {
    const p = new NdjsonParser({ maxLineLength: 20, maxBufferLength: 50 });
    const ev = p.push(enc.encode(`{"x":"${'a'.repeat(30)}"}\n`));
    expect(ev[0]?.kind).toBe('invalidLine');
    expect(() => p.push(enc.encode('a'.repeat(60)))).toThrow(NdjsonOverflowError);
  });
  it('lê corpo finito com limite de registros', async () => {
    const body = streamOf(['{"a":1}\n{"a":', '2}\n{"a":3}\n{"a":4}\n']);
    const seen: unknown[] = [];
    const res = await readNdjsonBody(body, (e) => e.kind === 'record' && seen.push(e.value), {
      maxRecords: 3,
    });
    expect(res).toEqual({ records: 3, truncated: true });
    expect(seen).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });
});
