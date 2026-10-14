// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ProgramOverlay } from '../../src/adapters/page/overlay';
import { recognizePage } from '../../src/adapters/page/recognizePage';
import { ACTIVE_CLASS, PAGE_STYLE_ID, ROOT_ID } from '../../src/adapters/page/selectors';
import { buildProgramViewModel } from '../../src/application/session/programViewModel';
import type { GameId } from '../../src/domain/entities/ids';
import { INITIAL_FEN } from '../../src/domain/entities/fen';
import { BoardView } from '../../src/presentation/board/boardView';
import { ProgramApp } from '../../src/presentation/components/ProgramApp';
import { PROGRAM_CSS } from '../../src/presentation/components/programCss';
import { applyFrozenOrder, HOLD_MS, VirtualList } from '../../src/presentation/components/VirtualList';
import { DEFAULT_PRESET } from '../../src/presentation/layouts/presets';
import { entry, uid } from '../helpers';
import { AFTER_E4, descriptor, makeHarness, move } from './harness';

describe('BoardView', () => {
  it('cria 64 casas uma vez e só altera as casas que mudaram', () => {
    const b = new BoardView(document);
    document.body.appendChild(b.element);
    b.update({ fen: INITIAL_FEN, lastMove: null, orientation: 'white' });
    expect(b.element.querySelectorAll('.lts-sq')).toHaveLength(64);
    expect(b.element.querySelectorAll('.lts-piece')).toHaveLength(32);
    const squares = [...b.element.querySelectorAll('.lts-sq')];
    const untouched = squares[0]!.firstChild;
    b.update({ fen: AFTER_E4, lastMove: 'e2e4', orientation: 'white' });
    expect([...b.element.querySelectorAll('.lts-sq')]).toEqual(squares);
    expect(squares[0]!.firstChild).toBe(untouched);
    expect(b.element.querySelectorAll('.lts-sq.lm')).toHaveLength(2);
    expect(b.snapshot()[36]).toBe('wP');
    expect(b.snapshot()[52]).toBeNull();
    // Mesma entrada não renderiza de novo (não pisca).
    const renders = b.renders;
    b.update({ fen: AFTER_E4, lastMove: 'e2e4', orientation: 'white' });
    expect(b.renders).toBe(renders);
  });
  it('girar reposiciona sem recriar; FEN inválida é ignorada', () => {
    const b = new BoardView(document);
    b.update({ fen: INITIAL_FEN, lastMove: null, orientation: 'white' });
    const a8 = b.element.querySelectorAll<HTMLElement>('.lts-sq')[0]!;
    expect(a8.style.top).toBe('0%');
    b.update({ fen: INITIAL_FEN, lastMove: null, orientation: 'black' });
    expect(a8.style.top).toBe('87.5%');
    expect(a8.style.left).toBe('87.5%');
    b.update({ fen: 'quebrada', lastMove: null, orientation: 'black' });
    expect(b.element.querySelectorAll('.lts-piece')).toHaveLength(32);
  });
});

describe('ativação reversível da página (T01, RF01)', () => {
  it('ativar e desativar dez vezes mantém um root e restaura a página', () => {
    document.body.innerHTML = '<main class="tour"><div id="native">tabuleiro nativo</div></main>';
    const native = document.getElementById('native');
    const overlay = new ProgramOverlay(document, PROGRAM_CSS);
    for (let i = 0; i < 10; i++) {
      overlay.mount();
      overlay.mount();
      expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);
      expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(true);
      expect(document.body.inert).toBe(true);
      overlay.unmount();
      expect(document.getElementById(ROOT_ID)).toBeNull();
      expect(document.getElementById(PAGE_STYLE_ID)).toBeNull();
      expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(false);
      expect(document.body.inert).toBe(false);
    }
    // Elementos nativos nunca são destruídos.
    expect(document.getElementById('native')).toBe(native);
  });
  it('remonta o root se a página removê-lo', async () => {
    const overlay = new ProgramOverlay(document, PROGRAM_CSS);
    const onRemount = vi.fn();
    overlay.mount(onRemount);
    document.getElementById(ROOT_ID)!.remove();
    await new Promise((r) => setTimeout(r, 250));
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);
    expect(onRemount).toHaveBeenCalled();
    overlay.unmount();
  });
  it('reconhece Arena pela URL e dica de DOM; página comum é incompatível (T02)', () => {
    document.body.innerHTML = '<main class="tour"></main>';
    const fakeWin = {
      location: { href: 'https://lichess.org/tournament/Gxx2vWUz' },
      innerWidth: 1920,
      innerHeight: 1080,
      outerWidth: 1936,
      outerHeight: 1150,
      devicePixelRatio: 1,
    } as unknown as Window;
    expect(recognizePage(document, fakeWin)).toMatchObject({
      recognition: 'tournament',
      tournamentId: 'Gxx2vWUz',
      domFormatHint: 'arena',
    });
    document.body.innerHTML = '<main class="swiss"></main>';
    const swiss = {
      ...fakeWin,
      location: { href: 'https://lichess.org/swiss/B032EEeq' },
    } as unknown as Window;
    expect(recognizePage(document, swiss)).toMatchObject({ recognition: 'swiss', domFormatHint: 'swiss' });
    const other = { ...fakeWin, location: { href: 'https://lichess.org/' } } as unknown as Window;
    expect(recognizePage(document, other).recognition).toBe('incompatible');
  });
});

describe('composição capturada (T10, T11)', () => {
  async function buildVm() {
    const h = await makeHarness({ teamId: 'meu-team' });
    const s = h.session;
    await h.repos.watchlists.put({
      teamId: 'meu-team' as never,
      profileId: 'default',
      userIds: [uid('DarcioAlberico')],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    });
    await s.reloadLocalData();
    await s.refreshMeta();
    h.lichess.resultsQueue.push([entry(1, 'Carlsen', 30), entry(2, 'DarcioAlberico', 20)]);
    await s.collectRanking();
    s.selectGame('XXXXXXXX' as GameId);
    h.streams.emit(
      'XXXXXXXX' as GameId,
      descriptor('XXXXXXXX', 'Um_Nome_De_Jogador_Bem_Longo', 'DarcioAlberico'),
    );
    h.streams.emit('XXXXXXXX' as GameId, move(AFTER_E4, 'e2e4', 175, 180));
    return buildProgramViewModel(s, {
      timezone: 'America/Sao_Paulo',
      preset: DEFAULT_PRESET,
      now: Date.now(),
      reducedMotion: true,
    });
  }

  it('não mostra formulários nem controles do operador', async () => {
    const vm = await buildVm();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const intents: unknown[] = [];
    act(() => {
      render(
        <ProgramApp
          vm={vm}
          photoUrl={() => null}
          onIntent={(i) => intents.push(i)}
          panel="connected"
          unsupported={null}
          onOpenPanel={() => undefined}
          onExit={() => undefined}
          version="1.0.0"
        />,
        host,
      );
    });
    expect(host.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
    expect(host.querySelectorAll('.lts-piece')).toHaveLength(32);
    expect(host.textContent).toContain('Lances com atraso da API (3 lances)');
    expect(host.textContent).toContain('Um_Nome_De_Jogador_Bem_Longo');
    // Iniciais para quem não tem foto.
    expect([...host.querySelectorAll('.lts-photo')].map((e) => e.textContent)).toContain('DA');
    // Abas com semântica apropriada.
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4);
    expect(host.querySelector('[role="tabpanel"]')).toBeTruthy();
    const tab = host.querySelector<HTMLButtonElement>('#lts-tab-ranking')!;
    act(() => tab.click());
    expect(intents).toContainEqual({ type: 'setTab', tab: 'ranking' });
    render(null, host);
  });

  it('painel desconectado é informado e oferece reabertura', async () => {
    const vm = await buildVm();
    const host = document.createElement('div');
    const open = vi.fn();
    act(() => {
      render(
        <ProgramApp
          vm={vm}
          photoUrl={() => null}
          onIntent={() => undefined}
          panel="disconnected"
          unsupported={null}
          onOpenPanel={open}
          onExit={() => undefined}
          version="1.0.0"
        />,
        host,
      );
    });
    expect(host.textContent).toContain('Painel desconectado');
    act(() => host.querySelector<HTMLButtonElement>('.lts-banner button')!.click());
    expect(open).toHaveBeenCalled();
    act(() => {
      render(
        <ProgramApp
          vm={null}
          photoUrl={() => null}
          onIntent={() => undefined}
          panel="disconnected"
          unsupported={null}
          onOpenPanel={open}
          onExit={() => undefined}
          version="1.0.0"
        />,
        host,
      );
    });
    expect(host.textContent).toContain('Painel de operação desconectado');
  });

  it('Swiss é informado como não suportado', () => {
    const host = document.createElement('div');
    act(() => {
      render(
        <ProgramApp
          vm={null}
          photoUrl={() => null}
          onIntent={() => undefined}
          panel="connected"
          unsupported="Torneios Swiss não são suportados na versão 1.0."
          onOpenPanel={() => undefined}
          onExit={() => undefined}
          version="1.0.0"
        />,
        host,
      );
    });
    expect(host.textContent).toContain('Swiss não são suportados');
  });
});

describe('lista com retenção de ordem (T07)', () => {
  it('congela a ordem durante a interação e seleciona pelo ID', () => {
    expect(applyFrozenOrder([{ id: 'b' }, { id: 'a' }, { id: 'c' }], (x) => x.id, ['a', 'b'])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(applyFrozenOrder([{ id: 'b' }], (x) => x.id, ['a', 'b'])).toEqual([{ id: 'b' }]);
  });

  it('reordenação chegando durante o clique não troca a pessoa selecionada', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const selected: string[] = [];
    const Row = (items: { id: string; name: string }[]) => (
      <VirtualList
        items={items}
        getId={(r) => r.id}
        rowHeight={30}
        label="teste"
        emptyText="vazio"
        onSelect={(id) => selected.push(id)}
        render={(r) => <span>{r.name}</span>}
      />
    );
    act(() =>
      render(
        Row([
          { id: 'ana', name: 'Ana' },
          { id: 'bia', name: 'Bia' },
        ]),
        host,
      ),
    );
    const list = host.querySelector('.lts-list')!;
    act(() => {
      list.dispatchEvent(new Event('pointerenter', { bubbles: false }));
      list.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    // Durante o hover, a fonte inverte a ordem.
    act(() =>
      render(
        Row([
          { id: 'bia', name: 'Bia' },
          { id: 'ana', name: 'Ana' },
        ]),
        host,
      ),
    );
    const rows = [...host.querySelectorAll<HTMLElement>('.lts-row')].sort(
      (a, b) => parseInt(a.style.top) - parseInt(b.style.top),
    );
    // A ordem visual continua a anterior: a primeira linha ainda é Ana.
    expect(rows[0]!.dataset.id).toBe('ana');
    act(() => rows[0]!.click());
    expect(selected).toEqual(['ana']);
    act(() => {
      list.dispatchEvent(new Event('pointerleave', { bubbles: false }));
      vi.advanceTimersByTime(HOLD_MS + 10);
    });
    const after = [...host.querySelectorAll<HTMLElement>('.lts-row')].sort(
      (a, b) => parseInt(a.style.top) - parseInt(b.style.top),
    );
    expect(after[0]!.dataset.id).toBe('bia');
    vi.useRealTimers();
    render(null, host);
  });
});

describe('falha de desenho da composição', () => {
  it('mostra o erro na tela em vez de deixar a página transparente', async () => {
    const { ErrorBoundary } = await import('../../src/presentation/components/ErrorBoundary');
    const host = document.createElement('div');
    const errors: unknown[] = [];
    const Boom = () => {
      throw new TypeError('falha simulada');
    };
    act(() => {
      render(
        <ErrorBoundary onError={(e) => errors.push(e)}>
          <Boom />
        </ErrorBoundary>,
        host,
      );
    });
    expect(errors).toHaveLength(1);
    expect(host.textContent).toContain('erro ao desenhar a composição');
    expect(host.textContent).toContain('TypeError: falha simulada');
  });
});

describe('melhorias visuais', () => {
  it('destaca o rei em xeque e remove o destaque quando o xeque acaba', () => {
    const b = new BoardView(document);
    b.update({
      fen: 'rnbqkbnr/ppppp1pp/5p2/7Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2',
      lastMove: 'd1h5',
      orientation: 'white',
    });
    expect(b.checkSquareIndex()).toBe(4);
    expect(b.element.querySelectorAll('.lts-sq.check')).toHaveLength(1);
    b.update({
      fen: 'rnbqkbnr/ppppp2p/5pp1/7Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 3',
      lastMove: 'g7g6',
      orientation: 'white',
    });
    expect(b.checkSquareIndex()).toBeNull();
    expect(b.element.querySelectorAll('.lts-sq.check')).toHaveLength(0);
  });

  it('a lista rola até o item em foco', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` }));
    act(() => {
      render(
        <VirtualList
          items={items}
          getId={(r) => r.id}
          rowHeight={30}
          label="foco"
          emptyText="vazio"
          focusId="p150"
          render={(r) => <span>{r.id}</span>}
        />,
        host,
      );
    });
    const list = host.querySelector<HTMLElement>('.lts-list')!;
    expect(list.scrollTop).toBeGreaterThan(30 * 100);
    // A linha focada é renderizada (virtualização acompanha a rolagem).
    expect(host.querySelector('[data-id="p150"]')).toBeTruthy();
    render(null, host);
  });
});
