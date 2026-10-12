/**
 * Parser NDJSON incremental (SPEC 11.2, T15):
 * - mantém buffer entre chunks e suporta UTF-8 fragmentado (TextDecoder em modo stream);
 * - ignora linhas vazias de heartbeat;
 * - valida cada registro; linha inválida gera diagnóstico;
 * - limita o tamanho do buffer e de cada mensagem.
 */

export interface NdjsonLimits {
  /** Tamanho máximo de uma linha (caracteres). */
  maxLineLength: number;
  /** Tamanho máximo do buffer pendente sem quebra de linha. */
  maxBufferLength: number;
}

export const DEFAULT_NDJSON_LIMITS: NdjsonLimits = {
  maxLineLength: 256 * 1024,
  maxBufferLength: 512 * 1024,
};

export type NdjsonEvent =
  | { kind: 'record'; value: unknown }
  | { kind: 'heartbeat' }
  | { kind: 'invalidLine'; error: string; sample: string };

export class NdjsonOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdjsonOverflowError';
  }
}

export class NdjsonParser {
  private readonly decoder = new TextDecoder('utf-8');
  private buffer = '';

  constructor(private readonly limits: NdjsonLimits = DEFAULT_NDJSON_LIMITS) {}

  /** Processa um chunk de bytes e devolve os eventos completos. */
  push(chunk: Uint8Array): NdjsonEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Sinaliza fim do stream; processa uma última linha sem quebra. */
  end(): NdjsonEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): NdjsonEvent[] {
    const events: NdjsonEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      events.push(this.parseLine(line));
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.limits.maxBufferLength) {
      this.buffer = '';
      throw new NdjsonOverflowError(
        `buffer excedeu ${this.limits.maxBufferLength} caracteres sem quebra de linha`,
      );
    }
    if (final && this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = '';
      events.push(this.parseLine(line));
    }
    return events;
  }

  private parseLine(raw: string): NdjsonEvent {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return { kind: 'heartbeat' };
    if (line.length > this.limits.maxLineLength) {
      return {
        kind: 'invalidLine',
        error: `linha com ${line.length} caracteres excede o limite`,
        sample: line.slice(0, 80),
      };
    }
    try {
      return { kind: 'record', value: JSON.parse(line) as unknown };
    } catch (err) {
      return {
        kind: 'invalidLine',
        error: err instanceof Error ? err.message : 'JSON inválido',
        sample: line.slice(0, 80),
      };
    }
  }
}

/** Lê um corpo NDJSON finito por completo (respostas REST como /results e /team/users). */
export async function readNdjsonBody(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: NdjsonEvent) => void,
  options: { maxRecords?: number; limits?: NdjsonLimits; signal?: AbortSignal } = {},
): Promise<{ records: number; truncated: boolean }> {
  const parser = new NdjsonParser(options.limits);
  const reader = body.getReader();
  let records = 0;
  let truncated = false;
  try {
    for (;;) {
      if (options.signal?.aborted) throw new DOMException('Abortado', 'AbortError');
      const { done, value } = await reader.read();
      const events = done ? parser.end() : parser.push(value);
      for (const e of events) {
        if (e.kind === 'record') {
          records += 1;
          if (options.maxRecords !== undefined && records > options.maxRecords) {
            truncated = true;
            break;
          }
        }
        onEvent(e);
      }
      if (done || truncated) break;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { records: truncated ? records - 1 : records, truncated };
}
