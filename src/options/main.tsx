import { render } from 'preact';
import { LichessClient } from '../adapters/lichess/rest/lichessClient';
import { RestQueue } from '../adapters/lichess/rest/restQueue';
import { openPersistence } from '../persistence';
import { StoragePause } from '../shared/extension';
import { OptionsApp } from './OptionsApp';

const root = document.getElementById('app')!;
void (async () => {
  try {
    const persistence = await openPersistence();
    // Fila própria desta página, com a pausa global por 429 compartilhada com o painel.
    const queue = new RestQueue({ fetchImpl: (...a) => fetch(...a), sharedPause: new StoragePause() });
    const client = new LichessClient(queue);
    render(
      <OptionsApp deps={{ persistence, client, version: chrome.runtime.getManifest().version }} />,
      root,
    );
  } catch (err) {
    root.textContent = `Falha ao abrir o cadastro: ${err instanceof Error ? err.message : String(err)}`;
  }
})();
