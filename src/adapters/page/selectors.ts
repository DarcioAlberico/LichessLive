/**
 * Registro de seletores do Lichess (SPEC 12). Todo acoplamento com o DOM do Lichess fica aqui,
 * conferido com as páginas reais em 12/10/2026 (tests/fixtures/pages). Um seletor incompatível
 * desativa apenas a dica de formato; o restante do produto continua pela API.
 */
export const SELECTORS = {
  arenaMain: 'main.tour',
  swissMain: 'main.swiss',
  /** Dicas de Team Battle na página (opcionais; o formato oficial vem da API). */
  teamBattleHints: ['.tour__team-standing', '.tour__team-info', '.tour__controls .team-battle'],
} as const;

export const ROOT_ID = 'lts-root';
export const PAGE_STYLE_ID = 'lts-page-style';
export const ACTIVE_CLASS = 'lts-active';
