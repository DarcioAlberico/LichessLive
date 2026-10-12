import type { GameStreamPort, GameStreamSubscriber } from '../../../application/ports';
import type { StreamState } from '../../../domain/entities/connection';
import type { GameStreamMessage } from '../../../domain/entities/game';
import type { GameId } from '../../../domain/entities/ids';
import type { GameStreamDeps } from './gameStream';
import { GameStreamConnection } from './gameStream';

interface Entry {
  conn: GameStreamConnection;
  subscribers: Set<GameStreamSubscriber>;
  /** Mensagens recebidas, para reproduzir a novos assinantes do mesmo gameId. */
  descriptor: GameStreamMessage | null;
  lastMove: GameStreamMessage | null;
  finalDescriptor: GameStreamMessage | null;
  state: StreamState;
}

/**
 * Deduplica streams do mesmo gameId entre sessões (SPEC 8.3) e encerra a conexão quando o último
 * assinante sai — nenhum stream órfão (T13).
 */
export class GameStreamHub implements GameStreamPort {
  private readonly entries = new Map<GameId, Entry>();

  constructor(private readonly deps: GameStreamDeps) {}

  subscribe(gameId: GameId, subscriber: GameStreamSubscriber): () => void {
    let entry = this.entries.get(gameId);
    if (!entry) {
      const created: Entry = {
        conn: undefined as unknown as GameStreamConnection,
        subscribers: new Set(),
        descriptor: null,
        lastMove: null,
        finalDescriptor: null,
        state: { kind: 'idle' },
      };
      created.conn = new GameStreamConnection(gameId, this.deps, {
        onMessage: (msg) => {
          if (msg.kind === 'descriptor') {
            if (msg.status && msg.status !== 'started' && msg.status !== 'created')
              created.finalDescriptor = msg;
            else created.descriptor = msg;
          } else created.lastMove = msg;
          for (const s of created.subscribers) s.onMessage(msg);
        },
        onState: (state) => {
          created.state = state;
          for (const s of created.subscribers) s.onState(state);
        },
        onDiagnostic: (kind, message) => {
          for (const s of created.subscribers) s.onDiagnostic(kind, message);
        },
      });
      entry = created;
      this.entries.set(gameId, entry);
      entry.subscribers.add(subscriber);
      entry.conn.start();
    } else {
      entry.subscribers.add(subscriber);
      // Reproduz o estado conhecido para o novo assinante.
      subscriber.onState(entry.state);
      if (entry.descriptor) subscriber.onMessage(entry.descriptor);
      if (entry.lastMove) subscriber.onMessage(entry.lastMove);
      if (entry.finalDescriptor) subscriber.onMessage(entry.finalDescriptor);
    }
    const current = entry;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      current.subscribers.delete(subscriber);
      if (current.subscribers.size === 0) {
        current.conn.close();
        if (this.entries.get(gameId) === current) this.entries.delete(gameId);
      }
    };
  }

  activeCount(): number {
    return this.entries.size;
  }

  closeAll(): void {
    for (const e of this.entries.values()) e.conn.close();
    this.entries.clear();
  }
}
