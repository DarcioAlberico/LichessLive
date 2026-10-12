# Política de dados locais

Lichess Team Studio funciona sem backend, sem login adicional e sem token para os recursos públicos.

## O que fica guardado e onde

- **chrome.storage.local**: preferências pequenas (fuso horário, intervalos de coleta, preset ativo, último team) e o instante da pausa global após HTTP 429.
- **chrome.storage.session**: quais abas estão em modo transmissão (apagado ao fechar o Chrome).
- **IndexedDB da extensão**: cadastro de jogadores (username, nome de exibição, recorte), fotos normalizadas (até 512×512, sem metadados), teams e membros importados da lista pública, listas de acompanhados, presets, sessões, observações de posição e backups automáticos anteriores a uma importação.
- Nada é gravado em **chrome.storage.sync**. As fotos nunca saem deste perfil do Chrome e não alteram o avatar no Lichess.

## O que é enviado à rede

Somente requisições GET aos endpoints públicos de `https://lichess.org/api/` (torneio, resultados, placar de teams, membros públicos, partida atual, usuário público e stream de lances), sem cookies (`credentials: omit`). Nenhum dado do cadastro, foto ou diagnóstico é enviado a qualquer servidor.

## O que nunca é guardado

Tokens, cookies, senhas, conteúdo de chat ou dados de sessão autenticada. O backup e o diagnóstico também não contêm esses dados; o diagnóstico registra apenas tipo de evento, canal, duração, cobertura e erro.

## Retenção

Por padrão: até 30 sessões e 30 dias de observações (orçamento de 100 MB para histórico) e 100 MB para fotos. Esses limites são do produto, não quotas garantidas do Chrome. O painel de configurações mostra o uso e avisa antes de descartar sessões antigas — o descarte é uma ação explícita do operador.

## Exportação e remoção

O operador pode exportar um backup ZIP a qualquer momento (opcionalmente com histórico) e exportar o diagnóstico pelo painel. Remover a extensão em `chrome://extensions` apaga todos os dados locais dela.
