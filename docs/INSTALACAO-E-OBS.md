# Instalação, preparação e captura no OBS

## 1. Instalar

1. Baixe `release/lichess-team-studio-1.0.0.zip` e extraia em uma pasta permanente (ex.: `C:\LichessTeamStudio`). Ou gere a pasta com `npm ci && npm run build` (resultado em `dist/`).
2. No Chrome, abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**. Selecione a pasta extraída (a que contém `manifest.json`).
3. Fixe o ícone da extensão na barra (ícone de quebra‑cabeça → alfinete).

Requisitos: Chrome 120 ou superior no Windows 11 (ambiente homologado).

## 2. Cadastro (antes da transmissão)

Abra **Cadastro e configurações** pelo popup.

- **Jogadores e fotos**: digite o username, clique em _Pesquisar e confirmar_ (confirma a identidade no Lichess), informe um nome de exibição opcional e escolha uma foto PNG, JPEG ou WebP (até 5 MB). Arraste o quadro para posicionar o rosto e ajuste a aproximação. A foto é reexportada em até 512×512, sem metadados. Quem não tem foto aparece com iniciais.
- **Teams**: informe o ID do team (o trecho da URL `lichess.org/team/…`) e clique em _Importar membros públicos_. A tela mostra quantos membros vieram e a cobertura. Marque _Acompanhar_ nos jogadores desejados. Lista privada: use _Criar sem importar_ e adicione os usernames manualmente. Sem team, use a lista local `_local`.
- **Backup**: exporte depois de cadastrar. O ZIP restaura fotos, perfis e preferências em outro computador ou perfil.

## 3. Iniciar a sessão

1. Abra a página do torneio Arena no Lichess.
2. Clique no ícone da extensão → **Ativar modo transmissão** (ou Alt+Shift+T). A janela **Painel de operação** abre automaticamente; mantenha‑a aberta durante toda a transmissão.
3. No painel, em _Team e jogadores acompanhados_, selecione o team (em Team Battle, escolha na lista do torneio) ou `_local`.
4. Em _Programa_, escolha o preset: _Uma partida · 1080p_, _Compacto · 720p_ ou _Tabuleiro amplo_. Ajuste margens seguras se o OBS cortar bordas.
5. Em _Torneio e sessão_, use **Ajustar para 1920×1080 úteis** (ou 1280×720). O painel considera a escala de exibição do Windows.
6. Carregue a primeira partida: clique em _Abrir_ em _Partidas identificadas_, em _Abrir partida/Acompanhar_ na lista do team, ou digite um username/ID.
7. Confira o rodapé do programa: fonte, "Lances com atraso da API (3 lances)" e hora da última posição.

## 4. Capturar no OBS Studio

1. **Fontes → + → Captura de janela**. Em _Janela_, escolha a janela do Chrome com o torneio (título começa com o nome do torneio). **Não** escolha a janela "Painel de operação".
2. _Método de captura_: **Windows 10 (1903 e superior)**. Desative _Capturar cursor_.
3. Clique com o botão direito na fonte → **Transformar → Ajustar à tela**.
4. Se a barra de abas/endereço do Chrome aparecer, use **Filtros → Recortar/Preencher** (topo ≈ altura da barra do Chrome) ou abra o torneio em uma janela própria sem outras abas.
5. Em _Configurações → Vídeo_, base 1920×1080 e saída 1920×1080 (ou 1280×720).
6. Grave 30 s de teste e confira nomes, relógios e progresso no vídeo final — inclusive reduzido a 720p.

A composição mostra no canto inferior direito "Lichess Team Studio · programa" para identificar a janela correta; o painel de operação tem uma faixa laranja à esquerda.

## 5. Durante a transmissão

| Ação                                | Onde                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| Trocar a partida                    | clique na lista _Partidas_ do programa ou _Abrir_ no painel    |
| Ir para a partida de um jogador     | clique em _Nosso team_ / _Classificação_ (acompanha o jogador) |
| Girar o tabuleiro                   | Alt+Shift+B ou _Girar tabuleiro_                               |
| Fixar a partida                     | Alt+Shift+P ou _Fixar partida_                                 |
| Aceitar nova partida do acompanhado | aviso azul no painel → _Trocar_                                |
| Mudar a aba mostrada ao público     | _Programa_ → botões de aba                                     |
| Esconder pontos e resultados        | _Ocultar pontos e resultados_                                  |
| Nova referência de progresso        | _Marcar referência agora_                                      |

Atalhos podem ser remapeados em `chrome://extensions/shortcuts`; o atalho é ignorado quando você está digitando em um campo.

## 6. Problemas comuns

- **"Painel desconectado"** na composição: a janela de operação foi fechada. Clique em _Reabrir painel_; a seleção e a referência são restauradas.
- **"Limitação de acesso"**: o Lichess respondeu HTTP 429. As atualizações pausam por pelo menos 60 s automaticamente; não recarregue em sequência.
- **"Sem partida atual confirmada"**: o jogador não está jogando; o painel oferece a última partida como replay.
- **"Partida sem vínculo confirmado"**: a partida não pôde ser associada ao torneio; o painel pede confirmação.
- **Swiss**: reconhecido e informado como não suportado na versão 1.0.

## 7. Desativar

Popup → **Desativar modo transmissão** (ou Alt+Shift+T). A página do Lichess volta exatamente ao estado anterior, sem recarregar.
