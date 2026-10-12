/** Validação em tempo de execução nas fronteiras (sem dependências externas). */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Erro de contrato: o formato recebido não corresponde ao esperado. */
export class ContractError extends Error {
  constructor(
    public readonly channel: string,
    message: string,
  ) {
    super(`[${channel}] ${message}`);
    this.name = 'ContractError';
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
