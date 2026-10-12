# Inventário de licenças

Levantamento feito em 12/10/2026 a partir de `node_modules/*/package.json` e dos assets do repositório. Versões fixadas em `package-lock.json`.

## Incluído no pacote da extensão

| Componente                           | Versão  | Licença                                            | Uso                                                         |
| ------------------------------------ | ------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Lichess Team Studio (código próprio) | 1.0.0   | MIT                                                | Todo o código em `src/`                                     |
| Preact                               | 10.29.8 | MIT                                                | Painéis e composição (runtime empacotado)                   |
| Peças SVG (12)                       | 1.0.0   | MIT (desenho original do projeto)                  | `assets/pieces/*.svg`, geradas por `scripts/gen-pieces.mjs` |
| Ícones da extensão                   | 1.0.0   | MIT (desenho original; cavalo do conjunto próprio) | `assets/icons/*.png`                                        |

Nenhuma fonte é empacotada: a composição usa fontes locais do sistema (Segoe UI no Windows 11). A CSP da página do Lichess não permite carregar fontes da origem da extensão (`font-src 'self' lichess1.org`), e a especificação proíbe CDN.

Nenhum ativo do Lichess (peças, sons, fontes ou imagens) é copiado. O conjunto de peças _cburnett_ e o Chessground não são usados — o Chessground é GPL e exigiria disponibilizar o código da obra combinada (SPEC 15, F14). O BoardView é próprio.

## Somente desenvolvimento (não entram no pacote)

| Pacote            | Versão  | Licença    |
| ----------------- | ------- | ---------- |
| esbuild           | 0.28.2  | MIT        |
| typescript        | 6.0.3   | Apache-2.0 |
| vitest            | 4.1.11  | MIT        |
| @playwright/test  | 1.64.0  | Apache-2.0 |
| eslint            | 10.12.0 | MIT        |
| @eslint/js        | 10.0.1  | MIT        |
| typescript-eslint | 8.71.1  | MIT        |
| prettier          | 3.9.10  | MIT        |
| fake-indexeddb    | 6.2.5   | Apache-2.0 |
| happy-dom         | 21.0.1  | MIT        |
| @types/chrome     | 0.3.5   | MIT        |
| @types/node       | 24.19.2 | MIT        |

## Dados de terceiros

As fixtures em `tests/fixtures/lichess` são respostas públicas da API do Lichess capturadas em 12/10/2026 (usernames públicos de torneios abertos), usadas apenas para testes de contrato.
