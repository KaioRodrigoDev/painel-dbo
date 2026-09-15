# QueryServer para o correio administrativo

Este `QueryServer.exe` cria todos os itens enviados pelo painel com
`RestrictState = 100` (`ITEM_RESTRICT_STATE_TYPE_SEAL`), o mesmo estado usado
pelo comando `itema`.

Ao iniciar, ele também corrige anexos administrativos antigos que ainda estão
no correio com outro estado. Itens que o jogador já retirou não são alterados.

Para instalar no servidor:

1. Desligue o QueryServer.
2. Faça backup do `QueryServer.exe` atual.
3. Copie este arquivo para a pasta de execução do servidor.
4. Inicie novamente o QueryServer.

Não substitua o executável enquanto o processo estiver aberto.
