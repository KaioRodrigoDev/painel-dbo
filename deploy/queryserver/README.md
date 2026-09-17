# QueryServer para entregas administrativas

Este `QueryServer.exe` processa as duas filas administrativas. No Cash Shop,
qualquer personagem da conta pode retirar o produto. Pelo correio, ele cria
o item normal ou selado, conforme a opção escolhida, e envia para o personagem
selecionado pelo administrador.

Quando o jogador retira um anexo do correio, o QueryServer atualiza a fila
administrativa para `claimed` e grava a data, o personagem e a posição do
inventário. Esse comprovante permanece em `admin_mail_items` mesmo que o
jogador apague o correio depois.

O consumidor usa o contador oficial de `ProductId` e atualiza o cache de contas
que já estejam conectadas.

Antes de usar o correio, execute `npm run mail:migrate` no painel. Esse comando
cria `admin_mail_items`, `admin_mail_batches` e
`admin_mail_recipient_preferences` em `dbo_char`, além das filas do Cash Shop
em `dbo_acc`.

Para instalar no servidor:

1. Desligue o QueryServer.
2. Faça backup do `QueryServer.exe` atual.
3. Copie este arquivo para a pasta de execução do servidor.
4. Inicie novamente o QueryServer.

Não substitua o executável enquanto o processo estiver aberto.
