# Relatório de testes e metas medidas — versão 1.0.0

Execução: 12/10/2026, Windows 11, Node 25.9, Chromium 1223 (Playwright 1.64). Comandos: `npm run check` (typecheck strict, ESLint, Vitest, fronteiras) e `npm run test:e2e`.

## Resumo

| Suíte                                                                                                           | Arquivos | Testes | Resultado |
| --------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------- |
| Unitários (`tests/unit`)                                                                                        | 5        | 57     | aprovados |
| Contrato (`tests/contract`) — respostas reais do Lichess                                                        | 2        | 20     | aprovados |
| Integração (`tests/integration`) — sessão, fila, streams, persistência, DOM, coordenador, regressões da revisão | 7        | 69     | aprovados |
| E2E (`tests/e2e`) — extensão real no Chromium, Lichess simulado                                                 | 2        | 11     | aprovados |
| Fronteiras de arquitetura e permissões (`scripts/check-boundaries.mjs`)                                         | —        | —      | ok        |

Os E2E usam dados fictícios para repetibilidade. A conferência em torneios públicos reais, a gravação no OBS e a sessão de quatro horas fazem parte da homologação manual e **ainda não foram executadas** (ver "Pendências").

## Rastreabilidade RF → testes

| RF   | Requisito                          | Evidência automatizada                                                                                                                                                                                   | Situação                             |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| RF01 | Ativação e restauração             | T01: `dom.test.tsx` (10 ciclos, root único, página restaurada), E2E "ativar e desativar dez vezes", E2E principal (desativa sem recarregar)                                                              | aprovado                             |
| RF02 | Reconhecimento Arena/Team Battle   | T02: `entities.test.ts` (URL), `dom.test.tsx` (dica de DOM), `lichess-schemas.test.ts` (formato pela API), E2E Swiss                                                                                     | aprovado                             |
| RF03 | Seleção por jogador ou partida     | T03: `session.test.ts` (fora do top, outro torneio, encerrada → replay, sem vínculo), E2E (jogador fora dos duelos pelo programa)                                                                        | aprovado (fixtures)                  |
| RF04 | Troca consistente                  | T04: `session.test.ts` (A/B/C, resposta atrasada de A, pacote incompleto mantém tabuleiro anterior), `selection.test.ts`                                                                                 | aprovado                             |
| RF05 | Estado de conexão e atraso         | T05: `gameStream.test.ts` (reconexão com espera, 429, fim normal, erro de contrato), E2E (rodapé com atraso e hora), `dom.test.tsx` (painel desconectado)                                                | aprovado (rede real pendente)        |
| RF06 | Fotos vinculadas ao jogador        | T06: E2E (cadastro, corte, reinício do navegador, caixa diferente sem duplicar, foto no programa sem distorção), `shared.test.ts` (assinatura, SVG recusado, corte)                                      | aprovado                             |
| RF07 | Abas e classificação com cobertura | T07: `ranking.test.ts`, `session.test.ts` (cobertura parcial, 1000 linhas), `dom.test.tsx` (reordenação durante clique mantém o ID)                                                                      | aprovado                             |
| RF08 | Progresso de posição               | T08: `ranking.test.ts` e `session.test.ts` (6º→3º = +3, 4º→5º = −1, Novo, 0 posições, Fora do recorte, sem atualização, marcação)                                                                        | aprovado                             |
| RF09 | Team Battle e pontuadores          | T09: `ranking.test.ts`, `session.test.ts` (team no torneio prevalece; placar oficial ≠ soma), `lichess-schemas.test.ts`                                                                                  | aprovado (fixture real encerrada)    |
| RF10 | Painel de operação separado        | T10: E2E e `dom.test.tsx` (programa sem formulários; controles só no painel)                                                                                                                             | aprovado (gravação OBS pendente)     |
| RF11 | Presets e configuração             | T11: `layout.test.ts` (1080p/720p/várias janelas), E2E 1280×720 sem rolagem e tabuleiro quadrado, nomes longos em duas linhas                                                                            | aprovado (zoom e gravação pendentes) |
| RF12 | Backup versionado                  | T12: `persistence.test.ts` (ida e volta, corrompido, truncado, travessia, não declarado, mesclar, histórico), E2E perfil limpo                                                                           | aprovado                             |
| RF13 | Reconexão e limitação              | T13: `restQueue.test.ts` (1 por vez, dedup, cache, 429 ≥ 60 s/Retry-After, pausa compartilhada, cancelamento, URL fora da API), `gameStream.test.ts` (hub sem órfãos), E2E 500 trocas com 1 stream ativo | aprovado                             |
| RF14 | Recuperação de sessão              | T14: `session.test.ts` (reinício retoma referência e seleção; outra sessão não herda; não vaza entre torneios), E2E (recarregar a página e reabrir o painel)                                             | aprovado                             |

Demais cenários: T15 `ndjson.test.ts` (chunks cortados em 1, 2, 3, 7 e 64 bytes com UTF‑8 multibyte, heartbeat, linha inválida, limites); T16 `session.test.ts` e `selection.test.ts` (resultado antecipado só no painel; banner só com a descrição final do stream; ocultação); T17 E2E (painel fechado e reaberto); T18 ensaio curto abaixo.

## Revisão de código

Uma revisão independente apontou seis defeitos, todos corrigidos com teste de regressão (`tests/integration/review-regressions.test.ts`): geração da seleção não restaurada ao continuar a sessão (programa descartava ViewModels), fotos além de 4 MB não reenviadas, falta de prazo nas requisições REST e de vigia de inatividade no stream (agora 45 s e 60 s com releitura silenciosa — o Lichess não envia heartbeat em partida parada), sessão descartada podendo abrir stream e reinícios concorrentes, restauração da intenção errada após falha de carga, e importação de backup não informando falha parcial das preferências.

## Metas medidas (ensaio automatizado curto)

Ambiente: Chromium headless, Lichess simulado, 500 trocas de partida pelo programa (`test-results/metricas-e2e.json`). Estes números **não** incluem atraso do Lichess, rede real nem codificação do vídeo.

| Métrica                                                | Meta                       | Medido                                                                        | Situação                                                                        |
| ------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Evento recebido → composição renderizada (p95)         | ≤ 150 ms                   | 3 ms (535 amostras)                                                           | atendida no ensaio                                                              |
| Clique → retorno visual local (p95)                    | ≤ 100 ms                   | 15,1 ms (30 amostras)                                                         | atendida no ensaio                                                              |
| Troca com dados em cache → tabuleiro consistente (p95) | ≤ 500 ms                   | 5 ms (530 amostras)                                                           | atendida no ensaio                                                              |
| Crescimento de memória após trocas repetidas           | ≤ 10% após aquecimento     | painel: +8,3% nas trocas 100–300 e −0,7% nas 300–500; programa: +2,1% e +0,7% | atendida; estabiliza (buffers limitados de diagnóstico)                         |
| Streams ativos após 500 trocas                         | sem órfãos                 | 1                                                                             | atendida                                                                        |
| Layout sem rolagem/corte                               | 1920×1080 e 1280×720 úteis | sem rolagem, tabuleiro quadrado (E2E e `layout.test.ts`)                      | atendida (navegador)                                                            |
| Memória adicional da extensão no cenário padrão        | ≤ 250 MB                   | heap JS: painel ≈ 2,2 MB, programa ≈ 3,1 MB                                   | parcial: falta medir processo completo com 1000 participantes e 50 acompanhados |
| Sessão de quatro horas sem falha crítica               | 4 h                        | —                                                                             | **não medida**                                                                  |
| Recuperação com rede restaurada                        | início ≤ 30 s fora de 429  | degraus 1–30 s verificados em teste                                           | **não medida em rede real**                                                     |

Nenhuma meta não medida foi registrada como aprovada.

## Conferência em torneio real (amostra)

Em 12/10/2026 às 06:26 UTC, `tests/e2e-live/live.spec.ts` carregou a extensão no Chromium contra a Arena pública **Gxx2vWUz** (Eastern SuperBlitz, 1116 participantes, em andamento), com uma única sessão de uso normal:

- página reconhecida, composição montada, metadados em 0,6 s;
- partida aberta pela lista de partidas identificadas: identidade validada pelo `tournamentId` do stream, tabuleiro, títulos, relógios e aviso de atraso corretos (`test-results/live-arena.png`);
- classificação: lote de 500 linhas **validado** e publicado como "Parcial: 500 de 1116", provisória, **10,1 s** para receber as 500 linhas.

Observação de projeto: a leitura de 500 linhas levou cerca de um terço do intervalo nominal de 30 s; o agendador não sobrepõe coletas, e para torneios maiores convém manter `nb` ≤ 500 ou aumentar o intervalo. Um Team Battle **em andamento** ainda precisa ser conferido.

## Pendências de homologação manual (bloqueiam a assinatura final da 1.0)

1. T18 completo: quatro horas com gravação, fixture de 1000 participantes e 50 acompanhados, medição de memória do processo.
2. T17 completo: janela de operação minimizada, economia de energia e encerramento do service worker.
3. T05 em rede real: desconectar e reconectar a rede durante uma partida ao vivo.
4. T10/T11 na gravação do OBS em 1080p e reduzida a 720p, com zoom do navegador diferente de 100%.
5. Um Team Battle público **em andamento** (a Arena real foi conferida, ver acima) e o tempo de descoberta da próxima partida do jogador acompanhado.

Roteiro e registro: `docs/HOMOLOGACAO.md`.
