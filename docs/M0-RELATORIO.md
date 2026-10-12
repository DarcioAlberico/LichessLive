# Relatório técnico do marco M0 — viabilidade

Data: 12/10/2026. Ambiente: Windows 11, Chromium 1223 (Playwright) e consultas diretas à API pública do Lichess. Este relatório separa o que foi **demonstrado** do que **continua dependente de teste** em homologação.

## 1. Amostras usadas

| Formato           | Torneio                                                     | Situação na coleta | Uso                                                              |
| ----------------- | ----------------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| Arena             | `Gxx2vWUz` (Eastern SuperBlitz Arena, 466 jogadores)        | em andamento       | metadados, duelos, destaque, current-game, stream ao vivo        |
| Arena Team Battle | `YVqdsK7c` (Friendly team fights Team Battle, 96 jogadores) | encerrado          | teams oficiais, placar, resultados com `team`, stream finalizado |
| Swiss             | `B032EEeq`                                                  | —                  | reconhecimento de página não suportada                           |

Torneios encerrados não foram usados como prova de atualização ao vivo. As respostas estão em `tests/fixtures/lichess` (ver `tests/fixtures/README.md`). Nenhuma carga artificial foi gerada: cada endpoint foi consultado uma vez, em série.

## 2. Contratos observados (demonstrado)

- **`GET /api/tournament/{id}`**: traz `system`, `variant` (string), `nbPlayers`, `clock`, `isStarted`/`isFinished`, `secondsToFinish`, `standing` (somente a primeira página), `duels` (partidas em andamento, `p[].n/r/k` = nome/rating/posição; a ordem dos jogadores **não** confirma cores), `featured` (FEN curta com lado a jogar e relógios `c` em segundos). Em Team Battle: `teamBattle.teams` como mapa `teamId → [nome, flair]`, `teamBattle.nbLeaders`, `teamStanding` e `duelTeams`. IDs de team podem ter caixa mista (`ChfzrMPn`) e começar com hífen (`----club-names-…`).
- **`GET /api/tournament/{id}/results?nb=N`**: NDJSON `{rank, score, rating, username, performance, team?}`; `nb` limita a cobertura. Leitura durante o torneio é provisória (F03) — tratada como lote validado.
- **`GET /api/tournament/{id}/teams`**: `{id, teams:[{rank, id, score, players:[{user, score}]}]}`. O placar do primeiro team (125) é a soma dos **principais pontuadores** listados, não de todos os membros.
- **`GET /api/team/{id}/users`**: NDJSON `{name, id, url, joinedTeamAt}` (formato atual).
- **`GET /api/user/{u}/current-game`** (Accept JSON): `status` como string; o vínculo com Arena vem em `arenaTour.id` (não em `tournament`). Pode devolver a última partida já encerrada (ex.: `outoftime`), inclusive contra IA, sem torneio.
- **`GET /api/stream/game/{id}`**: a primeira linha descreve a partida **sem `status`** quando em andamento, com `tournamentId`; em seguida o stream **reenvia todo o histórico** `{fen, lm, wc, bc}` (relógios em **segundos**) até a posição atual com atraso de três lances; ao terminar, envia uma descrição final com `fen`, `turns`, `status {id, name}` e `winner`, e fecha. Fim normal não é falha.
- **Exportação JSON de partida**: `clocks` em **centésimos** (`[180000, …]` para 30 min). Fatores de conversão separados.
- **CSP da página do torneio**: `img-src 'self' blob: data: *` (fotos via `blob:` funcionam), `style-src … 'unsafe-inline'`, `font-src 'self' lichess1.org` (fontes da extensão **não** carregam na página → fontes do sistema).

## 3. Seleção fora do destaque (demonstrado com fixtures e E2E simulado)

Os três cenários do roteiro passam nos testes automatizados (`tests/integration/session.test.ts`, `tests/e2e/extension.spec.ts`):

1. **Jogador no topo**: resolvido pelos `duels` do torneio, sem requisição extra.
2. **Jogador fora do topo**: resolvido sob demanda por `current-game`, verificando `arenaTour.id`, jogadores e `status`.
3. **Jogador do team contra adversário externo**: igual ao item 2; o stream confirma `tournamentId` antes da troca.

Partida encerrada nunca é exibida como atual (oferecida como replay). Partida de outro torneio é recusada. Sem vínculo confirmado, a exibição exige escolha explícita do operador e mostra aviso.

## 4. Decisão de fonte do tabuleiro

**Versão 1.0 = modo API documentada (BoardView próprio).** Motivos:

- o modo nativo exigiria redimensionar o componente de espectador do Lichess dentro da página; sem clonar HTML e sem interceptar WebSocket (proibidos pela SPEC), a única forma é reaproveitar o elemento original, cujo DOM e ciclo de vida são internos e mudam sem aviso;
- o widget/iframe oficial não foi avaliado com partida em andamento, relógios e controle de aparência — continua **condicionado a teste**;
- o modo API entrega posição e relógios coerentes por `gameId`, com o aviso permanente "Lances com atraso da API (3 lances)".

Impacto em bullet: o atraso é por **quantidade de lances**; em bullet/hiperbullet três lances podem significar poucos segundos, mas em fases de lances rápidos o público verá a posição defasada. Isto está nas notas de versão. Nenhum polling agressivo foi usado para mascarar o atraso.

## 5. Descoberta de partidas

- Ampla: oportunista, pelos `duels` dos metadados (até uma vez por minuto) e pelo destaque. Rótulo "Partidas identificadas".
- Acompanhar jogador: duelos + verificação serializada de `current-game` a cada 20 s apenas para o jogador acompanhado quando a partida dele termina. **Tempo de descoberta da próxima partida**: limitado por esses intervalos (pior caso ≈ 20 s via current-game, ≈ 60 s via duelos). Medição em torneio real **pendente** (homologação).
- `games-by-users` não é usado na 1.0 (exigiria lista elegível com os dois lados).

## 6. Coexistência e limites

- Um stream por sessão (limite documentado: 8 por IP); REST finito em fila única serializada com pausa global ≥ 60 s após 429 (testado com fixture, sem carga real).
- O stream vive na janela de operação; fechar o popup não interrompe nada (E2E). O service worker só faz roteamento e alarme de 30 s.
- **Pendente de teste manual**: janela de operação minimizada por longos períodos, economia de energia e encerramento forçado do worker durante sessão real.

## 7. Permissões necessárias

`storage`, `alarms` e `host_permissions: https://lichess.org/*`. Content script somente em `/tournament/*` e `/swiss/*`, `all_frames: false`. Não são usados `tabs`, `scripting`, `cookies`, `webRequest`, `debugger`, `downloads` nem `<all_urls>`; `lichess1.org` não é necessário (peças e fontes locais).

## 8. Peças e licenças

Conjunto de 12 peças SVG desenhado para o projeto (`scripts/gen-pieces.mjs`, MIT). Chessground (GPL) e peças do Lichess não são usados. Inventário completo em `docs/LICENCAS.md`.

## 9. Composição

Estudos de 1080p e 720p estão automatizados (`test-results/programa-1080p.png`, `programa-720p.png` gerados pelo E2E). **Pendente**: gravação real de 30 s no OBS em 1080p e redução a 720p para avaliar legibilidade no vídeo final.
