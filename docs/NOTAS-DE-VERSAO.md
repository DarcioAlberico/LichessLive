# Notas de versão

## 1.0.6 — 14/10/2026

Dez melhorias na composição e na operação:

1. **Relógio em alerta**: o relógio fica vermelho quando resta pouco tempo — 10% do tempo inicial do torneio, entre 5 e 30 s (20 s quando o ritmo é desconhecido).
2. **Balanço material** nas fichas, no estilo do Lichess: as peças a mais de cada lado e a vantagem em pontos ("+3").
3. **Xeque no tabuleiro**: a casa do rei em xeque ganha um brilho vermelho.
4. **Último lance** na ficha de quem jogou, com número do lance e letras em português ("24… Dxe4+"). O lance só aparece quando reproduz exatamente a posição recebida, e o "#" só quando a fonte informa mate.
5. **Rotação automática das abas** (painel → _Programa_ → _Rodar as abas automaticamente_, de 10 a 600 s, padrão 20 s). Abas sem conteúdo são puladas; trocar de aba à mão reinicia a contagem.
6. **Classificação acompanha o jogador**: a lista rola sozinha até o jogador selecionado (ou o primeiro acompanhado no recorte), sem atrapalhar quem está rolando a lista.
7. **Team Battle**: posição e pontos do nosso team na barra superior ("2º de 3 · 40 pts"). Na aba Teams, a distância do nosso team para o 1º e os maiores pontuadores; nos outros teams, quantos pontos estão à frente ou atrás do nosso. Com pontos ocultos, tudo isso também fica oculto.
8. **Antes do início**: contagem regressiva "Começa em …" na barra superior e aviso "O torneio começa às HH:MM".
9. **Aba Partidas**: a partida no ar vem primeiro, com ponto vermelho e o subtítulo "No ar: A × B"; depois os favoritos (★) e a ordem de colocação. Filtro opcional _só partidas com acompanhados_ (painel → _Programa_).
10. **Próxima partida do team** (botão no painel ou Alt+Shift+N): percorre as partidas em andamento dos acompanhados, do melhor colocado para o pior. Para achar partidas fora da lista de duelos do Lichess, a extensão consulta a partida atual de um acompanhado por vez, a cada ~8 s, só com o torneio em andamento (mesma fila serializada e mesma pausa de 60 s após HTTP 429).

Correção: a partida em destaque do torneio (que quase sempre também está entre os duelos) perdia a colocação dos jogadores. Na aba Partidas, a linha ficava sem "(1º)" e ia para o fim da lista até a classificação chegar — e assim ficava para quem estivesse fora do recorte.

Captura: `docs/capturas/melhorias-1.0.6.png` (xeque, último lance, relógio em alerta, material e partida no ar).

Descartado: o indicador de sequência de vitórias ("fogo"). O endpoint de resultados não traz esse campo, e a variante com a planilha de pontos (`sheet=true`) foi 2,5× mais lenta numa Arena real; no lugar entrou o alerta de relógio.

Atualização: substitua o conteúdo da pasta da extensão, clique em recarregar em `chrome://extensions` e aperte F5 na aba do torneio. Se o atalho Alt+Shift+N não aparecer, defina-o em `chrome://extensions/shortcuts`.

## 1.0.5 — 14/10/2026

Melhorias nas abas da composição:

- **Partidas**: cada partida em duas linhas (brancas e pretas), com foto ou iniciais, rating e posição; jogadores acompanhados em destaque; selo **NO AR** na partida principal; resumo "N partidas conhecidas · M com acompanhados".
- **Nosso team**: ponto verde em quem está jogando, com o adversário e a posição dele ("vs Fulano (12º)"); variação de posição ao lado do nome (▲ +3); selo NO AR; resumo "N acompanhados · M jogando agora".
- **Classificação**: pódio destacado (1º, 2º, 3º); foto e variação de posição para os acompanhados; resumo "X de N acompanhados no recorte · melhor: 4º Nome".
- **Progresso**: linha "6º → 3º" com a referência, variação de pontos, "tendência confirmada" e "sem atualização"; resumo "N subiram · N desceram · N mantiveram".

## 1.0.4 — 14/10/2026

- **Correção do modo transmissão invisível.** No Chrome do apresentador, um CSS externo (da página logada ou de outra extensão) reduzia a camada da composição a 0×0, `visibility: hidden` e `opacity: 0`: a composição era desenhada, mas a página do Lichess ficava visível por baixo. A camada agora é um elemento próprio (`<lts-program-root>`, fora do alcance de regras genéricas de `div`) com todas as propriedades capazes de escondê-la ou deslocá-la fixadas inline com `!important`. O Lichess simulado dos testes E2E passou a aplicar esse CSS hostil de propósito.

## 1.0.3 — 14/10/2026

- O popup mostra um diagnóstico da composição na aba (tamanho e visibilidade da camada, estilos aplicados, conteúdo desenhado e qual elemento aparece no centro da tela), para identificar casos em que a página do Lichess continua visível com o modo transmissão ativo.

## 1.0.2 — 14/10/2026

- O modo transmissão só é informado como ativo quando a composição está de fato na página; antes, uma falha ao montar ou desenhar deixava o popup em "ativo" com a página do Lichess visível por baixo.
- Erros de desenho aparecem na própria composição e no popup (e no console com o prefixo `[Lichess Team Studio]`), em vez de uma camada transparente.
- Ativar de novo numa aba em que a composição sumiu remonta a composição.
- O popup avisa quando a aba do torneio foi aberta antes da extensão ser (re)carregada e pede F5.

## 1.0.1 — 12/10/2026

- A cobertura padrão da classificação passa de 500 para **1000** participantes (o máximo do endpoint de resultados). Preferências salvas com o padrão antigo (500) são migradas para 1000; valores escolhidos pelo operador são mantidos.
- Medido em uma Arena real com 1224 jogadores: o lote de 1000 linhas foi validado e levou cerca de 20 s para chegar. Com o intervalo nominal de 30 s, as coletas não se sobrepõem, mas em torneios muito grandes vale considerar 45–60 s em _Classificação e coletas_.
- Correções da revisão de código (geração da seleção ao continuar a sessão, fotos em vários lotes, prazo de 45 s nas requisições REST, vigia de inatividade de 60 s no stream, reinícios concorrentes de sessão, intenção restaurada após falha de carga, aviso de importação parcial) e ação "selecionar team" na aba Teams.

Atualização: substitua o conteúdo da pasta da extensão pelo novo pacote e clique em recarregar em `chrome://extensions`. Os dados locais são preservados.

## 1.0.0 — 12/10/2026

Primeira versão completa (RF01 a RF14). Pacote: `release/lichess-team-studio-1.0.0.zip` (SHA‑256 em `.zip.sha256`).

### O que a versão faz

- Ativa e desativa a composição de transmissão sobre a página de um torneio Arena, sem duplicar a interface e restaurando a página original.
- Reconhece Arena e Arena Team Battle; informa Swiss e páginas comuns como não suportadas.
- Seleciona a partida por clique, por jogador (inclusive fora do topo e contra adversário externo) ou por ID, sempre confirmando o torneio; troca atômica com geração e cancelamento.
- Mostra tabuleiro próprio, fichas com foto ou iniciais, relógios da posição transmitida, abas Partidas, Nosso team, Classificação, Progresso e Teams (Team Battle).
- Calcula variação de posição com referência explícita (início do acompanhamento, última atualização ou marcação), escopos geral e "entre acompanhados".
- Cadastro de fotos com corte, backup ZIP versionado com hashes e importação com prévia, mesclagem ou substituição.
- Painel de operação separado, presets 1080p/720p/tabuleiro amplo, controle de spoilers, diagnóstico exportável.

### Formatos suportados

| Formato                                      | Situação                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Arena (xadrez padrão)                        | suportado                                                                 |
| Arena Team Battle                            | suportado (placar oficial e vínculo do jogador no torneio)                |
| Partidas "a partir de posição"               | suportado no tabuleiro                                                    |
| Variantes (Chess960, Atomic, Antichess etc.) | reconhecidas e informadas como não suportadas; o tabuleiro não as desenha |
| Swiss                                        | reconhecido e informado como não suportado                                |

### Limitações conhecidas

- **Atraso da API**: o stream público omite os três últimos lances de partidas em andamento. O aviso fica no rodapé. Não há promessa de atraso zero. O modo de tabuleiro nativo não foi promovido (ver `M0-RELATORIO.md`).
- **Relógios**: são os da posição transmitida; não há contagem regressiva fabricada.
- **Classificação ao vivo é provisória**: posições observadas por coleta (nominal 30 s) e o recorte é limitado por `nb` (padrão 1000, que também é o máximo). Cobertura parcial é informada.
- **Descoberta de partidas é oportunista**: duelos informados pelo torneio (até 1×/min) e resolução sob demanda. A lista diz "Partidas identificadas".
- **Listas privadas de membros** não são importadas (sem autenticação nesta versão); use o cadastro manual.
- **Janela de operação** precisa ficar aberta; minimização prolongada e economia de energia ainda dependem da homologação manual (T17).
- Itens que dependem de homologação manual estão listados em `HOMOLOGACAO.md` e no relatório de testes.

### Atualização e rollback

- Os dados ficam no IndexedDB da extensão (esquema versionado, `schemaVersion` 1) e em `storage.local`. Atualizar a pasta da extensão e clicar em **Recarregar** em `chrome://extensions` preserva os dados.
- **Antes de atualizar**, exporte um backup (Cadastro → Backup).
- **Rollback**: substitua a pasta pela versão anterior e recarregue. Se uma versão futura tiver migrado o esquema para uma versão maior, a versão anterior não abre esse banco: restaure o backup exportado antes da atualização em um perfil limpo (a importação recusa pacotes de esquema mais novo, sem alterar dados).
- Falha de migração: a transação é desfeita, o banco permanece na versão anterior e o painel mostra o erro para exportar um backup antes de qualquer ação. Nada é apagado automaticamente.

### Próximas versões

Ver ROADMAP §16: fila de partidas com sugestão manual, histórico gráfico, presets adicionais (1.1); Swiss com adaptador próprio e autenticação para membros privados (1.2).
