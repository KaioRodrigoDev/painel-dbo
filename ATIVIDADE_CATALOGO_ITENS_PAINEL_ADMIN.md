# Atividade: catalogo de itens no painel administrativo

## Objetivo

Criar uma aba **Itens** no painel administrativo para consultar o catalogo carregado pelo servidor OpenDBO, sem alterar itens e sem inserir objetos em personagens.

## Escopo desta atividade

- Ler o arquivo `Table_Item_Data.rdf` usado pelo servidor.
- Expor uma API autenticada e somente leitura.
- Listar os itens com busca, filtros e paginacao.
- Exibir os principais dados tecnicos e um painel de detalhes.
- Manter a origem do arquivo configuravel para que o painel possa ser movido futuramente.

Ficam fora desta etapa:

- editar o catalogo;
- entregar itens a jogadores;
- alterar inventario, banco ou Cash Shop Storage;
- extrair ou renderizar as texturas dos icones do cliente.

## Analise do formato

O catalogo de referencia do servidor fica em:

`Server/DboServer/ExecutionEnv/resource/server_data/table/rdf/Table_Item_Data.rdf`

O formato foi conferido em `sITEM_TBLDAT`, declarado em `Server/DboShared/NtlGameTable/ItemTable.h`, e no carregamento feito por `CItemTable::LoadFromBinary`, em `ItemTable.cpp`.

Resultados da verificacao:

- o primeiro byte do arquivo e a margem/versao gravada pelo serializador;
- depois dele existem registros binarios de tamanho fixo;
- cada registro possui 372 bytes neste codigo-fonte, respeitando `#pragma pack(push, 4)`;
- o arquivo atual possui 14.726 registros;
- o nome curto esta embutido como UTF-16LE no registro;
- o parser deve recusar arquivos cujo tamanho nao seja compativel com essa estrutura.

Essa validacao e importante porque interpretar um RDF de outra versao com offsets incorretos produziria informacoes falsas no painel.

## Decisao tecnica

A leitura sera feita apenas no backend do Next.js. O navegador acessara uma rota autenticada e nunca recebera o caminho local do servidor. O resultado sera mantido em cache de memoria e recarregado quando a data ou o tamanho do RDF mudar.

O caminho pode ser definido com `ITEM_TABLE_PATH`. Sem essa variavel, o painel procura o arquivo no caminho padrao do repositorio atual.

## Historico de implementacao

### Etapa 1 - investigacao

- Localizado o catalogo RDF usado pelo Server.
- Comparada a serializacao com `sITEM_TBLDAT`.
- Confirmado o tamanho de 372 bytes por registro e os offsets dos campos expostos.

### Proximas etapas

- implementar o leitor e a API;
- criar a aba visual de itens;
- executar lint, verificacao de tipos e build;
- registrar aqui o resultado final e como reverter.

### Etapa 2 - backend do catalogo

- Criado `src/lib/item-catalog.ts`, um leitor exclusivo do servidor Next.js.
- O leitor valida o cabecalho e exige que todos os registros possuam 372 bytes.
- Os campos sao lidos nos mesmos offsets da estrutura C++ com alinhamento de 4 bytes.
- O resultado fica em cache de memoria e e reconstruido quando tamanho ou data do RDF mudam.
- Adicionado `ITEM_TABLE_PATH` opcional ao `.env.example`; nenhum caminho local e aceito pela URL.
- Criada `GET /api/items`, protegida pela mesma autorizacao do restante do painel.
- A rota oferece busca, filtro por tipo/rank e paginacao de 30 itens.

### Etapa 3 - interface

- Adicionada a opcao **Itens** na navegacao principal.
- Criado `src/components/item-catalog-panel.tsx`.
- A lista mostra TBLIDX, nome embutido, arquivo de icone, tipo, rank, nivel e precos.
- O botao **Detalhes** mostra modelos, slots, ataque, defesa, restricoes e flags tecnicas.
- O placeholder `IMG` e intencional: o RDF informa o nome do arquivo, mas as texturas do cliente nao sao servidas pelo painel nesta etapa.
- Adicionados estilos responsivos em `src/app/globals.css`.

### Etapa 4 - validacao

- O parser foi conferido diretamente contra registros do inicio, meio e fim do RDF atual.
- Confirmados 14.726 registros e valores coerentes para TBLIDX, nome, tipo, rank e preco.
- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- `npm run build`: aprovado com a rota dinamica `/api/items` incluida.
- As leituras externas receberam `turbopackIgnore` para impedir que o Next.js copie/rastreie todo o repositorio durante o build.
- Todos os processos de lint e build iniciados nesta atividade foram aguardados ate o encerramento.

## Arquivos alterados

- `.env.example`
- `src/app/api/items/route.ts`
- `src/app/globals.css`
- `src/components/admin-dashboard.tsx`
- `src/components/item-catalog-panel.tsx`
- `src/lib/item-catalog.ts`
- `src/lib/types.ts`
- `ATIVIDADE_CATALOGO_ITENS_PAINEL_ADMIN.md`

## Como testar

1. Reiniciar o processo de desenvolvimento do painel, caso ele ja estivesse aberto antes da mudanca.
2. Entrar normalmente no painel.
3. Abrir a aba **Itens**.
4. Confirmar que a lista apresenta os itens do RDF.
5. Testar uma busca por TBLIDX e outra por nome.
6. Testar os filtros de tipo/rank e abrir **Detalhes**.

Se o painel estiver em outra pasta ou maquina, definir `ITEM_TABLE_PATH` com o caminho absoluto do `Table_Item_Data.rdf` acessivel ao backend.

## Como reverter esta atividade

1. Remover `src/app/api/items/route.ts`.
2. Remover `src/components/item-catalog-panel.tsx`.
3. Remover `src/lib/item-catalog.ts`.
4. Retirar os tipos `ItemCatalogEntry` e `ItemCatalogResponse` de `src/lib/types.ts`.
5. Retirar o import, a opcao de navegacao e as renderizacoes de itens de `admin-dashboard.tsx`.
6. Retirar os estilos iniciados por `.itemCatalogPanel` de `globals.css`.
7. Retirar o exemplo de `ITEM_TABLE_PATH` de `.env.example`.

## Estado final

Atividade concluida. O catalogo esta disponivel no painel em modo somente leitura. Edicao e entrega de itens continuam deliberadamente fora do escopo.

## Ajuste posterior - nomes localizados e imagens

### Problema observado

Na primeira versao, a lista usava `wszNameText`, que e o nome tecnico coreano embutido em `Table_Item_Data.rdf`. O campo de icone mostrava apenas o nome do arquivo porque as imagens nao existem soltas: elas estao armazenadas nos pacotes `tex*.pak` do cliente.

### Correcao dos nomes

- Adicionada a leitura de `table_text_all_data.rdf`.
- A secao `ITEM_DATA` dessa tabela associa o campo `Name` do item ao texto apresentado pelo cliente.
- Os textos disponiveis neste repositorio estao em ingles. Nao foi encontrada uma tabela portuguesa, portanto o painel agora usa ingles em vez do nome tecnico coreano.
- O nome coreano foi preservado apenas no modal como **Nome interno**, para diagnostico.
- O caminho da tabela pode ser alterado por `ITEM_TEXT_TABLE_PATH`.

### Correcao dos icones

- Criado `src/lib/item-icons.ts` para ler o indice criptografado `tex.pak`.
- A chave e o algoritmo usados sao os mesmos declarados pelo cliente em `NtlPLResourcePack.h` e `NtlPLResourcePack.cpp`.
- A API busca apenas arquivos de `texture/gui/icon`, valida nome, offset e tamanho, e le somente os bytes do icone solicitado.
- Criada a rota autenticada `GET /api/items/icons/[name]`.
- Os PNG/BMP sao enviados diretamente ao navegador e mantidos em cache privado por uma hora.
- DDS nao e suportado nativamente pelos navegadores e permanece com placeholder. Os itens verificados utilizam PNG.
- O caminho dos pacotes pode ser alterado por `ITEM_ICON_PACK_DIRECTORY`.

### Arquivos adicionais desta correcao

- `src/app/api/items/icons/[name]/route.ts`
- `src/lib/item-icons.ts`

### Reversao deste ajuste

Para voltar ao comportamento anterior, remover os dois arquivos acima, retirar a leitura de `table_text_all_data.rdf` de `item-catalog.ts`, remover `internalName`/`textSourceFile` dos tipos e restaurar o placeholder no componente do catalogo.

### Validacao deste ajuste

- Confirmada a descriptografia do indice `tex.pak`: 28.424 entradas completas, mais o preenchimento final do bloco criptografado.
- Confirmado que `DUM_Armor.png` aponta para `tex19.pak`, offset `11714857`, e possui assinatura PNG valida.
- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- `npm run build`: aprovado, incluindo `/api/items/icons/[name]`.
- Todos os processos iniciados para a validacao terminaram normalmente.
