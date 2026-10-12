import { SELECTORS } from '../selectors';

/** Dica de página de Arena pelo contêiner principal (main.tour). */
export function detectArenaPage(doc: Document): boolean {
  try {
    return doc.querySelector(SELECTORS.arenaMain) !== null;
  } catch {
    return false;
  }
}
