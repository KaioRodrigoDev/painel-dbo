# Atividade: envio de itens pelo correio para contas VIP

## Objetivo

Permitir que o administrador envie um item do catálogo do servidor para um personagem pertencente a uma conta VIP vigente, usando o correio do jogo.

## Implementação

- A listagem de contas mostra **Enviar item** somente para VIP ativo, vencendo ou legado sem validade.
- O administrador escolhe um personagem da conta, pesquisa o item por nome ou TBLIDX, define a quantidade e escreve uma mensagem.
- Na visão geral, o administrador também pode iniciar um lote para todas as contas VIP 1, VIP 2 ou VIP 3.
- Antes de confirmar o lote, o painel mostra o total do grupo, quantos receberão e quantas caixas cheias serão ignoradas.
- Cada conta recebe somente uma cópia, enviada ao seu primeiro personagem (menor `CharID`). Cada lote possui chave idempotente e registro em `admin_mail_batches`.
- A API confirma novamente que a conta está VIP, que o personagem pertence à conta, que o item existe e que a quantidade respeita a pilha máxima.
- Caixas com 30 mensagens são recusadas antes da solicitação e revalidadas pelo QueryServer.
- A solicitação recebe um UUID e pode ser reenviada sem duplicar o item.
- O painel não gera IDs de item. Ele grava em `admin_mail_items`, e o QueryServer consome a fila usando o contador oficial de `CItemManager`.
- O QueryServer cria o item no estado selado (o "ovo" negociável) e o correio em uma transação, registrando `ItemID`, `MailID`, status e eventual erro.
- Correios usam remetente `[DBO Admin]`, tipo de remetente GM, anexo de item e validade de 30 dias.
- Itens temporários recebem início e fim conforme a duração definida em `Table_Item_Data.rdf`.

## Estado no ambiente

- Tabelas `admin_mail_items` e `admin_mail_batches` criadas no MariaDB local, sem solicitações ou lotes de teste.
- QueryServer x64 compilado e instalado em `DboServer/ExecutionEnv/QueryServer.exe`.
- Executável anterior salvo em `DboServer/backup-exe-antes-correio-vip-20260913/QueryServer.exe`.
- QueryServer atualizado ativo no ambiente desde 13/09/2026 às 08h05, iniciado depois da instalação do novo executável.
- O consumidor de `admin_mail_items` está carregado e verifica solicitações a cada 10 segundos.

## Validações concluídas

- TypeScript sem erros.
- Lint dos arquivos alterados sem erros.
- Build de produção do Next.js concluído.
- Build Release x64 do QueryServer concluído.
- Migração da fila aplicada sem criar item ou correio real.

## Fluxo de uso

1. Iniciar ou reiniciar o QueryServer instalado.
2. Entrar no painel e abrir **Jogadores**.
3. Expandir uma conta VIP vigente e selecionar **Enviar item**.
4. Escolher o personagem, item, quantidade e mensagem.
5. Confirmar o envio; o QueryServer verifica a fila a cada 10 segundos.
6. O correio do jogador sincroniza periodicamente com o banco do jogo.

## Limites

- O envio atual cria o item com o rank, a durabilidade, o atributo, a opção fixa e a duração base do catálogo. Não oferece geração manual de opções aleatórias ou grade de upgrade.
- Cada solicitação leva uma pilha; a quantidade máxima depende do item.
- Somente contas VIP vigentes podem receber por este fluxo.
