# Fixtures

## `lichess/` — respostas reais da API pública (contratos)

Capturadas em **12/10/2026 entre 05:00 e 05:20 UTC**, uma requisição por endpoint, sem autenticação. Contêm apenas dados públicos (usernames e ratings de torneios abertos). Arquivos de stream foram recortados (primeiras linhas e descrição final) para manter o tamanho pequeno.

| Arquivo | Origem |
| --- | --- |
| `tournament-arena-live.json` | `GET /api/tournament/Gxx2vWUz` (Arena em andamento) |
| `tournament-teambattle-finished.json` | `GET /api/tournament/YVqdsK7c` (Team Battle encerrado) |
| `teambattle-teams.json` | `GET /api/tournament/YVqdsK7c/teams` |
| `teambattle-results.ndjson` | `GET /api/tournament/YVqdsK7c/results?nb=12` |
| `team-users.ndjson` | `GET /api/team/darkonteams/users` (3 primeiras linhas) |
| `current-game-started.json` | `GET /api/user/tom230/current-game` (Accept JSON) |
| `current-game-ai-finished.json` | `GET /api/user/thibault/current-game` (última partida, encerrada, contra IA) |
| `stream-game-live.ndjson` | `GET /api/stream/game/6fwDn5JD` (primeiras 6 linhas) |
| `stream-game-finished.ndjson` | `GET /api/stream/game/0u7534ir` (início e descrição final) |

## Dados sintéticos

Os testes de integração e o E2E (`tests/e2e/fakeLichess.ts`) usam dados fictícios gerados no próprio teste (ex.: DarcioAlberico 6º→3º e EnxadristaHeterodoxo 4º→5º são dados de demonstração, não classificação real).
