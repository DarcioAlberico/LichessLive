import type { GameOutcome } from '../entities/game';
import { isFinishedStatus } from '../entities/game';

/**
 * Controle de spoilers (SPEC 7.4, T16): o banner de resultado da partida principal só aparece
 * quando a própria fonte do tabuleiro entrega a descrição final. Resultados conhecidos antes por
 * outra fonte ficam restritos ao painel de operação, com aviso próprio.
 */

export interface ResultVisibility {
  /** Resultado que o programa (público) pode mostrar. */
  programOutcome: GameOutcome | null;
  /** Resultado antecipado, apenas para o operador. */
  earlyOutcomeForOperator: { outcome: GameOutcome; source: string } | null;
}

export function resultVisibility(
  boardOutcome: GameOutcome | null,
  earlyOutcome: { outcome: GameOutcome; source: string } | null,
): ResultVisibility {
  const boardFinished = boardOutcome !== null && isFinishedStatus(boardOutcome.status);
  return {
    programOutcome: boardFinished ? boardOutcome : null,
    earlyOutcomeForOperator: !boardFinished && earlyOutcome ? earlyOutcome : null,
  };
}
