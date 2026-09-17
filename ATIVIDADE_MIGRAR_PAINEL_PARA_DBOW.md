# Atividade: migrar o painel administrativo para a base dbow

## Objetivo

Mover o painel administrativo que estava em `OpenDBO/OpenDBO/opendbo-admin-staging` para a raiz da base atualmente utilizada em `C:\Users\Kaio\Documents\developer\dbow`, sem transportar dependências instaladas nem caches de build.

O destino adotado é:

```text
C:\Users\Kaio\Documents\developer\dbow\opendbo-admin-staging
```

## Diagnóstico antes da migração

A base `dbow` mantém os diretórios `DboClient`, `DboServer`, `DboShared` e `NtlLib` diretamente em sua raiz. Isso difere da base anterior, na qual o painel precisava atravessar o diretório intermediário `Server`.

Foram confirmados os seguintes pontos de compatibilidade:

- `Table_Item_Data.rdf` possui registros de 372 bytes, o mesmo formato esperado pelo catálogo do painel;
- `table_text_all_data.rdf` está presente para os nomes localizados;
- os pacotes `tex.pak` e `texN.pak` estão em `ClientRuntime_RealBase/pack`;
- a configuração de banco existente em `.env.local` coincide com as duas seções do `QueryServer.ini` da base `dbow`;
- os GameServers disponíveis são descobertos por `GameServer.ini`, `GameServer1.ini` e `GameServer9.ini`.

Também foram encontradas diferenças que exigiam adaptação:

- os binários desta base se chamam `QueryServer.exe` e `ChatServer.exe`, sem o sufixo experimental `WaguMachine`;
- `ChatServer.exe` deve receber `config/ChatServer.ini` ao iniciar;
- o importador deve aceitar a chave `Db`, usada pelos INIs da base, além da chave antiga `DbName`;
- o QueryServer desta base não possui o consumidor da tabela `admin_character_updates` nem a rotina personalizada de expulsão e invalidação de cache.
- o cliente `dbow` usa uma chave diferente para descriptografar o índice `tex.pak`;

## Mudanças realizadas

### Arquivos gerados e dependências

Antes da movimentação foram verificados o caminho absoluto de origem, o destino e a ausência de processos Node ativos. Somente estes artefatos gerados foram removidos:

```text
node_modules/
.next/
tsconfig.tsbuildinfo, quando existente
```

Em seguida, o restante do projeto foi movido integralmente para o destino. As dependências serão instaladas novamente a partir de `package-lock.json`, evitando carregar binários ou caminhos internos da instalação anterior.

### Caminhos da base dbow

Os padrões internos passaram a apontar para:

```text
../DboServer/ExecutionEnv
../DboServer/ExecutionEnv/resource/server_data/table/rdf
../ClientRuntime_RealBase/pack
```

As variáveis opcionais `OPENDBO_EXECUTION_ENV`, `ITEM_TABLE_PATH`, `ITEM_TEXT_TABLE_PATH` e `ITEM_ICON_PACK_DIRECTORY` continuam podendo substituir esses padrões.

A chave de pacote usada pelo cliente `dbow` foi identificada no próprio executável e aplicada ao leitor de ícones. Sem esse ajuste, a tabela de itens carregava, mas o índice criptografado produzia zero correspondências e todas as imagens respondiam como ausentes.

### Gerenciador de servidores

O gerenciador agora controla os binários reais da base `dbow`:

```text
MasterServer.exe
QueryServer.exe
AuthServer.exe
CharServer.exe config/CharServer.ini
ChatServer.exe config/ChatServer.ini
GameServer.exe config/GameServer*.ini
```

Backups e executáveis com nomes diferentes continuam fora da lista permitida.

`GameServer.ini` e `GameServer1.ini` possuem atualmente o mesmo canal 0 e a mesma porta 30000. Ambos aparecem para inspeção, mas o backend mantém somente um deles selecionado e rejeita qualquer tentativa de salvar os dois simultaneamente. Isso permite escolher qual variante usar sem iniciar configurações conflitantes.

### Edição segura de personagens

A fila administrativa anterior não foi mantida como se estivesse funcional, porque o `QueryServer.exe` da base `dbow` não a consome. Isso deixaria solicitações permanentemente pendentes.

Nesta migração, o painel aplica nível, experiência, pontos de habilidade e zeni diretamente apenas quando `IsOnline = 0`. O registro é bloqueado por transação durante a verificação e a gravação. Se o personagem estiver online, a API retorna conflito e a interface pede que ele seja desconectado antes da edição. Assim, o GameServer não pode sobrescrever a alteração com seu cache durante um logout posterior.

Uma futura restauração da edição de personagens online deve ser tratada como integração separada no QueryServer desta base.

## Como desfazer esta atividade

Com o painel e os servidores parados:

1. remover `node_modules` e `.next` do painel na base `dbow`;
2. mover `dbow/opendbo-admin-staging` de volta para `OpenDBO/OpenDBO/opendbo-admin-staging`;
3. restaurar em `server-manager.ts`, `item-catalog.ts` e `item-icons.ts` os caminhos e binários documentados na atividade antiga;
4. restaurar `db.ts`, a rota de personagem e os textos da interface se a base anterior com consumidor da fila voltar a ser usada;
5. executar `npm install` e um novo build no local restaurado.

## Validação

As dependências foram reinstaladas no destino com `npm install`. A instalação confirmou Next.js 16.3.1 e não reutilizou o `node_modules` da pasta anterior.

Foram aprovadas as seguintes verificações:

```text
npm run lint       aprovado, 0 erros
npm run typecheck  aprovado, 0 erros
npm run build      aprovado, 14 rotas reconhecidas
```

Um build de produção foi iniciado temporariamente apenas em `127.0.0.1:3100`. Depois de autenticar com a configuração preservada em `.env.local`, testes somente de leitura confirmaram:

```text
login                         HTTP 200
serviços descobertos         8 (5 centrais e 3 GameServers)
configuração selecionada    GameServer.ini
itens lidos                   16.310
ícone extraído do tex.pak    HTTP 200, image/png
listagem de contas            HTTP 200
```

Nenhum servidor do jogo foi iniciado ou encerrado durante a validação. A instância temporária do Next.js foi finalizada ao terminar os testes e não deve permanecer consumindo CPU.

## Estado final

O painel deve ser iniciado a partir de:

```text
C:\Users\Kaio\Documents\developer\dbow\opendbo-admin-staging
```

Em desenvolvimento:

```powershell
npm run dev
```

Em produção, usando o build já gerado:

```powershell
npm run start
```
