# Arquitetura e decisões

## Módulos (SPEC 8.1)

| Pasta                  | Responsabilidade                                                                                                                                    | Pode depender de                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `src/domain`           | Entidades e regras puras: IDs, FEN, relógios, cobertura, conexão, lote de ranking, progresso, Team Battle, seleção, associação de partida, spoilers | apenas `src/shared` puro                     |
| `src/application`      | Portas (`ports.ts`), sessão do torneio (`TournamentSession`), agendador, `SessionCoordinator`, montagem de ViewModels                               | domain e portas                              |
| `src/adapters/lichess` | Fila REST, cliente dos endpoints públicos, parser NDJSON, stream da partida, hub de streams, schemas                                                | domain, application (portas)                 |
| `src/adapters/page`    | Reconhecimento da página, registro de seletores, overlay reversível                                                                                 | DOM                                          |
| `src/presentation`     | Composição (Preact), `BoardView` imperativo, presets e layout, ViewModels                                                                           | domain (tipos), sem `fetch` e sem `chrome.*` |
| `src/studio`           | Janela de operação: execução da sessão, Port com os programas, interface do operador                                                                | tudo acima                                   |
| `src/options`          | Cadastro de jogadores e fotos, teams, backup, armazenamento e preferências                                                                          | persistence, adapters                        |
| `src/popup`            | Iniciar, focar ou encerrar                                                                                                                          | —                                            |
| `src/background`       | Service worker: roteamento, alarme de 30 s, estado por aba                                                                                          | Chrome APIs                                  |
| `src/persistence`      | IndexedDB versionado, repositórios, fotos, backup                                                                                                   | application (portas)                         |
| `src/diagnostics`      | Log local sanitizado, métricas p50/p95, relatório                                                                                                   | —                                            |
| `src/shared`           | Protocolo de mensagens, validação, ZIP, horas, preferências                                                                                         | —                                            |

`scripts/check-boundaries.mjs` verifica automaticamente: domain sem DOM/Chrome/Preact/camadas externas; presentation sem `fetch`/`chrome.*`; manifest com permissões mínimas.

## Contextos de execução

```
Aba do Lichess (programa capturado)          Janela de operação (studio.html)              Service worker
┌───────────────────────────────┐  Port     ┌─────────────────────────────────┐  msgs   ┌──────────────────┐
│ content script (mundo isolado)│◀────────▶│ SessionCoordinator               │◀──────▶│ alarme 30 s, tick │
│  overlay + Shadow DOM         │ ViewModel │  TournamentSession (1/torneio)   │         │ comandos (atalhos)│
│  ProgramApp (Preact)          │ intenções │  RestQueue (1 req. por vez)      │         │ estado por aba    │
│  BoardView (64 casas fixas)   │           │  GameStreamHub (1 stream/sessão) │         │ abrir/focar painel│
└───────────────────────────────┘           │  IndexedDB + storage.local       │         └──────────────────┘
                                            └─────────────────────────────────┘
```

- Toda mensagem de sessão leva `protocolVersion`, `sessionId`, `tournamentId`, `requestId` e `generation`; mensagens recebidas são validadas (`parseProgramMessage`, `parseRuntimeMessage`) e só acionam operações permitidas com IDs validados. Nenhuma mensagem pode pedir `fetch` de URL arbitrária; a fila REST recusa URLs fora de `https://lichess.org/api/`.
- O programa recebe somente as **seções alteradas** do ViewModel (top, main, tabs, footer, banners, layout, selection). O tabuleiro só é atualizado quando FEN, último lance ou orientação mudam.
- Fotos chegam ao programa como bytes normalizados (≤ 512 px) uma vez por foto; o content script cria `blob:` URLs e as revoga ao trocar ou desativar.

## Fluxo de troca de partida (RF04)

1. Intenção (clique, painel, acompanhamento) → `generation + 1`; cargas e resoluções anteriores são abortadas.
2. O stream anterior é encerrado antes de abrir o novo (orçamento de conexões).
3. Mensagens são aceitas só do stream corrente (token) e da geração corrente.
4. A troca acontece quando chega o **pacote consistente**: identidade validada (torneio, variante) + posição com FEN válida. Até lá o tabuleiro e as fichas anteriores ficam visíveis com indicação discreta.
5. Falha (outro torneio, variante, 404, contrato) mantém o tabuleiro anterior e reabre o stream dele.

## Decisões (ADR)

**ADR-001 — esbuild em vez de Vite.** A SPEC permite "Vite ou equivalente". Content scripts MV3 precisam ser scripts clássicos; o esbuild gera IIFE por entrada explícita (background, content, studio, options, popup) sem plugins. Build em ~0,1 s, sem código remoto.

**ADR-002 — Preact nos painéis.** API de componentes compatível com React, ~10 KB, MIT. O `BoardView` não usa Preact: é uma área imperativa montada uma vez.

**ADR-003 — BoardView e peças próprios.** Chessground é GPL (F14). Peças desenhadas para o projeto, MIT. Nenhum ativo do Lichess é copiado.

**ADR-004 — A janela de operação é dona da sessão.** O service worker pode ser encerrado pelo Chrome (F10); streams NDJSON não dependem dele. Uma única janela proprietária por perfil (Web Locks). O alarme de 30 s desperta a janela para as coletas mesmo com limitação de timers em segundo plano.

**ADR-005 — Overlay sobre a página em vez de esconder elementos.** A composição é um root fixo com Shadow DOM acima da página; `body` fica `inert` e a rolagem é suspensa por uma regra prefixada. Nada nativo é removido; desativar desfaz tudo (T01). O MutationObserver observa apenas os filhos de `<html>`.

**ADR-006 — ZIP e validação próprios.** O backup precisa de poucos recursos (gravar sem compressão, ler stored/deflate) com validação estrita de caminhos, limites e CRC. Validação em tempo de execução escrita à mão nas fronteiras, sem dependência extra.

**ADR-007 — Fontes do sistema.** A CSP do Lichess só permite fontes de `'self' lichess1.org`; fontes da extensão não carregariam na página e CDN é proibido. Pilha: Segoe UI Variable/Segoe UI (Windows 11), com fallback do sistema.

**ADR-008 — Referência de progresso por observações.** As observações são guardadas por sessão, escopo, `referenceId` e `rulesVersion`. Mudar o modo de referência não apaga registros; "Nova referência" cria outro `referenceId`; a marcação manual registra uma observação com o instante da marcação.

**ADR-009 — Lote de ranking validado como unidade.** Lote com jogador repetido, posição repetida, lacuna ou pontuação fora de ordem é guardado no diagnóstico e o último lote válido continua publicado; cobertura parcial nunca é chamada de completa.

**ADR-010 — Modo nativo do tabuleiro não promovido.** Ver `M0-RELATORIO.md` §4.
