# Roteiro de homologação do apresentador

Roteiro do ROADMAP §15. As demonstrações com fixtures não substituem a conferência em um torneio público real. O apresentador valida clareza e operação; os testes automatizados validam regras e recuperação.

1. Instalar em um perfil limpo do Chrome e abrir o torneio definido para teste.
2. Selecionar o team e incluir os dois usernames dos exemplos, quando disponíveis, ou usar fixtures.
3. Cadastrar duas fotos, ajustar o corte e confirmar as iniciais para quem não tem foto.
4. Selecionar um jogador fora do topo, fixar a partida e depois acompanhar outro jogador.
5. Alternar abas, confirmar a referência de progresso e marcar uma nova referência.
6. Ajustar a janela para 1080p e 720p úteis, verificar nomes longos e girar o tabuleiro.
7. Gravar no OBS com o painel de operação aberto **fora** da janela capturada.
8. Interromper a rede, restaurá‑la e confirmar que posição e relógios não parecem atuais durante a falha (aviso "Sem conexão" e hora da última posição).
9. Reiniciar o Chrome e restaurar o cadastro a partir de um backup em um perfil separado.
10. Desativar a extensão e verificar que a página volta a funcionar normalmente.

Itens que só podem ser aprovados manualmente (não automatizados):

- T17 completo: janela de operação **minimizada** por 30 min, economia de energia, encerramento do service worker em `chrome://serviceworker-internals`.
- T18 completo: sessão de **quatro horas** com gravação, 1000 participantes e 50 acompanhados.
- Legibilidade no **vídeo gravado** em 1080p e reduzido a 720p (testes visuais devem conferir a gravação).
- Conferência em ao menos **uma Arena e um Team Battle reais** em andamento.
- Medição do tempo de descoberta da próxima partida de um jogador acompanhado.

## Registro de execução

Copie a tabela para cada execução.

| Campo                                                | Valor |
| ---------------------------------------------------- | ----- |
| Versão da extensão                                   | 1.0.0 |
| Data e hora                                          |       |
| Chrome (versão)                                      |       |
| Torneio (URL e formato)                              |       |
| Preset e área útil                                   |       |
| Passos executados                                    |       |
| Resultado (aprovado / falhou)                        |       |
| Falha observada                                      |       |
| Evidência (gravação, captura, diagnóstico exportado) |       |
