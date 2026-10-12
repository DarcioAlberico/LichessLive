import { recognizeUrl } from '../../domain/entities/tournament';
import type { PageInfo } from '../../shared/protocol/messages';
import { detectArenaPage } from './arena';
import { SELECTORS } from './selectors';
import { detectTeamBattleHint } from './teamBattle';

/** Reconhece a página atual por URL e, quando possível, por dicas validadas do DOM (T02). */
export function recognizePage(doc: Document, win: Window): PageInfo {
  const rec = recognizeUrl(win.location.href);
  let hint: PageInfo['domFormatHint'] = 'unknown';
  if (rec.kind === 'swiss' || doc.querySelector(SELECTORS.swissMain)) hint = 'swiss';
  else if (detectTeamBattleHint(doc)) hint = 'teamBattle';
  else if (detectArenaPage(doc)) hint = 'arena';
  return {
    url: win.location.href,
    recognition: rec.kind,
    tournamentId: rec.kind === 'tournament' ? rec.tournamentId : null,
    domFormatHint: hint,
    viewport: {
      width: win.innerWidth,
      height: win.innerHeight,
      outerWidth: win.outerWidth,
      outerHeight: win.outerHeight,
      dpr: win.devicePixelRatio || 1,
    },
  };
}
