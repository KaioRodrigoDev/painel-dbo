# Atividade: gestão de VIP e dashboard de jogadores

## Objetivo

Ampliar o painel administrativo do Dbo World para identificar contas VIP, gerenciar os níveis de 0 a 3, definir a validade, renovar antes do vencimento e remover automaticamente o VIP vencido por meio de uma rotina diária. Criar uma dashboard com uma visão geral das contas e dos personagens.

## Estado atual

Implementação do painel, rotas, migração e rotina diária concluída em 05/09/2026. A migração foi aplicada no MariaDB 10.4 local e a tarefa `DboWorld-Admin-Vip-Expiry` foi instalada no Agendador do Windows para 00h05 no fuso de São Paulo.

Validações concluídas:

- verificação de tipos;
- lint dos arquivos desta atividade;
- seis testes das regras de concessão, renovação, data personalizada e estados;
- build de produção do Next.js.
- migração real do banco e confirmação de `vip_expires_at` e do índice composto;
- simulação sem candidatos vencidos;
- execução manual da tarefa do Windows, concluída com código 0 e registro `success` no banco.

O lint completo conserva dois erros preexistentes de `prefer-const` em `scripts/add-vip-icon-surface.ts`, fora desta atividade. O build conserva um aviso preexistente de rastreamento de arquivos em `src/lib/game-paths.ts`.

O usuário informou que o banco já possui o campo `vip`. A documentação local dos canais também referencia `accounts.vip`, com níveis de 0 a 3. O tipo real da coluna e o schema em uso deverão ser conferidos antes da migração.

No painel atual:

- `src/lib/db.ts` consulta contas e personagens, mas não inclui VIP no retorno das contas.
- `src/lib/types.ts` define `AccountSummary` sem nível VIP ou validade.
- `src/app/api/accounts/route.ts` oferece consulta autenticada com busca e paginação.
- `src/components/admin-dashboard.tsx` reúne a interface de jogadores e as demais seções administrativas.
- `scripts/LEIA-ME-canais-vip.md` documenta que cada canal VIP exige o nível exato, enquanto canais de nível 0 são abertos a todos.

## Regras de negócio

### Níveis e identificação

| Valor | Identificação no painel |
| --- | --- |
| 0 | Sem VIP |
| 1 | VIP 1 |
| 2 | VIP 2 |
| 3 | VIP 3 |

O VIP pertence à conta e se aplica aos seus personagens. Uma conta com vários personagens deve ser contada apenas uma vez no total de contas VIP.

Os níveis não alteram privilégios administrativos ou de GM. A atividade não modifica benefícios nem a regra de acesso dos canais existentes; não pressupor que VIP 3 tenha acesso aos canais VIP 1 e VIP 2.

### Concessão e edição

Na listagem de contas, disponibilizar a ação **Gerenciar VIP**, com identificação da conta, nível atual e validade atual.

Ao selecionar um nível de 1 a 3, exigir uma validade. Oferecer:

- 15 dias;
- 30 dias, opção inicial;
- 60 dias;
- data personalizada, usando um seletor de data.

Mostrar a data final calculada antes de salvar. Calcular e validar o prazo no backend; não confiar no valor calculado pelo navegador.

Para uma nova concessão ou um VIP já vencido, os períodos predefinidos partem do instante da operação. Cada dia predefinido equivale a 24 horas. Uma data personalizada significa validade até o fim do dia escolhido no fuso `America/Sao_Paulo`; armazenar como limite exclusivo o início do dia seguinte convertido para UTC.

Aceitar somente os números inteiros 0, 1, 2 e 3. Recusar datas inválidas e limites que já tenham passado. Ao selecionar nível 0, remover o VIP e limpar a validade, registrando a validade anterior na auditoria.

Permitir trocar entre níveis 1, 2 e 3 preservando uma validade futura existente. A troca de nível, por si só, não acrescenta dias. Para contas sem validade ou vencidas, exigir uma nova validade ao atribuir um nível positivo.

### Renovação antecipada

Disponibilizar a ação **Renovar VIP**, sem exigir que o benefício tenha terminado. O nível atual deve vir selecionado; para uma conta de nível 0, exigir a escolha de um nível positivo.

Para renovar por 15, 30 ou 60 dias:

`nova validade = maior entre validade atual e instante atual + período escolhido`

Assim, uma conta que ainda tem 10 dias e recebe uma renovação de 30 dias passa a ter 40 dias restantes. Uma conta vencida recebe o período completo a partir da renovação.

Na renovação por data personalizada, a nova validade precisa ser posterior tanto ao instante atual quanto à validade vigente, quando houver. Encurtar uma validade deve ocorrer pela edição explícita, e não pela ação de renovar.

Exibir validade anterior e nova validade antes da confirmação. Evitar duplo envio e garantir que repetir a mesma requisição após uma falha de rede não acrescente o período duas vezes.

## Banco de dados

Manter o campo `vip` existente e adicionar à tabela `accounts`:

| Campo proposto | Tipo proposto | Uso |
| --- | --- | --- |
| `vip_expires_at` | `DATETIME NULL` | Instante de expiração em UTC, com limite exclusivo |

Confirmar a compatibilidade do tipo e da migração com a versão instalada do MySQL antes de executar. Preparar uma migração versionada que possa ser repetida sem erro e sem sobrescrever datas existentes. Avaliar um índice composto em `vip` e `vip_expires_at` para a busca diária de vencidos.

O banco deve usar UTC nas operações de validade. Um VIP com prazo está ativo somente enquanto `agora < vip_expires_at`; no instante do limite já está vencido.

### Contas existentes

Não atribuir automaticamente 15, 30 ou 60 dias aos VIPs existentes, pois não há informação sobre o prazo contratado.

- Contas com `vip = 0` permanecem sem VIP e com validade nula.
- Contas com `vip` entre 1 e 3 e validade nula aparecem como **VIP sem validade cadastrada**.
- Essas contas continuam identificadas como VIP legado, separadas dos VIPs com prazo ativo nos indicadores.
- A rotina de expiração não remove VIPs sem data; a dashboard deve destacá-los para regularização.
- Novas concessões pelo painel não podem gerar VIP sem validade.
- Valores existentes fora de 0 a 3 devem ser sinalizados para revisão, sem conversão silenciosa.

## Interface de contas

Adicionar nível VIP e validade à apresentação de cada conta, mantendo a busca, a paginação e os personagens associados.

Apresentar estados distinguíveis por texto, além de cor:

- Sem VIP;
- VIP 1, VIP 2 ou VIP 3 ativo;
- vencendo nos próximos 7 dias;
- vencido, aguardando processamento;
- VIP sem validade cadastrada.

Oferecer filtros por nível e por situação da validade. Os filtros devem ser aplicados no backend antes da paginação, com totais correspondentes ao filtro. Ao mudar o filtro, voltar à primeira página.

O formulário deve mostrar carregamento, impedir confirmações repetidas durante o envio e apresentar erros de validação ou de conexão sem descartar o preenchimento. Após salvar, atualizar a conta e os indicadores da dashboard.

## Dashboard geral

Ao entrar no painel após o login, o administrador deve visualizar automaticamente esta dashboard como tela inicial, com a visão geral das contas e os indicadores de VIP, sem precisar selecionar uma aba. Manter acesso direto à listagem de contas e às demais seções administrativas a partir dessa tela.

Criar uma visão geral de jogadores, com acesso à listagem de contas. Os indicadores devem considerar toda a base, e não apenas a página carregada:

| Indicador | Definição |
| --- | --- |
| Total de contas | Quantidade de contas cadastradas |
| Total de personagens | Quantidade de personagens cadastrados |
| Personagens online | Personagens com `IsOnline = 1` |
| Contas online | Contas distintas com ao menos um personagem online |
| Contas VIP com prazo ativo | Nível entre 1 e 3 e validade futura |
| VIPs ativos por nível | Distribuição dos VIPs com prazo ativo entre 1, 2 e 3 |
| VIPs vencendo em 7 dias | Validade maior que agora e menor ou igual a agora mais 7 dias |
| VIPs vencidos pendentes | Nível entre 1 e 3 e validade menor ou igual a agora |
| VIPs sem validade | Nível entre 1 e 3 e validade nula |

Exibir também o total de contas com VIP vigente, somando VIPs com prazo ativo e VIPs legados sem validade, com essa composição visível. Não incluir vencidos nesse total, mesmo antes da execução diária.

Incluir uma lista dos próximos vencimentos com conta, nível, validade e ação de renovação. Cards de situação devem abrir a listagem com o filtro correspondente. Mostrar quando os dados foram atualizados e a última execução da rotina diária, incluindo falhas.

Não duplicar totais ao relacionar contas e personagens. Tratar indisponibilidade do banco como erro de carregamento, sem exibir zeros como se fossem dados reais.

## Rotina diária de expiração

Criar uma rotina executável fora do ciclo de requisições do Next.js. Ela deve funcionar mesmo sem administradores com o painel aberto.

Agendamento proposto: diariamente às **00h05 no fuso America/Sao_Paulo**. Em Linux, usar cron com fuso configurado explicitamente; no ambiente Windows, usar o Agendador de Tarefas com execução diária equivalente. Entregar script, configuração de agendamento e instruções de instalação adequadas ao ambiente real.

Fluxo:

1. Registrar início e identificador da execução.
2. Selecionar contas com nível entre 1 e 3, validade preenchida e limite menor ou igual ao instante atual em UTC.
3. Revalidar o vencimento na operação de escrita, impedindo que uma renovação concorrente seja desfeita.
4. Alterar `vip` para 0 e limpar `vip_expires_at`, preservando o nível e a data anteriores na auditoria.
5. Registrar contas processadas, quantidade de alterações, duração, conclusão ou falha.

A execução deve ser idempotente: rodar novamente não gera nova remoção das mesmas contas. Usar transações e bloqueios compatíveis com a tabela para coordenar expiração, edição e renovação. Evitar instâncias concorrentes do job e permitir recuperação após interrupção.

Se o computador estiver desligado no horário, configurar execução assim que possível após a retomada. A próxima execução deve processar todos os vencimentos atrasados, e não apenas os ocorridos no dia corrente. Uma falha de banco deve produzir saída de erro e registro consultável, sem indicar sucesso.

Oferecer modo de simulação para listar e contar candidatos sem alterar contas. O teste de instalação deve comprovar o funcionamento do agendamento, além da execução manual do script.

Como a rotina é diária, o campo `vip` pode permanecer positivo entre o vencimento e o próximo processamento. O painel deve sinalizar essa condição imediatamente pela data. Em operação normal, a remoção no banco pode demorar até aproximadamente 24 horas; falhas ou indisponibilidade podem ampliar esse intervalo.

## Integração com o servidor do jogo

Antes de implementar a escrita, conferir onde AuthServer, QueryServer, CharServer e GameServer carregam, armazenam em cache e salvam `accounts.vip`.

Definir e testar como concessão, troca de nível, renovação e expiração chegam às sessões em andamento. Uma escrita direta no banco não deve ser tratada como prova de que os benefícios e permissões já mudaram no jogo.

Reutilizar a coordenação pelo QueryServer quando aplicável. Garantir que um salvamento posterior não restaure um nível VIP expirado. Se a integração exigir novo login para aplicar o nível, documentar e comunicar esse comportamento no painel, incluindo o tratamento de jogadores que permaneçam conectados.

A política para jogadores conectados em um canal VIP no vencimento deve ser definida durante essa análise. Não introduzir desconexão automática sem explicitar essa decisão. Registrar a solução adotada e validar sua compatibilidade com os canais existentes antes de concluir a atividade.

## Backend, autorização e auditoria

Contratos propostos:

- Ampliar `GET /api/accounts` com nível, validade, situação e filtros de VIP.
- Criar `GET /api/dashboard` para indicadores globais e próximos vencimentos.
- Criar `PATCH /api/accounts/[id]/vip` para concessão, edição, remoção e renovação, com operação explícita no corpo.
- Criar um comando interno de expiração diária; não depender de uma rota pública para o agendamento local.

Reutilizar a autenticação administrativa e a verificação de origem nas mutações. Validar entradas no servidor, parametrizar consultas e retornar erros claros para conta inexistente, dados inválidos ou conflito de atualização.

Registrar administrador ou rotina responsável, conta, operação, nível anterior e novo, validade anterior e nova, instante UTC e identificador da requisição. Assegurar que uma alteração confirmada não fique sem histórico recuperável; definir uma estratégia transacional de auditoria, com exportação ao log existente se necessário.

Não enviar credenciais ou dados internos desnecessários ao navegador. O agendamento usa configuração do servidor, sem incluir segredos em argumentos de comandos ou neste documento.

## Etapas de implementação

1. Conferir o schema real e o fluxo de VIP no servidor do jogo.
2. Ler os guias locais relevantes em `node_modules/next/dist/docs/` antes de alterar o Next.js, conforme `AGENTS.md`.
3. Preparar migração, auditoria e tratamento de VIPs legados.
4. Implementar leitura, filtros, edição e renovação com controle de concorrência e repetição de requisições.
5. Implementar interface de contas e dashboard com métricas globais.
6. Implementar a rotina diária e a integração necessária com as sessões do jogo.
7. Instalar e validar o agendamento no ambiente de destino.
8. Executar os testes de aceitação e atualizar este documento com resultados e limitações verificadas.

## Aplicação em outro ambiente

Com o MySQL ligado, executar:

```powershell
npm run vip:migrate
npm run vip:dry-run
powershell -ExecutionPolicy Bypass -File scripts\install-vip-task.ps1
```

Depois, abrir o Agendador de Tarefas, localizar `DboWorld-Admin-Vip-Expiry` e iniciar uma execução manual. A dashboard mostrará a última execução após a conclusão. Os comandos são repetíveis, com exceção do instalador, que recusa substituir silenciosamente uma tarefa existente.

## Critérios de aceitação

- [ ] Após o login, o painel abre diretamente na dashboard com a visão geral das contas, sem exigir navegação adicional.
- [ ] A listagem identifica níveis 0, 1, 2 e 3, validade e situação de cada conta.
- [ ] Conceder VIP exige nível positivo e validade válida, com opções de 15, 30, 60 dias e data personalizada.
- [ ] Trocar o nível pode preservar a validade; remover VIP define nível 0 e limpa a data.
- [ ] Renovar antecipadamente preserva todos os dias restantes e funciona também após o vencimento.
- [ ] Repetir a mesma requisição de renovação não duplica os dias concedidos.
- [ ] VIPs legados sem data ficam destacados e não são removidos automaticamente.
- [ ] Filtros e totais funcionam com paginação e contas com vários personagens.
- [ ] Dashboard apresenta números globais e separa VIP ativo, legado e vencido.
- [ ] Data personalizada respeita o fim do dia em São Paulo, sem depender do fuso do navegador.
- [ ] A expiração ocorre quando o instante atual é igual ou posterior ao limite; datas futuras permanecem intactas.
- [ ] Job diário muda vencidos para nível 0, registra histórico e pode ser repetido com segurança.
- [ ] Renovação concorrente e expiração não perdem uma renovação confirmada.
- [ ] Indisponibilidade, retomada e processamento de vencimentos atrasados são testados.
- [ ] Agendamento real funciona sem navegador aberto e sua última execução fica visível.
- [ ] Rotas recusam acesso não autenticado, origem inválida e níveis ou datas inválidos.
- [ ] Alterações e expirações são verificadas no jogo, inclusive com jogador conectado e salvamento posterior.
- [ ] Lint, verificação de tipos e testes relevantes passam após a implementação.

## Fora do escopo

Pagamento, cobrança recorrente, compra de VIP pelo jogador, criação de benefícios ou canais novos e mudanças nas permissões administrativas. A atividade gerencia a atribuição e o prazo dos níveis VIP existentes.
