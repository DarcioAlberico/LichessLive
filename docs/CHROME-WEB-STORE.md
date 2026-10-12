# Materiais para a Chrome Web Store (se houver decisão de publicar)

A publicação é uma entrega separada e não tem aprovação ou prazo garantidos.

## Ficha

- **Nome**: Lichess Team Studio (nome provisório; confirmar marca e evitar sugerir vínculo oficial com o Lichess).
- **Resumo (132 caracteres)**: Composição de transmissão para torneios Arena do Lichess: partida em destaque, fotos dos jogadores e progresso do seu team.
- **Categoria**: Ferramentas para desenvolvedores / Produtividade (avaliar).
- **Idioma**: Português (Brasil).
- **Capturas**: usar `test-results/programa-1080p.png`, `programa-720p.png`, `painel-operacao.png` com dados fictícios.

## Justificativa das permissões

| Permissão               | Por quê                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `storage`               | Guardar preferências e o estado das abas em modo transmissão.                   |
| `alarms`                | Despertar o painel de operação a cada 30 s para coletar a classificação.        |
| `https://lichess.org/*` | Mostrar a composição na página do torneio e consultar a API pública do Lichess. |

Não usa código remoto. Não coleta dados pessoais do usuário; todos os dados ficam no navegador (ver `PRIVACIDADE.md`, também empacotada em `docs/privacidade.html`).

## Declarações de uso de dados

- Não coleta: informações de identificação pessoal, saúde, financeiras, autenticação, comunicações pessoais, localização, histórico da web, atividade do usuário, conteúdo do site.
- Dados públicos do Lichess (usernames, partidas e classificação) são lidos sob demanda e não são vendidos nem transferidos.
