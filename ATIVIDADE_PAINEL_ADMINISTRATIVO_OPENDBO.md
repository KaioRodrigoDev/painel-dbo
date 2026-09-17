# Atividade: painel administrativo web do OpenDBO

## Objetivo

Criar, dentro da pasta `developer`, um painel exclusivo para administradores que liste contas e personagens do OpenDBO e permita executar de forma controlada funções administrativas já existentes no projeto.

Este é o documento único e contínuo desta atividade. Novos diagnósticos e medidas devem ser acrescentados aqui até a tarefa ser concluída.

## Decisões iniciais

- Projeto: `OpenDBO-Admin`.
- Frontend: React.
- Backend: Route Handlers do Next.js.
- Persistência: bancos MySQL `dbo_acc` e `dbo_char` já usados pelo servidor.
- Execução: Node.js/npm local.
- Docker foi considerado, mas descartado a pedido do usuário porque não está instalado no computador.

React e backend ficam na mesma aplicação Next.js. Isso reduz configuração, mantém as credenciais somente no servidor e permite compartilhar tipos e validações sem criar dois projetos independentes.

## Mapeamento do OpenDBO

O schema foi conferido diretamente em:

```text
Server/DboServer/Database/dbo_acc.sql
Server/DboServer/Database/dbo_char.sql
```

## Catálogo de mobs no painel

Foi adicionada a aba `Mobs`, em modo somente leitura. Ela carrega os 7.260 registros de `Table_MOB_Data.rdf`, resolve os nomes localizados pela seção `MOB_DATA` de `table_text_all_data.rdf` e permite busca por nome, TBLIDX ou modelo, além de filtros por grau e tipo.

A tabela apresenta nível, LP, experiência e zeni. A janela de detalhes reúne identificação, grupo, classe, atributos ofensivos e defensivos, alcance, velocidades, visão, recompensas e flags relevantes. A rota protegida `GET /api/mobs` faz paginação no servidor e não modifica o RDF nem mobs ativos.

As contas estão em `accounts`; os personagens estão em `characters`. O QueryServer já atualiza `Level`, `Exp`, `SpPoint`, `Money`, `Class`, `Gender` e `Adult` em operações existentes.

Para o MVP foram escolhidos os campos de menor risco:

- nível;
- experiência;
- pontos de habilidade;
- zeni.

Raça, classe, gênero e estado adulto permanecem visíveis, mas bloqueados para edição. Alterá-los diretamente no banco pode deixar habilidade, equipamento, aparência ou progressão incompatíveis.

## Segurança implementada

1. O login administrativo usa usuário e senha exclusivos definidos em `.env.local`.
2. A comparação das credenciais usa hashes e `timingSafeEqual`.
3. A sessão é um JWT HS256 com duração de oito horas.
4. O token fica em cookie `HttpOnly`, `SameSite=Strict` e de alta prioridade.
5. Todas as rotas privadas repetem a autorização perto da fonte dos dados.
6. Requisições de alteração exigem a mesma origem para reduzir risco de CSRF.
7. O login possui limite local de cinco tentativas em quinze minutos.
8. Nenhum hash de senha ou endereço IP das contas é enviado ao navegador.
9. Os módulos de banco, sessão e auditoria usam `server-only`.

## Consulta de contas e personagens

`GET /api/accounts` recebe busca e página. A API consulta primeiro `dbo_acc.accounts` e depois busca em `dbo_char.characters` somente os personagens das contas retornadas.

O navegador recebe DTOs explícitos, contendo apenas os campos necessários para a interface.

## Atualização de personagem

`PATCH /api/characters/[id]` aceita nível, experiência, SP e zeni.

O fluxo é:

1. validar sessão administrativa e origem;
2. validar tipos e limites com Zod;
3. iniciar uma transação no banco de personagens;
4. executar `SELECT ... FOR UPDATE`;
5. recusar a alteração se `IsOnline=1`;
6. atualizar somente as quatro colunas permitidas;
7. confirmar a transação;
8. registrar administrador, personagem, valores anteriores e novos em `data/admin-audit.jsonl`.

O bloqueio para personagens online existe porque o GameServer mantém uma cópia em memória e poderia sobrescrever uma edição direta no próximo salvamento.

## Interface React

O painel contém:

- tela de login;
- busca por usuário ou ID da conta;
- paginação;
- estado da conta e indicador de GM;
- agrupamento dos personagens por conta;
- indicadores online/offline;
- formulário modal de edição;
- explicação dos campos protegidos;
- mensagens de carregamento e falha de conexão.

## Configuração local

O script `scripts/import-opendbo-config.mjs` lê as seções `DATABASE_ACCOUNT` e `DATABASE_CHARACTER` do `QueryServer.ini`, cria `.env.local`, gera uma senha administrativa aleatória e gera o segredo de sessão.

`.env.local`, logs de auditoria, dependências e artefatos do Next.js estão fora do controle de versão.

## Estado atual

- Schema e comandos existentes mapeados.
- Base Next.js/React criada.
- Dependências instaladas sem vulnerabilidades reportadas pelo npm.
- Autenticação, camada MySQL, APIs e interface implementadas.
- Configuração local criada a partir do `QueryServer.ini` existente.
- Lint, verificação TypeScript e build de produção concluídos.
- Login, conexão com os dois bancos e listagem de contas testados com sucesso.
- Pasta validada entregue em `developer/OpenDBO-Admin`.

## Validação e correções durante a atividade

Na primeira validação estática foram encontrados dois problemas, ambos corrigidos antes da entrega:

1. o carregamento inicial do componente React acionava estado de forma síncrona dentro de um efeito; a consulta foi agendada e ganhou cancelamento com `AbortController`;
2. a tipagem automática `RouteContext` ainda não existia antes da geração dos tipos do Next.js; a rota passou a declarar explicitamente o contrato assíncrono de `params`.

O primeiro build concluiu, mas avisou que o caminho configurável do log de auditoria ampliava desnecessariamente o rastreamento de arquivos do Turbopack. O log foi fixado no subdiretório local `data`, eliminando o aviso. O segundo build de produção concluiu sem erros nem avisos.

Resultados finais:

```text
npm audit:        0 vulnerabilidades
npm run lint:     aprovado
npm run typecheck: aprovado
npm run build:    aprovado
login da API:     HTTP 200
saúde dos bancos: HTTP 200 (connected)
lista de contas:  HTTP 200, 2 contas encontradas no ambiente atual
```

O teste de integração foi somente leitura. Nenhum personagem, conta ou item foi modificado. O servidor Next.js usado no teste foi encerrado ao final para não consumir CPU em segundo plano.

## Como executar depois da entrega

Abra um PowerShell em `C:\Users\Kaio\Documents\developer\OpenDBO-Admin` e execute:

```powershell
npm run dev
```

Depois abra `http://localhost:3000`. O usuário e a senha administrativos estão no arquivo local `.env.local`; esse arquivo também contém a conexão importada do OpenDBO e não deve ser publicado.

Quando terminar de usar o painel, pressione `Ctrl+C` no terminal. Não é necessário reiniciar todos os servidores do OpenDBO para abrir o painel: basta que o MySQL esteja acessível. Para editar um personagem, ele precisa estar offline.

## Resultado e limites desta primeira versão

A atividade entrega um painel funcional, sem Docker, para autenticar um administrador, listar contas e personagens e editar nível, experiência, SP e zeni de personagem offline. Cada edição concluída gera uma linha de auditoria em `data/admin-audit.jsonl`.

Raça, classe, gênero e estado adulto continuam somente leitura por decisão de segurança. Uma próxima atividade pode integrar essas mudanças ao GameServer/QueryServer, preservando as regras internas de progressão, habilidades, aparência e equipamentos.

## Incidente no primeiro teste de nível

No primeiro teste funcional, o nível alterado pelo painel apareceu corretamente na seleção de personagens, mas voltou ao valor anterior ao entrar no jogo.

A investigação mostrou que as duas telas recebiam dados de fontes diferentes:

```text
seleção de personagem -> CharServer -> tabela characters
entrada no mundo      -> GameServer -> QueryServer -> CPlayerCache
```

Em `CGameServerSession::OnLoadPcCheck`, o QueryServer procurava primeiro o personagem em `CPlayerCache`. Se encontrasse, enviava o conteúdo antigo diretamente ao GameServer e não relia a tabela `characters`. O cache só era removido na exclusão definitiva de um personagem. Assim, editar apenas o MySQL não era suficiente depois que aquele personagem já havia entrado no jogo ao menos uma vez desde a inicialização do QueryServer.

Também foi confirmado que a coluna `characters.IsOnline`, consultada pela primeira versão do painel, não era mantida pelo fluxo atual do GameServer/QueryServer. Portanto, o rótulo online/offline não oferecia ainda a garantia necessária.

## Correção do ciclo de cache e presença online

Foi aproveitado o protocolo `GQ_PC_EXIT`, que já existia nos arquivos compartilhados, mas não possuía envio nem tratamento nos servidores.

As seguintes medidas foram implementadas:

1. ao carregar um personagem no mundo, o QueryServer grava `IsOnline=1`;
2. ao sair do jogo, o GameServer envia `GQ_PC_EXIT` depois dos pacotes de salvamento;
3. o QueryServer trata esse pacote, remove todos os caches de personagem associados à conta e grava `IsOnline=0`;
4. mudanças de canal ou de servidor não removem o cache, pois o servidor de destino precisa dos dados temporários de transição;
5. no próximo login normal, sem o cache antigo, o QueryServer volta a carregar `Level`, `Exp`, `SpPoint` e `Money` da tabela atualizada pelo painel.

Arquivos alterados nesta correção:

```text
Server/DboServer/Server/GameServer/CPlayer.cpp
Server/DboServer/Server/QueryServer/GamePacket.cpp
Server/DboServer/Server/QueryServer/GameServerSession.cpp
Server/DboServer/Server/QueryServer/GameServerSession.h
Server/DboServer/Server/QueryServer/PlayerCache.cpp
Server/DboServer/Server/QueryServer/PlayerCache.h
```

## Validação da correção dos servidores

Os dois projetos foram compilados separadamente em `Release|x64`, com no máximo dois processos paralelos:

```text
QueryServer.vcxproj: compilação aprovada
GameServer.vcxproj:  compilação aprovada
```

Binários gerados:

```text
Server/DboServer/Server/QueryServer/ExecutionEnv/QueryServer.exe
Server/DboServer/Server/GameServer/ExecutionEnv/GameServer.exe
```

Os avisos C4244 exibidos no build do GameServer já estavam em trechos não relacionados de `CPlayer.cpp`; a correção nova não gerou erro. O processo auxiliar do MSBuild que permaneceu após o build foi encerrado para não consumir recursos.

Os binários ainda não foram implantados em `Server/DboServer/ExecutionEnv`, pois o QueryServer e três GameServers antigos estavam ativos no momento da compilação. Para validar dentro do jogo será necessário encerrar essas instâncias, copiar os dois executáveis novos e iniciar a estrutura novamente. Até essa implantação, o painel deve permanecer apenas para consulta.

## Refatoração: solicitação coordenada pelo QueryServer

Depois de revisar o comportamento desejado, a edição direta do banco foi substituída por uma fila persistente. O objetivo é garantir esta ordem:

```text
painel registra solicitação
QueryServer detecta o estado do personagem
GameServer envia o jogador para a seleção, quando necessário
GameServer salva os valores antigos
GameServer confirma a saída ao QueryServer
QueryServer aplica os valores administrativos
QueryServer invalida somente o cache daquele CharID
próxima entrada carrega os valores novos
```

### Tabela de coordenação

Foi adicionada `dbo_char.admin_character_updates`. Cada linha guarda:

- personagem e conta;
- nível, experiência, SP e zeni solicitados;
- administrador responsável;
- estado da solicitação;
- datas e eventual mensagem de erro.

Estados utilizados no fluxo:

```text
pending         aguardando o QueryServer
waiting_logout  saída solicitada ao GameServer
applied         valores aplicados após a saída
failed          falha permanente ao atualizar o personagem
superseded      solicitação substituída por uma mais recente
```

O backend cria a tabela com `CREATE TABLE IF NOT EXISTS`. O QueryServer repete essa garantia na inicialização, e o schema também foi acrescentado a `Server/DboServer/Database/dbo_char.sql` para instalações novas.

### Mudança no backend web

`PATCH /api/characters/[id]` não executa mais `UPDATE characters`. Agora ele:

1. bloqueia a linha atual do personagem para obter um snapshot consistente;
2. marca uma solicitação anterior ainda ativa como `superseded`;
3. insere a nova solicitação como `pending`;
4. registra a ação e os valores anteriores no log de auditoria;
5. retorna imediatamente o identificador e o estado pendente.

Com isso, um GameServer online nunca consegue sobrescrever a alteração administrativa, pois o valor definitivo ainda não foi gravado quando ocorre o salvamento de saída.

### Processamento no QueryServer

O QueryServer consulta a fila uma vez por segundo, processando no máximo dez solicitações por ciclo.

- Sem `CPlayerCache`: considera o personagem fora do mundo, aplica os valores e invalida somente o `CharID` solicitado.
- Com `CPlayerCache`: envia `QG_PC_EXIT_RES` para a sessão exata do GameServer e muda a solicitação para `waiting_logout`.

Foi criada uma única operação de cache:

```cpp
bool CPlayerCacheManager::InvalidateCharacter(CHARACTERID charId);
```

Ela localiza, destrói e remove apenas o cache daquele personagem. A lógica administrativa não precisa conhecer os mapas internos do gerenciador.

### Retorno controlado para a seleção

O GameServer passou a tratar `QG_PC_EXIT_RES`. Ao receber a solicitação:

1. encontra o `CPlayer` pela conta;
2. muda o estado para `CHARLEAVING_CHARACTER_EXIT`;
3. reutiliza `GM_MOVE_REQ` para solicitar ao MasterServer os dados do CharServer;
4. o fluxo existente responde ao client com `GU_CHAR_EXIT_RES`;
5. o client retorna à seleção normalmente, sem ser derrubado até a tela de login.

Quando `CPlayer::LeaveGame()` termina os pacotes de salvamento, envia `GQ_PC_EXIT`. Como os pacotes usam a mesma conexão, o QueryServer recebe primeiro todos os salvamentos antigos e depois a confirmação de saída. Nesse ponto ele aplica as linhas `waiting_logout` e invalida o cache individual.

### Interface atualizada

- A edição deixou de ser bloqueada para personagem online.
- O botão informa `Editar e enviar à seleção` quando ele está conectado.
- O modal avisa explicitamente que salvar causará o retorno à seleção.
- Solicitações em processamento recebem a etiqueta `Alteração pendente`.
- Enquanto houver uma solicitação ativa, uma segunda edição pela interface fica bloqueada.
- A listagem mostra os valores solicitados sem fingir que já foram aplicados.

## Validação da abordagem coordenada

```text
npm run lint:      aprovado
npm run typecheck: aprovado
npm run build:     aprovado
QueryServer x64:   compilação aprovada
GameServer x64:    compilação aprovada
login da API:      HTTP 200
lista de contas:   HTTP 200, 2 contas
solicitações reais criadas no teste técnico: 0
```

O teste web foi somente leitura. A tabela de coordenação foi criada, mas nenhum personagem foi alterado. Os processos de build foram iniciados com reutilização de nós desativada e devem permanecer encerrados após a validação.

## Estado antes do teste dentro do jogo

O código e os binários novos estão prontos, porém ainda não foram copiados para `Server/DboServer/ExecutionEnv`. As instâncias antigas continuam ativas. O próximo passo da mesma atividade é implantar simultaneamente o novo QueryServer e o novo GameServer, reiniciar a estrutura e validar uma solicitação online de ponta a ponta.

## Implantação da fila administrativa

Depois que o usuário encerrou as instâncias antigas, foi confirmado que não restava nenhum processo OpenDBO ativo. A tabela `admin_character_updates` foi criada no `dbo_char` pelo backend com `CREATE TABLE IF NOT EXISTS`; em seguida, uma listagem que faz `LEFT JOIN` nessa tabela respondeu HTTP 200 e retornou as duas contas existentes. Isso confirmou tanto a existência quanto a compatibilidade do schema.

Antes de substituir qualquer arquivo, foram criados backups recuperáveis em `Server/DboServer/ExecutionEnv`:

```text
GameServer.before_admin_queue_20260820.exe
GameServer.before_admin_queue_20260820.pdb
QueryServer.before_admin_queue_20260820.exe
QueryServer.before_admin_queue_20260820.pdb
```

Os novos `GameServer.exe`, `QueryServer.exe` e seus símbolos foram copiados para o ambiente de execução. Os hashes SHA-256 das duas origens compiladas e dos dois destinos implantados foram comparados e coincidiram.

A estrutura foi iniciada uma única vez e ficou com o conjunto esperado:

```text
MasterServer: 1
QueryServer:  1
AuthServer:   1
CharServer:   1
ChatServer:   1
GameServer:   3
Total:        8 processos
```

Os três GameServers estabeleceram conexões com MasterServer, QueryServer e ChatServer. O QueryServer estabeleceu conexões com os três bancos MySQL e recebeu as conexões internas esperadas. Não permaneceu nenhum processo MSBuild ativo depois da implantação.

Erros encontrados pela busca nos logs possuíam horários anteriores à implantação e correspondiam a tentativas antigas de conexão durante outras inicializações; as conexões atuais estão estabelecidas.

## Estado atual para teste funcional

- Tabela de coordenação instalada.
- Backend atualizado e em execução pelo usuário.
- QueryServer coordenador implantado.
- Três GameServers com retorno à seleção implantados.
- Estrutura completa online.
- Nenhuma solicitação administrativa real foi criada automaticamente.

O próximo teste deve ser feito com um personagem online:

1. entrar no mundo com o personagem;
2. abrir o personagem no painel;
3. solicitar uma alteração pequena e identificável;
4. confirmar que o client retorna à seleção;
5. aguardar a etiqueta `Alteração pendente` desaparecer;
6. entrar novamente e conferir o novo valor.

Se qualquer etapa falhar, o diagnóstico deve continuar nesta mesma seção/documento, preservando a linha do tempo desta atividade.

## Teste funcional aprovado e encerramento

O usuário executou o teste de ponta a ponta no client e confirmou que o fluxo ficou totalmente funcional. Isso valida em conjunto:

- criação da solicitação pelo painel;
- processamento da fila pelo QueryServer;
- retorno controlado do jogador à seleção;
- salvamento dos dados anteriores antes da atualização administrativa;
- aplicação dos valores novos;
- invalidação individual do cache;
- recarga correta na entrada seguinte.

Depois da confirmação, os oito processos da estrutura foram encerrados a pedido do usuário:

```text
MasterServer: 1 encerrado
QueryServer:  1 encerrado
AuthServer:   1 encerrado
CharServer:   1 encerrado
ChatServer:   1 encerrado
GameServer:   3 encerrados
Processos restantes: 0
```

O painel Next.js não foi encerrado nessa operação. A atividade do painel administrativo e da atualização coordenada de personagens está concluída.

## Diagnóstico do falso status de falha

Depois do teste funcional, foi observado que as solicitações ficaram com `Status = 'failed'` e `ErrorMessage = 'character update failed'`, embora os valores tivessem sido aplicados corretamente. A investigação foi feita apenas com consultas de leitura, mantendo todos os servidores encerrados.

As quatro solicitações existentes estavam marcadas como falha. Entretanto, a solicitação mais recente pediu nível 70, experiência 780, 83 pontos de habilidade e 11 zenys, e esses eram exatamente os valores atuais encontrados na linha do personagem. Isso confirmou que o `UPDATE characters` foi executado.

Os horários das solicitações também coincidiram com entradas `reconnect database succeed!` no log do QueryServer. A causa está em `MySQLDatabase::_SendQuery`: quando a primeira tentativa perde a conexão, o método reconecta e repete a consulta. A repetição retorna um `bool`, mas esse valor é atribuído à variável inteira `result`. Assim, sucesso (`true`) vira `1`; ao final, o método testa `result == 0` e devolve `false` ao chamador.

O efeito é um falso negativo:

1. a conexão antiga falha;
2. a reconexão funciona;
3. a segunda execução atualiza o personagem;
4. `_SendQuery` devolve `false` por interpretar incorretamente o `true` da repetição;
5. o QueryServer grava a solicitação como `failed`.

A correção indicada é fazer `_SendQuery` retornar diretamente o resultado booleano da nova tentativa, sem convertê-lo novamente para o código inteiro usado por `mysql_query`. Essa correção ainda não foi aplicada neste diagnóstico. Nenhuma linha da fila foi alterada manualmente.

## Falha na criação de personagens após a reconexão

Ao reiniciar a estrutura, o client passou a exibir `No reply from server, connect impossible no response try again later` durante a criação de um personagem. O log do QueryServer mostrou `Commands out of sync; you can't run this command now` uma vez por segundo na consulta de `admin_character_updates` e, durante a tentativa de criação, também em `START TRANSACTION`, nos `INSERT` de itens, habilidades, portais, personagem e em `COMMIT`.

O problema é a continuação do falso retorno já diagnosticado. Quando a consulta `SELECT` da fila perde a conexão, `_SendQuery` reconecta e repete o `SELECT` com sucesso. Como o retorno bem-sucedido era convertido incorretamente em falha, `Database::FQuery` não chamava `_StoreQueryResult`. O resultado do `SELECT` ficava pendente na conexão MySQL e toda consulta posterior recebia `Commands out of sync`. Por isso o QueryServer deixava de concluir a criação e o client não recebia resposta.

A correção foi aplicada em `Server/NtlLib/Server/Database/MySQLDatabase.cpp`:

- qualquer retorno diferente de zero de `mysql_query` é tratado como erro;
- após uma reconexão bem-sucedida, `_SendQuery` retorna diretamente o resultado booleano da segunda tentativa;
- o resultado de um `SELECT` repetido com sucesso volta a ser consumido por `_StoreQueryResult`.

Essa alteração corrige tanto o status administrativo falsamente marcado como `failed` quanto o estado `Commands out of sync` que impedia a criação de personagens.

### Build, implantação e estado para o novo teste

Os oito processos OpenDBO que estavam ativos foram encerrados antes do build. O projeto `QueryServer.vcxproj`, incluindo a biblioteca estática `Database`, foi recompilado em `Release|x64`, com paralelismo de build limitado e reutilização de nós desativada:

```text
Compilação: aprovada
Erros:      0
Avisos:     42, todos em código preexistente e não relacionado
Processos de build restantes: 0
```

Antes da implantação foram criados os backups recuperáveis:

```text
QueryServer.before_mysql_retry_fix_20260820.exe
QueryServer.before_mysql_retry_fix_20260820.pdb
```

O executável e o PDB novos foram copiados para `Server/DboServer/ExecutionEnv`. Os hashes SHA-256 da origem compilada e do destino coincidiram. Em seguida, a estrutura foi iniciada novamente em segundo plano e ficou com oito processos: um MasterServer, um QueryServer, um AuthServer, um CharServer, um ChatServer e três GameServers.

Após a inicialização corrigida, o log não apresentou nenhuma nova ocorrência de `Sql query failed` ou `Commands out of sync`. A consulta periódica da fila permanece silenciosa quando tem sucesso, e o QueryServer continuou ativo junto dos demais processos. Nenhum personagem foi criado automaticamente durante essa validação; o teste funcional de criação deve ser realizado pelo usuário no client.

### Teste funcional aprovado e servidores encerrados

O usuário confirmou que a correção funcionou no client. Ao solicitar o encerramento, sete processos ainda estavam ativos — MasterServer, AuthServer, CharServer, ChatServer e três GameServers — e foram finalizados. O QueryServer já não constava entre os processos ativos naquele momento. Depois da operação, não permaneceu nenhum processo OpenDBO em execução. O painel Next.js não foi incluído no encerramento.

## Gerenciador dos servidores pelo painel administrativo

### Objetivo

Foi adicionada ao mesmo painel uma seção chamada `Servidores`. Ela substitui a necessidade de abrir e fechar manualmente vários terminais durante o desenvolvimento e reproduz a ordem usada pelo `start_all_servers.bat`.

O administrador agora pode:

- consultar o estado de cada processo;
- iniciar, parar ou reiniciar um serviço individualmente;
- iniciar os serviços selecionados na ordem correta;
- parar toda a estrutura;
- escolher quais arquivos `GameServer*.ini` participam da inicialização geral;
- salvar essa seleção como padrão para os próximos usos.

### Como foi implementado

O código de processo ficou restrito ao backend Node.js em `src/lib/server-manager.ts`. O navegador nunca recebe permissão para executar comandos ou fornecer o caminho de um executável. Existem somente cinco serviços centrais permitidos — MasterServer, QueryServer, AuthServer, CharServer e ChatServer — e o executável permitido para canais é exatamente `GameServer.exe`.

Arquivos como `GameServer.before_admin_queue_20260820.exe` são backups. Eles não correspondem ao nome exato permitido, não aparecem como opção e nunca são iniciados pelo painel.

Os arquivos de canal são descobertos apenas pelo formato `GameServer.ini` ou `GameServer` seguido de números e `.ini`. O backend lê `Channel`, `Port` e `Channelname` da seção `[Game Server]`. Arquivos com canal/porta inválidos ou duplicados bloqueiam a operação para evitar iniciar uma configuração ambígua.

A inicialização geral conserva a dependência existente:

```text
MasterServer
QueryServer
AuthServer
CharServer
GameServer do canal 0, quando selecionado
ChatServer
demais GameServers selecionados
```

Existe uma pausa de um segundo entre as inicializações, como no batch original. O painel usa o mecanismo nativo `start` do Windows para fornecer a cada servidor o console independente que seu código espera; em seguida, minimiza e oculta a janela identificada. O processo não depende da duração da requisição HTTP.

O status usa o nome e o caminho real do processo para garantir que somente executáveis dentro de `ExecutionEnv` sejam controlados. Para distinguir as várias instâncias de `GameServer.exe`, a porta em estado `LISTENING` é comparada com a porta do INI. O PID iniciado pelo painel também é salvo, permitindo identificar o processo durante os primeiros segundos, antes de a porta estar pronta.

A seleção padrão e os PIDs conhecidos são mantidos respectivamente em:

```text
data/server-manager-settings.json
data/server-manager-state.json
```

Esses arquivos são criados somente quando a funcionalidade é usada. Na primeira abertura, todos os INIs válidos encontrados ficam selecionados, reproduzindo a estrutura atual com os canais 0, 9 e 1.

Foram criadas duas rotas protegidas:

- `GET/PATCH /api/servers` para status e seleção padrão;
- `POST /api/servers/actions` para iniciar, parar e reiniciar.

As mutações exigem a sessão administrativa existente e validação de mesma origem. As ações ficam serializadas para impedir dois cliques concorrentes de iniciarem ou pararem o mesmo processo. Todas as operações também são registradas no arquivo de auditoria; uma eventual falha apenas na auditoria não transforma uma ação de servidor já concluída em resposta de falha.

### Interface

A barra superior passou a ter as abas `Jogadores` e `Servidores`. A nova tela atualiza o status automaticamente a cada quatro segundos e mostra:

- indicador ativo/parado;
- PID e horário de início;
- arquivo INI, canal e porta dos GameServers;
- botões individuais;
- comandos gerais;
- caixas de seleção dos canais.

Parar toda a estrutura, parar um serviço e reiniciar exigem confirmação no navegador. Se existir um `GameServer.exe` dentro da pasta correta que não possa ser associado a nenhum INI, o painel mostra um aviso com o PID em vez de fingir que conhece o canal.

### Validação e estado final

Foram executados:

```text
npm run lint       aprovado, 0 erros
npm run typecheck  aprovado, 0 erros
npm run build      aprovado, sem avisos
```

O build de produção reconheceu as novas rotas como dinâmicas e concluiu a geração de todas as páginas. Depois da validação, não restaram processos OpenDBO, MSBuild ou Node criados por esta atividade. Nenhum servidor do jogo foi iniciado automaticamente durante os testes.

Também foi executado um teste local autenticado e somente de leitura da API. A descoberta retornou oito serviços: cinco centrais e três GameServers. Os arquivos `GameServer.ini`, `GameServer9.ini` e `GameServer1.ini` apareceram selecionados por padrão, todos os serviços foram corretamente apresentados como parados e nenhum processo desconhecido foi encontrado. A instância temporária do painel usada no teste foi encerrada imediatamente depois da resposta HTTP 200.

O teste funcional deve ser feito iniciando o painel normalmente, entrando na aba `Servidores` e usando `Iniciar selecionados`. A primeira inicialização real deve ser acompanhada pelos indicadores e pelos logs dos servidores. Se surgir alguma diferença no ambiente real, o diagnóstico desta funcionalidade deve continuar nesta mesma seção.

### Diagnóstico da primeira inicialização pelo painel

No primeiro teste real, apenas `GameServer.ini` — canal 0 — estava selecionado. A seleção persistida em `data/server-manager-settings.json` estava correta. Apesar disso, ao final da tentativa somente MasterServer aparecia ativo no painel. A leitura direta do Windows mostrou inicialmente MasterServer e GameServer; os demais processos haviam realmente encerrado, e o GameServer ainda não havia aberto a porta 30000 porque ficou sem suas dependências.

Foram encontradas duas causas diferentes:

1. A primeira versão iniciava os executáveis sem um console. Todos os servidores chamam `CNtlServerApp::WaitCommandInput()` e esperam uma entrada de console. Sem ela, MasterServer e GameServer entravam em laço de EOF e consumiam CPU continuamente.
2. Mesmo depois de reproduzir o mecanismo de console do batch fora do painel, QueryServer continuou encerrando. A porta MySQL 3306 estava fechada. QueryServer, AuthServer, CharServer e ChatServer dependem do banco durante a inicialização. Quando o banco não responde, esses binários antigos percorrem um encerramento defeituoso; o Visualizador de Eventos registrou `APPCRASH`, `ntdll.dll` e exceção `0xc0000374` para eles.

O QueryServer foi iniciado manualmente junto do MasterServer, fora da API, para separar as causas. Ele apresentou a mesma falha com o MySQL parado, confirmando que esse segundo problema não era uma leitura incorreta do painel.

### Medidas aplicadas

O inicializador passou a usar o comando nativo equivalente ao batch, descobrir o PID novo pelo nome e pelo caminho exato em `ExecutionEnv` e ocultar a janela depois que o console independente foi criado. Isso evita o laço de EOF sem alterar ou recompilar os servidores antigos.

`Iniciar selecionados` também passou a ser transacional. O painel registra quais processos foram iniciados por aquela requisição; se algum deles encerrar durante a estabilização, os processos novos ainda ativos são finalizados na ordem inversa. Serviços que já estavam ativos antes da tentativa não são tocados. Essa reversão foi exercitada durante o diagnóstico e não deixou processos residuais.

Antes de iniciar a estrutura, o backend agora testa uma conexão TCP com o host e a porta MySQL configurados no painel. Com o banco atual parado, a resposta passou a ser imediata e explícita:

```text
O MySQL não está acessível em 127.0.0.1:3306.
Inicie o banco antes dos servidores do OpenDBO.
```

Nesse cenário são iniciados zero processos, evitando novamente o estado parcial com apenas MasterServer. A mesma verificação protege a inicialização ou reinicialização individual de qualquer serviço dependente; MasterServer continua podendo ser iniciado sozinho.

### Validação após a correção

```text
npm run lint       aprovado, 0 erros
npm run typecheck  aprovado, 0 erros
npm run build      aprovado, sem avisos
Processos OpenDBO restantes após o diagnóstico: 0
```

O MySQL permaneceu parado e não foi iniciado automaticamente, pois ele não faz parte do `start_all_servers.bat` e nenhum serviço MySQL/MariaDB registrado no Windows foi encontrado. Para concluir o teste funcional, primeiro é necessário iniciar a instância MySQL usada pelo projeto e depois clicar novamente em `Iniciar selecionados`. Com apenas `GameServer.ini` marcado, o resultado esperado é: MasterServer, QueryServer, AuthServer, CharServer, ChatServer e um GameServer de canal 0.

### Listagem de personagens após iniciar o MySQL

Depois que o MySQL do XAMPP foi iniciado, os seis processos esperados ficaram ativos, mas a aba de jogadores deixou de listar contas e personagens. A porta 3306 estava aberta e os processos possuíam conexões estabelecidas com o banco; entretanto, `GET /api/accounts?page=1` respondia HTTP 503.

A causa estava em `ensureAdminSchema()` no backend do painel. Essa função guarda em memória a Promise usada para criar ou verificar a tabela `admin_character_updates`. Como o painel tentou listar personagens enquanto o MySQL ainda estava parado, a Promise foi rejeitada. A rejeição permaneceu guardada na variável global e todas as requisições posteriores reutilizavam a falha antiga, mesmo depois que o banco já estava disponível.

`ensureAdminSchema()` foi transformada em uma operação recuperável:

- uma Promise concluída continua sendo reutilizada normalmente;
- uma Promise rejeitada anteriormente é descartada;
- a próxima requisição cria uma tentativa nova;
- se a tentativa nova também falhar, ela é removida do cache para permitir outra recuperação futura;
- o comportamento também limpa Promises rejeitadas preservadas durante hot reload de uma versão antiga do módulo.

Depois da alteração, a mesma API autenticada respondeu:

```text
HTTP:             200
Contas retornadas: 3
Total de contas:   3
Personagens:       3
```

As validações `npm run lint`, `npm run typecheck` e `npm run build` foram aprovadas sem erros. Os servidores do jogo não foram encerrados durante essa correção.

### Atualização dos binários QueryServer e ChatServer gerenciados

O painel ainda possuía referências fixas aos binários antigos `QueryServer.exe` e `ChatServer.exe`. Isso fazia o gerenciador ignorar os processos atuais da atividade Wagu Machine, mostrá-los como parados e iniciar as versões antigas ao usar os botões da aba `Servidores`.

O arquivo `src/lib/server-manager.ts` foi atualizado para usar:

- `QueryServer.WaguMachine.exe` no serviço exibido como `QueryServer`;
- `ChatServer.WaguMachine.exe` no serviço exibido como `ChatServer`.

Cada serviço central agora possui separadamente:

- `name`: nome amigável apresentado na interface;
- `processName`: nome real retornado pelo Windows em `Get-Process`;
- `executable`: arquivo exato permitido dentro de `ExecutionEnv`.

Essa separação é necessária porque o Windows informa os processos como `QueryServer.WaguMachine` e `ChatServer.WaguMachine`, sem a extensão `.exe`, enquanto a interface deve continuar usando os nomes simples. A descoberta de processos, a indicação ativo/parado, a validação do caminho, a inicialização, a reinicialização e o encerramento passam a trabalhar com os mesmos binários atuais.

Os dois arquivos foram confirmados em `Server/DboServer/ExecutionEnv`. Não foram alterados os GameServers selecionados nem os demais serviços centrais.

Validação desta alteração:

```text
npm run lint       aprovado, 0 erros
npm run typecheck  aprovado, 0 erros
```

O build de produção não foi executado nesta etapa porque o painel Next estava aberto em modo de desenvolvimento. Executar outro build sobre a mesma pasta `.next` poderia interferir na instância em uso. O hot reload deve aplicar a mudança; se a aba continuar mostrando os nomes antigos, basta reiniciar somente o processo do painel, sem reiniciar os servidores do jogo.
