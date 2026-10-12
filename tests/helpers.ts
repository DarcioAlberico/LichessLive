import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RankingEntry } from '../src/domain/ranking/batch';
import type { TeamId, TournamentId, UserId } from '../src/domain/entities/ids';

export const FIXTURES = resolve(__dirname, 'fixtures');

export function fixtureText(path: string): string {
  return readFileSync(resolve(FIXTURES, path), 'utf8');
}

export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixtureText(path)) as T;
}

export function ndjsonLines(path: string): unknown[] {
  return fixtureText(path)
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

export const TID = 'Tour1234' as TournamentId;
export const uid = (s: string) => s.toLowerCase() as UserId;
export const tid = (s: string) => s as TeamId;

export function entry(
  rank: number,
  username: string,
  score: number,
  teamId: string | null = null,
): RankingEntry {
  return {
    userId: uid(username),
    username,
    title: null,
    rank,
    score,
    rating: 1500,
    performance: null,
    teamId: teamId as TeamId | null,
  };
}

/** Corpo de resposta em streaming a partir de pedaços de bytes. */
export function streamOf(chunks: (string | Uint8Array)[], delayMs = 0): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const c = chunks[i++]!;
      controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
    },
  });
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise<void>((r) => setImmediate(r));
