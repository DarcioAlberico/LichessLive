import { ACTIVE_CLASS, PAGE_STYLE_ID, ROOT_ID } from './selectors';

/**
 * Montagem reversível da composição sobre a página (SPEC 12, RF01, T01):
 * - um único root identificável com Shadow DOM;
 * - a página original não é destruída: fica sob a composição, inerte, e é restaurada ao sair;
 * - estilos externos mínimos, prefixados e removidos na desmontagem;
 * - MutationObserver restrito aos filhos de <html>, com debounce, para remontar o root se removido.
 */

const PAGE_CSS = `html.${ACTIVE_CLASS}, html.${ACTIVE_CLASS} > body { overflow: hidden !important; }`;

export interface OverlayHandle {
  shadow: ShadowRoot;
  container: HTMLElement;
}

export class ProgramOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private saved: { scrollX: number; scrollY: number; bodyInert: boolean; hadClass: boolean } | null = null;
  private onRemount: (() => void) | null = null;

  constructor(
    private readonly doc: Document,
    private readonly css: string,
  ) {}

  get mounted(): boolean {
    return this.host !== null;
  }

  mount(onRemount?: () => void): OverlayHandle {
    if (this.host && this.shadow && this.container) return { shadow: this.shadow, container: this.container };
    this.onRemount = onRemount ?? null;
    const doc = this.doc;
    const win = doc.defaultView!;
    // Garantia de root único, inclusive se outra instância deixou um root órfão.
    doc.getElementById(ROOT_ID)?.remove();
    this.saved = {
      scrollX: win.scrollX,
      scrollY: win.scrollY,
      bodyInert: doc.body?.inert ?? false,
      hadClass: doc.documentElement.classList.contains(ACTIVE_CLASS),
    };

    const host = doc.createElement('div');
    host.id = ROOT_ID;
    host.setAttribute('data-lts', 'program');
    const hs = host.style;
    hs.setProperty('position', 'fixed', 'important');
    hs.setProperty('inset', '0', 'important');
    hs.setProperty('z-index', '2147483646', 'important');
    hs.setProperty('display', 'block', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(this.css);
    shadow.adoptedStyleSheets = [sheet];
    const container = doc.createElement('div');
    container.className = 'lts-container';
    shadow.appendChild(container);

    if (!doc.getElementById(PAGE_STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = PAGE_STYLE_ID;
      style.textContent = PAGE_CSS;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    doc.documentElement.classList.add(ACTIVE_CLASS);
    if (doc.body) doc.body.inert = true;
    doc.documentElement.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.container = container;
    this.observe();
    return { shadow, container };
  }

  private observe(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = null;
        if (this.host && !this.host.isConnected) {
          // O contêiner foi removido (remontagem da página): reanexa o mesmo root.
          this.doc.documentElement.appendChild(this.host);
          this.doc.documentElement.classList.add(ACTIVE_CLASS);
          if (this.doc.body) this.doc.body.inert = true;
          this.onRemount?.();
        }
      }, 150);
    });
    // Observa apenas os filhos diretos de <html> (área restrita).
    this.observer.observe(this.doc.documentElement, { childList: true });
  }

  unmount(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.container = null;
    const doc = this.doc;
    doc.getElementById(PAGE_STYLE_ID)?.remove();
    if (this.saved) {
      if (!this.saved.hadClass) doc.documentElement.classList.remove(ACTIVE_CLASS);
      if (doc.body) doc.body.inert = this.saved.bodyInert;
      doc.defaultView?.scrollTo(this.saved.scrollX, this.saved.scrollY);
    } else {
      doc.documentElement.classList.remove(ACTIVE_CLASS);
    }
    this.saved = null;
  }
}
