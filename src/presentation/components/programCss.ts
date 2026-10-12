/**
 * Estilo da composição capturada, aplicado no Shadow DOM por adoptedStyleSheets.
 * Fontes locais do sistema (sem CDN). Contraste medido: texto #F4F7FB sobre #101722 ≈ 17,1:1;
 * #B9C4D2 sobre #192331 ≈ 9,4:1; verde #7EE2A8 sobre #192331 ≈ 10:1; vermelho #FF9B9B ≈ 7,6:1.
 */
export const PROGRAM_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.lts-app {
  position: fixed; inset: 0; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: var(--f-meta); line-height: 1.25;
  -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
  padding: calc(var(--safe-t) + var(--m)) calc(var(--safe-r) + var(--m)) calc(var(--safe-b) + var(--m)) calc(var(--safe-l) + var(--m));
  display: grid; grid-template-rows: var(--top) 1fr var(--foot); row-gap: var(--gap-half);
}
.lts-top { display: flex; align-items: center; gap: var(--gap); background: var(--surface); border-radius: 12px; padding: 0 var(--gap); min-width: 0; }
.lts-top .t-name { font-size: var(--f-title); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.lts-top .t-team { color: var(--accent); font-weight: 600; font-size: var(--f-row); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30%; }
.lts-top .t-meta { margin-left: auto; color: var(--text2); white-space: nowrap; display: flex; gap: 14px; align-items: center; flex: none; }
.lts-top .t-clock { color: var(--text); font-weight: 700; font-size: var(--f-row); }
.lts-body { display: grid; grid-template-columns: var(--left) var(--center) var(--side); column-gap: var(--gap); min-height: 0; justify-content: center; }
.lts-left { border-radius: 12px; }
.lts-center { display: flex; flex-direction: column; align-items: center; gap: var(--gap-half); min-height: 0; }
.lts-boardwrap { position: relative; width: var(--board); height: var(--board); flex: none; }
.lts-board { position: absolute; inset: 0; border-radius: 6px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.45); user-select: none; pointer-events: none; }
.lts-sq { position: absolute; width: 12.5%; height: 12.5%; }
.lts-sq.light { background: #D9E1EA; }
.lts-sq.dark { background: #7D93AB; }
.lts-sq.lm.light { background: #E9D98B; }
.lts-sq.lm.dark { background: #B9A85A; }
.lts-piece { width: 100%; height: 100%; display: block; }
.lts-coord { position: absolute; font-size: calc(var(--board) / 42); font-weight: 700; line-height: 1; pointer-events: none; }
.lts-coord.file { bottom: 2px; width: 12.5%; text-align: right; padding-right: 3px; }
.lts-coord.rank { left: 3px; height: 12.5%; padding-top: 3px; }
.lts-coord[data-on="light"] { color: #5F7690; }
.lts-coord[data-on="dark"] { color: #E7EDF3; }
.lts-boardempty { position: absolute; inset: 0; border-radius: 6px; background: var(--surface); display: grid; place-items: center; color: var(--text2); font-size: var(--f-row); text-align: center; padding: 24px; }
.lts-chip { position: absolute; top: 8px; right: 8px; background: rgba(16,23,34,.86); color: var(--text); border: 1px solid rgba(244,247,251,.25); border-radius: 999px; padding: 3px 10px; font-size: calc(var(--f-meta) * .85); z-index: 2; }
.lts-result { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: rgba(16,23,34,.92); border: 2px solid var(--accent); color: var(--text); border-radius: 10px; padding: 8px 18px; font-weight: 700; font-size: var(--f-row); white-space: nowrap; z-index: 2; }
.lts-cards { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap-half); flex: none; max-width: 100%; }
.lts-card { background: var(--surface); border-radius: 12px; padding: 8px 12px; display: grid; grid-template-columns: var(--photo) 1fr auto; align-items: center; column-gap: 12px; min-width: 0; border: 2px solid transparent; height: var(--cardh); }
.lts-card.tomove { border-color: rgba(108,180,255,.55); }
.lts-card .c-info { min-width: 0; }
.lts-card .c-name { font-size: var(--f-name); font-weight: 700; white-space: nowrap; overflow: hidden; line-height: 1.12; }
.lts-card .c-name.two { white-space: normal; overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.lts-card .c-title { color: #F2C46D; margin-right: 6px; }
.lts-card .c-sub { color: var(--text2); font-size: var(--f-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lts-card .c-clock { font-size: var(--f-clock); font-weight: 700; font-variant-numeric: tabular-nums; padding: 2px 10px; border-radius: 8px; background: rgba(0,0,0,.25); white-space: nowrap; }
.lts-card .c-clock.na { color: var(--text2); font-size: var(--f-meta); }
.lts-card .c-color { display: inline-block; width: .8em; height: .8em; border-radius: 2px; margin-right: 6px; vertical-align: baseline; border: 1px solid #8a96a6; }
.lts-card .c-color.white { background: #FBFBF8; }
.lts-card .c-color.black { background: #2A2F36; }
.lts-photo { width: var(--photo); height: var(--photo); border-radius: 50%; object-fit: cover; background: #2B3A4E; display: grid; place-items: center; overflow: hidden; flex: none; font-weight: 700; color: var(--text); font-size: calc(var(--photo) * .38); }
.lts-photo.small { width: var(--photo-s); height: var(--photo-s); font-size: calc(var(--photo-s) * .38); }
.lts-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lts-side { background: var(--surface); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.lts-tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid rgba(185,196,210,.18); flex: none; }
.lts-tab { flex: 1 1 auto; appearance: none; background: none; border: 0; color: var(--text2); font: inherit; font-size: var(--f-tab); font-weight: 600; padding: 9px 8px; cursor: pointer; border-bottom: 3px solid transparent; white-space: nowrap; }
.lts-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.lts-tab:focus-visible, .lts-row:focus-visible, .lts-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
.lts-panel { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 10px 12px 8px; }
.lts-panel h2 { margin: 0 0 2px; font-size: var(--f-row); font-weight: 700; }
.lts-panel .p-sub { color: var(--text2); font-size: var(--f-meta); margin-bottom: 8px; }
.lts-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; position: relative; scrollbar-width: thin; }
.lts-list-inner { position: relative; width: 100%; }
.lts-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 0 6px; border-radius: 8px; font-size: var(--f-row); cursor: pointer; transition: top 200ms ease; }
.lts-row:hover { background: rgba(244,247,251,.06); }
.lts-row.selected { background: rgba(108,180,255,.18); box-shadow: inset 3px 0 0 var(--accent); }
.lts-row.watched .r-name { color: var(--accent); }
.lts-row .r-rank { width: 2.3em; text-align: right; color: var(--text2); flex: none; }
.lts-row .r-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.lts-row .r-side { color: var(--text2); white-space: nowrap; flex: none; font-size: var(--f-meta); }
.lts-row .r-score { font-weight: 700; white-space: nowrap; flex: none; font-size: var(--f-meta); }
.lts-row .r-col { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.lts-row .r-small { color: var(--text2); font-size: var(--f-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lts-delta { font-weight: 700; white-space: nowrap; flex: none; padding: 2px 8px; border-radius: 6px; }
.lts-delta.up { color: #7EE2A8; }
.lts-delta.down { color: #FF9B9B; }
.lts-delta.none { color: var(--text2); }
.lts-delta.confirmed.up { background: rgba(126,226,168,.14); }
.lts-delta.confirmed.down { background: rgba(255,155,155,.14); }
.lts-empty { color: var(--text2); padding: 12px 4px; }
.lts-foot { display: flex; gap: 18px; align-items: center; color: var(--text2); font-size: var(--f-meta); white-space: nowrap; overflow: hidden; }
.lts-foot .f-delay { color: #F2C46D; }
.lts-foot .f-mode { color: var(--text); }
.lts-foot .f-right { margin-left: auto; overflow: hidden; text-overflow: ellipsis; }
.lts-banners { display: flex; gap: 8px; align-items: center; min-width: 0; overflow: hidden; margin-left: auto; }
.lts-banner { background: rgba(242,196,109,.12); border: 1px solid rgba(242,196,109,.6); color: var(--text); padding: 4px 12px; border-radius: 8px; font-size: var(--f-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 10px; }
.lts-banner.panelDisconnected, .lts-banner.noConnection { border-color: rgba(255,155,155,.7); background: rgba(255,155,155,.12); }
.lts-banners + .t-meta { margin-left: 0; }
.lts-btn.small { padding: 2px 10px; font-size: 14px; margin: 0; }
.lts-center-msg { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg); color: var(--text); z-index: 10; text-align: center; padding: 32px; }
.lts-center-msg p { color: var(--text2); max-width: 640px; margin: 8px auto 20px; font-size: 18px; }
.lts-center-msg h1 { font-size: 28px; margin: 0; }
.lts-btn { appearance: none; border: 1px solid rgba(244,247,251,.3); background: #22324A; color: var(--text); font: inherit; font-size: 16px; padding: 10px 18px; border-radius: 8px; cursor: pointer; margin: 0 6px; }
.lts-btn:hover { background: #2B4060; }
.lts-badge { position: absolute; right: 8px; bottom: 6px; color: var(--text2); font-size: 12px; opacity: .55; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .lts-row { transition: none !important; } }
.lts-app.reduced .lts-row { transition: none !important; }
`;
