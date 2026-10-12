import { render } from 'preact';
import { startStudioRuntime } from './runtime';
import { StudioApp } from './StudioApp';

const root = document.getElementById('app')!;
startStudioRuntime()
  .then((rt) => render(<StudioApp rt={rt} />, root))
  .catch((err: unknown) => {
    root.textContent = `Falha ao iniciar o painel de operação: ${err instanceof Error ? err.message : String(err)}`;
  });
