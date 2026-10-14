import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Lista virtualizada com retenção de ordem (SPEC 4.3, T07): durante hover, foco, teclado ou clique a
 * reordenação visual fica congelada por até dois segundos depois da interação; a seleção é aplicada
 * pelo ID, nunca pela posição na tela.
 */

export const HOLD_MS = 2000;

interface Props<T> {
  items: readonly T[];
  getId: (item: T) => string;
  rowHeight: number;
  render: (item: T) => ComponentChildren;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  label: string;
  emptyText: string;
  rowClass?: (item: T) => string;
  /** Mantém este item visível (centralizado) quando muda de posição — exceto durante interação. */
  focusId?: string | null;
  smooth?: boolean;
}

/** Aplica uma ordem congelada: itens conhecidos mantêm a posição, novos vão para o fim. */
export function applyFrozenOrder<T>(
  items: readonly T[],
  getId: (t: T) => string,
  frozen: readonly string[] | null,
): T[] {
  if (!frozen) return [...items];
  const byId = new Map(items.map((i) => [getId(i), i]));
  const out: T[] = [];
  for (const id of frozen) {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id);
    }
  }
  for (const it of byId.values()) out.push(it);
  return out;
}

export function VirtualList<T>(props: Props<T>) {
  const {
    items,
    getId,
    rowHeight,
    render,
    onSelect,
    selectedId,
    label,
    emptyText,
    rowClass,
    focusId,
    smooth,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [frozen, setFrozen] = useState<string[] | null>(null);
  /** Seleção otimista: destaca a linha clicada imediatamente; a confirmação vem do painel. */
  const [pressed, setPressed] = useState<string | null>(null);
  const pressedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interacting = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ordered = applyFrozenOrder(items, getId, frozen);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      if (pressedTimer.current) clearTimeout(pressedTimer.current);
    },
    [],
  );

  useEffect(() => setPressed(null), [selectedId]);

  const focusIndex = focusId ? ordered.findIndex((it) => getId(it) === focusId) : -1;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIndex < 0 || frozen) return;
    const target = Math.max(0, focusIndex * rowHeight - (el.clientHeight - rowHeight) / 2);
    if (Math.abs(el.scrollTop - target) < rowHeight / 2) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
    else el.scrollTop = target;
    setScrollTop(target);
  }, [focusId, focusIndex, rowHeight, frozen === null]);

  const hold = () => {
    interacting.current = true;
    if (releaseTimer.current) {
      clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    }
    setFrozen((f) => f ?? ordered.map(getId));
  };
  const scheduleRelease = () => {
    interacting.current = false;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      if (!interacting.current) setFrozen(null);
    }, HOLD_MS);
  };

  if (items.length === 0) return <div class="lts-empty">{emptyText}</div>;

  const overscan = 4;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(ordered.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  const visible = ordered.slice(first, last);

  const select = (id: string) => {
    hold();
    setPressed(id);
    if (pressedTimer.current) clearTimeout(pressedTimer.current);
    pressedTimer.current = setTimeout(() => setPressed(null), 3000);
    onSelect?.(id);
    scheduleRelease();
  };
  const shownSelected = pressed ?? selectedId ?? null;

  return (
    <div
      class="lts-list"
      ref={scrollRef}
      role="listbox"
      aria-label={label}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      onPointerEnter={hold}
      onPointerLeave={scheduleRelease}
      onFocusIn={hold}
      onFocusOut={scheduleRelease}
    >
      <div class="lts-list-inner" style={{ height: `${ordered.length * rowHeight}px` }}>
        {visible.map((item, i) => {
          const id = getId(item);
          const index = first + i;
          return (
            <div
              key={id}
              data-id={id}
              role="option"
              tabIndex={0}
              aria-selected={shownSelected === id}
              class={`lts-row ${shownSelected === id ? 'selected' : ''} ${rowClass?.(item) ?? ''}`}
              style={{ top: `${index * rowHeight}px`, height: `${rowHeight - 4}px` }}
              onClick={() => select(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(id);
                }
              }}
            >
              {render(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
