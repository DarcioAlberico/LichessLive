import type { Migration } from './migrations';
import { MIGRATIONS, STORES } from './migrations';

export const DB_NAME = 'lichess-team-studio';

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha no IndexedDB'));
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transação abortada'));
    tx.onerror = () => reject(tx.error ?? new Error('Falha na transação'));
  });
}

export interface OpenResult {
  db: IDBDatabase;
  version: number;
  /** Migração falhou: banco aberto na versão anterior, dados preservados. */
  migrationError: string | null;
  migratedFrom: number | null;
}

export interface OpenOptions {
  name?: string;
  migrations?: Migration[];
  factory?: IDBFactory;
}

/**
 * Abre o banco aplicando migrações pendentes em ordem. Em falha, a transação de upgrade é abortada,
 * o banco volta a ser aberto na versão anterior e o erro é informado para que o operador exporte
 * um backup antes de qualquer outra ação.
 */
export async function openDatabase(opts: OpenOptions = {}): Promise<OpenResult> {
  const name = opts.name ?? DB_NAME;
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  const factory = opts.factory ?? indexedDB;
  const target = migrations[migrations.length - 1]?.version ?? 1;
  let migratedFrom: number | null = null;

  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, target);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction!;
        const from = event.oldVersion;
        migratedFrom = from;
        try {
          for (const m of migrations) {
            if (m.version > from && m.version <= target) m.up(db, tx);
          }
          const meta = tx.objectStore(STORES.meta);
          meta.put({ key: `migration:${target}`, from, to: target, at: Date.now() });
        } catch (err) {
          tx.abort();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o banco'));
      request.onblocked = () => reject(new Error('Banco bloqueado por outra janela da extensão'));
    });
    db.onversionchange = () => db.close();
    return { db, version: db.version, migrationError: null, migratedFrom };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Banco novo sem dados: não há versão anterior para preservar.
    if (!migratedFrom) throw err instanceof Error ? err : new Error(message);
    // Reabre sem pedir versão: mantém a versão anterior e os dados existentes.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Falha ao reabrir o banco'));
    });
    return { db, version: db.version, migrationError: message, migratedFrom };
  }
}
