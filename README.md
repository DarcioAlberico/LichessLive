# Lichess Team Studio

Extensão Chrome (Manifest V3, TypeScript) que transforma a página de um torneio Arena do Lichess em uma composição para transmissão: partida principal escolhida pelo apresentador, fotos cadastradas localmente e acompanhamento da classificação e do progresso dos jogadores de um team. Funciona sem backend, sem login e sem token, usando a API pública do Lichess.

- Especificação: `LICHESS_TEAM_STUDIO_SPEC.pdf` · Roadmap: `LICHESS_TEAM_STUDIO_ROADMAP.pdf`
- Guia do apresentador: [docs/INSTALACAO-E-OBS.md](docs/INSTALACAO-E-OBS.md)

## Instalação rápida

```bash
npm ci
```

```bash
npm run build
```

Depois, em `chrome://extensions` → _Modo do desenvolvedor_ → _Carregar sem compactação_ → pasta `dist/`.

## Comandos

| Comando                               | O que faz                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                       | Build de produção em `dist/` (esbuild, entradas background, content, studio, options, popup)                         |
| `npm run build:dev` / `npm run watch` | Build de desenvolvimento com source maps / modo observação                                                           |
| `npm run package`                     | Build + `release/lichess-team-studio-<versão>.zip` e `.sha256`; recusa pacote com source map, script remoto ou token |
| `npm run check`                       | Typecheck (strict) + ESLint + testes Vitest + verificação de fronteiras e permissões                                 |
| `npm test`                            | Testes unitários, de contrato e de integração (Vitest)                                                               |
| `npm run test:e2e`                    | Build + Playwright com a extensão real carregada no Chromium e Lichess simulado                                      |
| `node scripts/gen-pieces.mjs`         | Regera as 12 peças SVG e o módulo do BoardView                                                                       |
| `npm run icons`                       | Regera os ícones PNG                                                                                                 |

Para usar um Chromium já instalado no E2E: defina `LTS_CHROMIUM` com o caminho do executável.

## Estrutura

```
src/domain        regras puras (IDs, FEN, relógios, ranking, progresso, seleção, spoilers)
src/application   portas, TournamentSession, agendador, SessionCoordinator, ViewModels
src/adapters      lichess (REST, NDJSON, streams, schemas) e page (overlay, seletores)
src/presentation  composição Preact, BoardView, presets/layout, ViewModels
src/studio        janela de operação
src/options       cadastro, fotos, teams, backup, armazenamento, preferências
src/popup         iniciar / focar / encerrar
src/background    service worker
src/persistence   IndexedDB versionado, repositórios, fotos, backup
src/diagnostics   log sanitizado e métricas
tests/            unit, contract, integration, e2e, fixtures
assets/           peças SVG e ícones
docs/             relatório M0, arquitetura, instalação/OBS, homologação, testes, notas, licenças, privacidade
```

## Documentação

- [Relatório técnico M0](docs/M0-RELATORIO.md) — contratos observados, decisão de fonte do tabuleiro, permissões
- [Arquitetura e decisões](docs/ARQUITETURA.md)
- [Instalação, preparação e captura no OBS](docs/INSTALACAO-E-OBS.md)
- [Roteiro de homologação](docs/HOMOLOGACAO.md)
- [Relatório de testes e metas medidas](docs/RELATORIO-DE-TESTES.md)
- [Notas de versão, limitações e rollback](docs/NOTAS-DE-VERSAO.md)
- [Política de dados locais](docs/PRIVACIDADE.md) · [Inventário de licenças](docs/LICENCAS.md)
- [Como relatar problemas](docs/RELATOS.md) · [Materiais para a Chrome Web Store](docs/CHROME-WEB-STORE.md)

## Licença

MIT — ver [LICENSE](LICENSE).
