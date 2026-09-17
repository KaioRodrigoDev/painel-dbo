# Atividade: criacao de itens pelo painel

## Objetivo

Estudar e preparar uma ferramenta administrativa para criar novos itens do catalogo OpenDBO. O administrador escolhera primeiro o tipo do item e o painel exibira apenas os campos aplicaveis aquela categoria.

Exemplo esperado:

`Luva -> nivel, rank, ataque fisico, ataque de energia, velocidade de ataque, alcance, modelo, requisitos, opcoes e dados de upgrade.`

## Estado atual

Esta atividade esta na fase de **estudo e definicao do formulario**. Nenhuma escrita em RDF ou pacote do cliente foi habilitada. A decisao e intencional: um registro binario incompleto pode impedir cliente ou servidor de carregar toda a tabela.

## Fontes analisadas

- `Server/DboShared/NtlShared2/NtlItem.h`: tipos, ranks, equipamentos e slots.
- `Server/DboShared/NtlGameTable/ItemTable.h`: estrutura completa `sITEM_TBLDAT`.
- `Server/DboShared/NtlGameTable/ItemTable.cpp`: nomes dos campos, valores padrao e carregamento.
- `Table_Item_Data.rdf` do `ExecutionEnv`: 14.726 registros usados para identificar os padroes reais.
- `table_text_all_data.rdf`: nomes e descricoes separados do registro do item.
- `tex.pak` e `tex*.pak`: indice e conteudo dos icones.

## Resultado do estudo dos tipos

### Armas - tipos 0 a 17

Campos principais:

- TBLIDX, nome, descricao, icone e modelo;
- rank, nivel minimo/maximo, classe, raca e genero;
- ataque fisico e ataque de energia;
- velocidade e bonus de alcance;
- durabilidade e atributo de batalha;
- slot, tipo de equipamento e modelo da subarma;
- opcoes, set, encantamento, ranks geraveis e desmontagem.

Nos registros existentes, 100% das armas validas analisadas possuem os dois ataques e velocidade. Luvas/cajados usam o slot da mao; as subarmas observadas usam o slot de subarma.

### Armaduras - jaqueta, calca e botas

Campos principais:

- todos os campos comuns e visuais;
- defesa fisica e defesa de energia;
- durabilidade, atributo, requisitos e restricoes;
- opcoes, set, encantamento, ranks e desmontagem.

Os 5.802 registros validos observados possuem as duas defesas. O slot e fixado pela categoria: jaqueta `4`, calca `8`, botas `16`.

### Acessorios - colar, brinco e anel

Campos principais:

- dados comuns, rank e requisitos;
- slots permitidos;
- opcao fixa e tabelas de opcoes por rank.

Os acessorios existentes nao usam as defesas basicas. Seus efeitos dependem principalmente de `Item_Option_Tblidx` e das tabelas de opcoes. Colar usa flag `128`, brincos `768` e aneis `3072`.

### Scouter e pecas

O scouter usa modelo, durabilidade, slot `32`, capacidade, watt, poder maximo e tipos de pecas. Pecas de scouter dependem fortemente das opcoes. Foi encontrado ainda o tipo customizado `106`, fora do enum original, com 58 registros.

### Costumes

Campos principais:

- icone, modelo e tipo de modelo;
- slot visual;
- classe/raca/genero;
- partes do equipamento ocultadas pelo costume;
- duracao e restricoes, quando aplicavel.

Slots observados:

- conjunto/Dogi: `4096`;
- cabelo: `8192`;
- mascara: `16384`;
- acessorio de cabelo: `32768`;
- acessorio das costas: `65536`.

### Bolsas e armazenamento

Usam `byBag_Size`. Os tamanhos reconhecidos pelo codigo sao 4, 8, 12, 16, 20, 24, 28 e 32. O formulario nao devera aceitar outros valores.

### Consumiveis

Incluem recuperacao, comida, utilidade, capsulas, caixas, cupons e varios itens especiais. O campo decisivo e `Use_Item_Tblidx`: ele referencia o comportamento em `Table_Use_Item_Data`. Criar apenas o item nao cria um efeito novo.

Tambem podem usar duracao, item necessario, conteudo associado, pontos/moeda especial e restricoes.

### Materiais

Normalmente sao empilhaveis e nao possuem modelo, equipamento ou comportamento de uso. O formulario priorizara pilha, rank, economia, requisitos e desmontagem.

### Receitas

Alem do registro em `Table_Item_Data`, precisam de uma entrada coerente em `Table_Item_Recipe_Data`. Por isso nao podem ser publicadas como item isolado.

### Tipos especializados e customizados

Foram observados valores `88`, `96`, `99` e `106` que nao seguem integralmente o enum original. Eles ficarao em modo **clonar somente** ate localizarmos todas as alteracoes de codigo/tabelas que os introduziram.

## Definicao criada para o painel

Foi criado `src/lib/item-creation-definitions.ts` contendo:

- metadados dos campos e o nome exato correspondente em `sITEM_TBLDAT`;
- limites numericos de acordo com BYTE, WORD, DWORD e TBLIDX;
- grupos visuais do formulario;
- perfis para arma, armadura, acessorio, scouter, costume, bolsa, consumivel, material, receita e item especializado;
- lista dos tipos oficiais e tipos customizados encontrados;
- slots/equip types padrao quando o catalogo mostrou uma regra confiavel;
- funcoes que retornam os campos aplicaveis depois que o tipo e selecionado.

Essa definicao ainda nao e uma tela. Ela sera a fonte unica para o formulario dinamico, evitando condicionais espalhadas pelo React.

## Padrao de criacao recomendado

Todo item novo deve comecar pela escolha de:

1. categoria/tipo;
2. item-base do mesmo tipo;
3. novo TBLIDX;
4. campos que realmente serao alterados.

Mesmo quando todos os campos aparecerem no formulario, o backend deve clonar um registro existente compatível e aplicar as alteracoes validadas. Criar 372 bytes a partir de zeros e arriscado por causa dos valores sentinela `0xFF` e `0xFFFFFFFF`, flags e referencias internas.

## Arquitetura proposta

```text
Formulario por categoria
  -> rascunho JSON versionado
  -> validacao de campos e referencias
  -> pre-visualizacao das diferencas
  -> backup dos RDF/PAK afetados
  -> exportador compativel com sITEM_TBLDAT
  -> atualizacao dos textos
  -> inclusao do icone, quando novo
  -> publicacao coordenada no cliente e servidor
```

## Regras obrigatorias antes de permitir publicacao

- TBLIDX unico e dentro do intervalo aceito.
- Item-base do mesmo perfil.
- Nome e descricao recebem IDs de texto unicos.
- Icone existente ou PNG novo validado.
- Referencias existem nas tabelas correspondentes.
- Rank entre 0 e 5.
- Pilha entre 1 e 255.
- Slots e equip type coerentes com a categoria.
- Campos BYTE/WORD/DWORD nao ultrapassam seus limites.
- Arquivos do cliente e servidor gerados juntos.
- Backup e manifesto de rollback antes de substituir qualquer arquivo.
- Publicacao bloqueada enquanto cliente/servidores estiverem usando as tabelas.

## Fases sugeridas

### Fase 1 - concluida nesta etapa

- mapear campos por categoria;
- registrar tipos e defaults observados;
- criar a definicao reutilizavel do formulario;
- documentar riscos e arquitetura.

### Fase 2 - formulario de rascunho

- [Concluido] adicionar a tela **Criar item**;
- [Concluido] selecionar categoria e item-base;
- [Concluido] renderizar campos por perfil;
- [Concluido] salvar somente JSON em `data/item-drafts`;
- [Concluido] validar e comparar com o item-base;
- [Concluido] continuar sem modificar o jogo.

### Fase 3 - exportador controlado

- definir estrategia de escrita do RDF;
- gerar tabela de textos;
- suportar icones existentes primeiro;
- produzir arquivos em uma pasta de staging;
- validar os arquivos gerados carregando-os novamente.

### Fase 4 - publicacao

- backup automatico;
- confirmacao administrativa explicita;
- atualizar cliente e servidor;
- reiniciar apenas os processos necessarios;
- teste e rollback automatizado.

## Primeiro item recomendado

O primeiro teste deve ser uma **Luva clonada de outra luva**, usando icone e modelo existentes. Alterar apenas:

- TBLIDX;
- nome e descricao;
- nivel;
- rank;
- ataque fisico;
- ataque de energia;
- velocidade de ataque;
- preco.

Isso exercita o formulario solicitado sem introduzir comportamento, modelo, textura ou tabelas adicionais.

## Como reverter esta etapa

Remover:

- `ATIVIDADE_CRIACAO_ITENS_PELO_PAINEL.md`;
- `src/lib/item-creation-definitions.ts`.

Nenhum arquivo do jogo, RDF, PAK ou banco foi alterado nesta etapa.

## Validacao da fase 1

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- O processo de lint foi aguardado ate o encerramento; nenhuma ferramenta de validacao desta atividade permanece executando.

## Implementacao da fase 2

### Interface

- Adicionado **+ Criar item** na aba de catalogo.
- A tela exige primeiro a categoria e depois um item-base do mesmo tipo.
- Categorias sem nenhum registro observado ficam visiveis, mas desabilitadas, pois nao existe uma base segura para clonar.
- A busca de item-base aceita nome ou TBLIDX e usa o catalogo autenticado existente.
- Os campos sao gerados por `item-creation-definitions.ts` e agrupados em identidade, inventario, economia, visual, equipamento, combate, requisitos, opcoes, comportamento e avancado.
- Rank e tamanho de bolsa possuem selecoes controladas.
- Flags, referencias e valores compostos exibem o campo original de `sITEM_TBLDAT` para facilitar o estudo.
- Campos alterados recebem destaque e aparecem em uma comparacao lateral antes do salvamento.
- A tela lista todos os rascunhos ja salvos e deixa claro que nenhum foi publicado.

### Dados adicionais do catalogo

O leitor de `Table_Item_Data.rdf` foi ampliado para expor os demais campos necessarios ao clone, incluindo:

- descricao/Note;
- tipo de modelo e flags de funcao;
- requisitos STR, CON, FOC, DEX, SOL e ENG;
- set, opcoes, encantamento e tabelas por rank;
- dados de scouter;
- comportamento de uso e duracao;
- conteudo, restricoes, revisoes e desmontagem.

Os offsets continuam seguindo exatamente o registro de 372 bytes de `sITEM_TBLDAT`.

### API e armazenamento

- Criada `GET /api/item-drafts` para listar rascunhos.
- Criada `POST /api/item-drafts` para validar e salvar.
- Mutacoes exigem sessao administrativa e mesma origem.
- O backend repete todas as validacoes; nao confia nos campos enviados pelo navegador.
- O item-base deve existir e possuir o mesmo `Item_Type`.
- O novo TBLIDX nao pode existir no catalogo nem em outro rascunho.
- Campos fora do perfil selecionado sao recusados.
- Limites numericos, tipos, tamanhos de texto e campos obrigatorios sao conferidos.
- O JSON e escrito primeiro como temporario e renomeado ao final, evitando rascunho parcialmente gravado.
- A criacao entra em `admin-audit.jsonl` como `items.draft_create`.
- `data/item-drafts/` foi adicionado ao `.gitignore` porque contem dados administrativos locais.

### Arquivos criados na fase 2

- `src/components/item-draft-creator.tsx`
- `src/lib/item-drafts.ts`
- `src/app/api/item-drafts/route.ts`

### Arquivos atualizados na fase 2

- `.gitignore`
- `src/app/globals.css`
- `src/components/item-catalog-panel.tsx`
- `src/lib/audit.ts`
- `src/lib/item-catalog.ts`
- `src/lib/item-creation-definitions.ts`
- `src/lib/types.ts`

### Estado de seguranca

O botao atual e **Salvar rascunho JSON**, nao publicar. A fase 2 nao possui codigo para escrever RDF, alterar `tex.pak`, substituir arquivos do cliente/servidor ou reiniciar processos.

### Validacao da fase 2

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- `npm run build`: aprovado.
- A rota dinamica `/api/item-drafts` foi incluida no build de producao.
- O processo de build foi aguardado ate o encerramento.

## Correcao posterior - nomes dos tipos no catalogo

### Problema

A listagem antiga do catalogo possuia um mapa local de nomes somente ate o tipo 44. Por isso itens dos tipos 47 em diante apareciam apenas como `Tipo 47`, `Tipo 48` e assim por diante, embora o criador ja conhecesse esses tipos.

### Correcao

- Removido o mapa duplicado e incompleto de `item-catalog-panel.tsx`.
- A listagem e os filtros agora usam `getItemCreationDefinition`, a mesma fonte completa usada pelo criador.
- Tipos oficiais e customizados conhecidos passam a ter o mesmo nome nas duas telas.
- Um valor realmente desconhecido sera exibido explicitamente como `Tipo nao mapeado N`.

### Reversao da fase 2

1. Remover os tres arquivos criados nesta fase.
2. Retirar o botao/import de `ItemDraftCreator` em `item-catalog-panel.tsx`.
3. Retirar os estilos iniciados por `.itemDraftCreator` em `globals.css`.
4. Retirar os campos adicionais de `ItemCatalogEntry` e os respectivos offsets de `item-catalog.ts`.
5. Retirar `getItemCreationBaseValues` de `item-creation-definitions.ts`.
6. Retirar o tipo de auditoria `items.draft_create`.
7. Retirar `/data/item-drafts/` do `.gitignore`.
8. Rascunhos eventualmente criados podem ser preservados como referencia ou removidos manualmente de `data/item-drafts`.
