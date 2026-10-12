# Notas de versão

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
- **Classificação ao vivo é provisória**: posições observadas por coleta (nominal 30 s) e o recorte é limitado por `nb` (padrão 500, máximo 1000). Cobertura parcial é informada.
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
