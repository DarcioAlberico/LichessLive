import type { ComponentChildren } from 'preact';
import { Component } from 'preact';

interface Props {
  children: ComponentChildren;
  onError: (err: unknown) => void;
}

/**
 * Falha de desenho nunca deixa a composição transparente sobre a página: mostra o erro de forma
 * visível (para o operador e para o diagnóstico) em vez de exibir a página do Lichess por baixo.
 */
export class ErrorBoundary extends Component<Props, { error: string | null }> {
  override state = { error: null as string | null };

  override componentDidCatch(err: unknown): void {
    this.props.onError(err);
    this.setState({ error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }

  override render() {
    if (this.state.error) {
      return (
        <div class="lts-center-msg" style={{ background: '#101722', color: '#F4F7FB' }} role="alert">
          <div>
            <h1>Lichess Team Studio — erro ao desenhar a composição</h1>
            <p style={{ color: '#FF9B9B', fontFamily: 'Consolas, monospace' }}>{this.state.error}</p>
            <p style={{ color: '#B9C4D2' }}>
              Recarregue a página (F5). Se continuar, exporte o diagnóstico no painel de operação.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
