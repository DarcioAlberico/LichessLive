import { SELECTORS } from '../selectors';

/**
 * Dica opcional de Team Battle no DOM. O formato oficial vem do campo teamBattle da API; esta dica
 * apenas antecipa a interface e pode falhar sem afetar o produto.
 */
export function detectTeamBattleHint(doc: Document): boolean {
  for (const sel of SELECTORS.teamBattleHints) {
    try {
      if (doc.querySelector(sel)) return true;
    } catch {
      /* seletor incompatível: ignora a dica */
    }
  }
  return false;
}
