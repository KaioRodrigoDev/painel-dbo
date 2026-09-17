# Atividade: criação de habilidades pelo painel

## Objetivo

Adicionar à aba `Skills` uma área administrativa para preparar novas habilidades usando os registros reais de `Table_Skill_Data.rdf` como base.

## Decisão de segurança

Nesta primeira fase, o painel não escreve diretamente no RDF e não reinicia cliente ou servidor. Uma habilidade depende de efeitos, textos, ícones, animações, progressão e regras usadas simultaneamente pelo cliente e pelo GameServer. Gravar apenas parte desses dados poderia gerar uma skill inválida ou causar crash.

Por isso, a criação segue o padrão seguro já utilizado pelos itens:

1. escolher uma categoria;
2. selecionar uma skill-base da mesma categoria;
3. editar somente os campos aplicáveis;
4. revisar as diferenças;
5. salvar um rascunho JSON auditável.

## Categorias mapeadas

As categorias foram obtidas de `eSKILL_CLASS`, em `DboShared/NtlShared2/NtlSkill.h`, e confirmadas nos 2.823 registros do catálogo atual:

- `0`: Passiva;
- `1`: Ativa;
- `2`: HTB.

Cada categoria possui um perfil de campos. Skills passivas não exibem campos de seleção de alvo, casting ou animações de ação. Skills ativas e HTB exibem identidade, classificação, alvos, efeitos, requisitos, tempos, progressão, animações e flags avançadas.

## Estrutura consultada

Os campos foram mapeados a partir de `sSKILL_TBLDAT`, em `DboShared/NtlGameTable/SkillTable.h`. Entre eles:

- identidade, nome interno e ícone;
- classe de personagem, categoria, tipo e grade;
- alvo, área e quantidade máxima de alvos;
- dois efeitos principais e seis bônus de RP;
- nível, SP, Zeni, LP, EP, RP e VP necessários;
- casting, cooldown, duração e alcance;
- pré-requisitos, skill raiz e próxima grade;
- animações e regras de restrição.

## Arquivos criados

- `src/lib/skill-creation-definitions.ts`: metadados, limites e perfis dos campos;
- `src/lib/skill-drafts.ts`: validação, clonagem segura e persistência atômica dos rascunhos;
- `src/components/skill-draft-creator.tsx`: formulário, busca da base, campos condicionais e comparação;
- `src/app/api/skill-drafts/route.ts`: API autenticada para consultar e salvar rascunhos;
- `data/skill-drafts/`: diretório de persistência criado no primeiro acesso à área, ainda que não existam rascunhos.

## Arquivos alterados

- `src/components/skill-catalog-panel.tsx`: botão `+ Criar habilidade` e alternância entre catálogo e criação;
- `src/lib/types.ts`: contratos `SkillDraft`, `SkillDraftValue` e `SkillDraftsResponse`;
- `src/lib/audit.ts`: evento `skills.draft_create` no histórico administrativo.

## Regras de validação

- o novo TBLIDX deve ser inteiro, único no catálogo e único entre os rascunhos;
- a skill-base deve pertencer à mesma categoria;
- a categoria não pode ser alterada dentro do formulário;
- listas de efeitos, RP e pré-requisitos exigem a quantidade exata da estrutura C++;
- campos BYTE, WORD e DWORD respeitam seus limites;
- nome interno aceita no máximo 40 caracteres e ícone, 32;
- o POST exige sessão administrativa e verificação de origem;
- cada rascunho criado gera uma entrada no log de auditoria.

## O que ainda não é publicação

O JSON não aparece automaticamente no jogo. Uma futura fase de publicação deverá atualizar de forma coordenada:

- `Table_Skill_Data.rdf` do servidor e do cliente;
- textos `SKILL_DATA` para nome e descrição;
- ícone no PAK, quando for novo;
- efeitos e animações referenciados;
- relações de skill raiz, pré-requisitos e próxima grade;
- reinicialização ou recarga segura dos processos consumidores.

## Reversão

Para remover esta atividade:

1. excluir `src/lib/skill-creation-definitions.ts`;
2. excluir `src/lib/skill-drafts.ts`;
3. excluir `src/components/skill-draft-creator.tsx`;
4. excluir `src/app/api/skill-drafts/`;
5. remover de `skill-catalog-panel.tsx` a importação, o estado `creating`, o retorno do criador e o botão;
6. remover os tipos de rascunho de skill de `src/lib/types.ts`;
7. remover `SkillAuditEntry` de `src/lib/audit.ts`;
8. opcionalmente remover `data/skill-drafts/`, preservando antes qualquer rascunho necessário.

## Validação

Validações concluídas:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- autenticação administrativa: HTTP 200;
- Dashboard: HTTP 200;
- `GET /api/skill-drafts`: HTTP 200;
- corpo inválido em `POST /api/skill-drafts`: rejeitado com HTTP 400;
- bundle da Dashboard: HTTP 200 e contendo a nova ação `Criar habilidade`;
- nenhum rascunho de teste foi gravado;
- nenhum RDF, PAK, banco do jogo, cliente ou servidor foi modificado.

## Evolução: imagem da skill-base na criação

A área de criação passou a exibir o ícone real da habilidade selecionada como base:

- um cartão abaixo dos seletores mostra imagem, nome, TBLIDX e nome do arquivo do ícone;
- a pré-visualização lateral repete o ícone em formato compacto;
- inicialmente a nova habilidade herda o mesmo `szIcon_Name` da base;
- o administrador ainda pode alterar o campo `Ícone` no grupo de identidade;
- quando o arquivo não existe no PAK, a interface apresenta o fallback `Sem ícone` sem quebrar o formulário.

A imagem é obtida pela rota autenticada já existente `/api/skills/icons/[name]`; nenhum PNG é duplicado e nenhum PAK é alterado.

Validação desta evolução:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- bundle da Dashboard: HTTP 200 e contendo o cartão `SKILL-BASE SELECIONADA`;
- ícone real `HMY_SKL_AST_014.png`: HTTP 200, `image/png`, 5.399 bytes.

## Evolução: seleção da classe e carregamento completo

A criação agora exige a escolha da classe de personagem antes da skill-base. A lista usa o `dwPC_Class_Bit_Flag` real para mostrar somente habilidades que podem ser aprendidas pela classe selecionada.

Comportamento implementado:

- seletor com as 21 classes da base, incluindo classes iniciais e especializações;
- ao trocar categoria ou classe, a seleção anterior é limpa para impedir combinações incompatíveis;
- a nova skill recebe inicialmente somente o bit da classe escolhida em `classFlag`;
- o campo avançado continua visível e pode incluir classes adicionais, mas não pode remover a classe escolhida;
- cada rascunho registra também `characterClass`;
- a lista mostra nome, TBLIDX e grade da habilidade-base;
- `/api/skills` passou a aceitar `pageSize`, limitado a 3.000 registros;
- somente a tela de criação solicita `pageSize=3000`; o catálogo normal continua com páginas de 30;
- o total de bases carregadas aparece no título do seletor.

Validação desta evolução:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- `Lutador humano` + `Ativa`: 129 registros encontrados e 129 entregues em uma única resposta;
- busca `Kamehameha` nessa combinação: 5 resultados completos;
- sequência `110211–110218`: corretamente identificada como `Místico humano`, grades 1 a 8;
- bundle da Dashboard contém o seletor `Classe do personagem` e a consulta com `pageSize`.

## Evolução: formulário relacional e linguagem amigável

Os campos que antes exibiam apenas números técnicos passaram a explicar e representar as relações reais do jogo.

Melhorias implementadas:

- `Classes permitidas` virou uma grade de checkboxes com os nomes das 21 classes;
- o valor decimal e hexadecimal da máscara continuam visíveis apenas como referência técnica;
- a classe escolhida no início permanece marcada e não pode ser removida acidentalmente;
- `1024` agora é apresentado como `Turtle Roshi`;
- `Comportamentos especiais` virou uma seleção visual dos 20 bits documentados em `eSKILL_FUNCTION`;
- o formato da área agora possui opções nomeadas: alvo único, círculo, retângulo, linha frontal, frontal flexível, anel e cone;
- `Grupo de buff/debuff` explica que grupos iguais podem substituir efeitos existentes;
- o valor `255` é identificado como sem grupo, permitindo empilhamento conforme `BuffManager.cpp`;
- `Família/grupo da skill` mostra quantas skills carregadas compartilham o valor e exemplos com grade;
- skill raiz, próxima grade e pré-requisitos tentam resolver o TBLIDX para nome e grade;
- campos de referência possuem sugestões baseadas nas skills compatíveis carregadas;
- um resumo da base mostra classes permitidas, família, grupo de buff/debuff e cadeia de progressão antes do formulário.

Os campos técnicos que ainda não possuem enumeração confiável foram mantidos com orientação explícita para preservar o valor herdado da base.

No caso validado de Turtle Roshi, `Giant Kamehameha` e `Super Kamehameha` usam `classFlag=1024`, `buffGroup=255` e `skillGroup=255`. A interface traduz esse conjunto como `Turtle Roshi`, buff sem grupo/empilhável e skill sem grupo explícito, cuja progressão é indicada por `nextSkillId`.

Validação desta evolução:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- busca `Ativa + Turtle Roshi + Kamehameha`: 7 bases compatíveis;
- bundle da Dashboard: HTTP 200;
- bundle contém os seletores de classes e comportamentos, as relações de progressão e os avisos de empilhamento;
- nenhum rascunho, RDF, PAK ou banco do jogo foi alterado durante os testes.

## Evolução: RP, custos, requisitos e campos avançados

Os blocos restantes foram convertidos para uma apresentação orientada ao significado:

- os seis efeitos de RP agora são editados em linhas de `tipo de bônus + valor`;
- tipos de RP disponíveis: knockdown, aumento de resultado, redução de EP, aumento de duração, redução de casting, redução de cooldown, quebra de guarda ou nenhum;
- nível, Zeni e SP explicam que são custos para aprender;
- LP, EP, bolas de RP e VP explicam que são custos ou condições para usar;
- valores zero são traduzidos como gratuito, sem custo ou sem exigência;
- equipamento exigido virou seletor com os 17 slots conhecidos e a opção `Nenhum`;
- tipo de item exigido usa os nomes já mapeados no catálogo de itens;
- `PC_Class_Change` virou `Mudar classe ao aprender`, com `255 = Não mudar a classe`;
- a interface alerta que selecionar outra classe nesse campo pode alterar efetivamente o personagem;
- `Use_Type` mostra quantas skills carregadas usam o valor herdado e recomenda preservá-lo;
- regras técnicas de restrição mostram decimal, hexadecimal e um aviso para não alterar bits ainda não mapeados;
- cada seção passou a ter uma descrição curta do que controla;
- o bloco avançado agora inicia visível, acompanhado do aviso de risco.

Validação desta evolução:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- a rota `/dashboard` respondeu no servidor local e redirecionou para autenticação quando consultada sem sessão, que é o comportamento esperado;
- não foi iniciada outra instância do Next durante a validação;
- nenhum rascunho de skill, RDF, PAK ou registro do banco foi alterado.

## Evolução: edição de skills existentes

Objetivo: permitir que uma skill do catálogo seja aberta no formulário e ajustada sem escrever diretamente nos arquivos do jogo.

Comportamento implementado:

- cada linha do catálogo possui a ação `Editar`;
- a janela de detalhes também possui `Editar esta skill`;
- o formulário abre preenchido com todos os valores atuais da skill escolhida;
- categoria, classe de referência, skill-base e TBLIDX ficam bloqueados durante a edição;
- os demais campos continuam organizados nos mesmos grupos usados na criação;
- a coluna lateral compara o valor original com cada valor alterado;
- não é possível salvar uma edição sem nenhuma mudança;
- o salvamento gera um JSON com `operation: edit`, sem modificar RDF, PAK, textos, banco, cliente ou servidor;
- novas versões de edição podem ser registradas como rascunhos independentes, preservando o histórico;
- os rascunhos salvos passam a indicar visualmente se são de `Criação` ou `Edição`;
- a auditoria usa `skills.draft_edit` para diferenciar a ação de `skills.draft_create`.

Para uma publicação futura, ainda será necessário criar uma etapa explícita que converta um rascunho aprovado para os arquivos de tabela e textos correspondentes. Essa etapa não faz parte desta evolução por segurança.

Cuidados adicionais:

- no modo de criação, a classe escolhida continua obrigatoriamente presente em `classFlag`;
- no modo de edição, a máscara de classes não é forçada, permitindo revisar também skills de sistema cujo `classFlag` é zero;
- o backend rejeita qualquer tentativa de trocar o TBLIDX durante uma edição;
- rascunhos antigos, sem o campo `operation`, continuam sendo apresentados como criação.

Validação desta evolução:

- `npm run lint`: aprovado;
- `npm run typecheck`: aprovado;
- dashboard autenticado: HTTP 200;
- os controles `Editar esta skill` e `Salvar edição como rascunho` foram encontrados no bundle compilado da Dashboard;
- nenhum rascunho artificial foi criado durante a validação;
- todos os processos de lint e TypeScript foram finalizados.

## Evolução: validar e publicar edições no RDF do servidor

Objetivo: transformar um rascunho de edição aprovado em uma alteração real de `Table_Skill_Data.rdf`, exigindo revisão e confirmação explícita antes da gravação.

Fluxo implementado:

1. o administrador escolhe `Validar e publicar` em um rascunho;
2. o backend relê o rascunho e o RDF atual;
3. somente os campos originalmente marcados como alterados são comparados, evitando sobrescrever mudanças externas não relacionadas;
4. uma janela mostra arquivo de destino, nome técnico, valor atual e novo valor de cada campo;
5. erros estruturais bloqueiam a publicação;
6. o administrador precisa marcar a confirmação e clicar em `Confirmar publicação no RDF`;
7. um token vinculado ao conteúdo do rascunho e ao hash do RDF impede publicar uma confirmação antiga;
8. o backend cria e verifica um backup integral;
9. a nova versão é gravada por substituição controlada, com restauração da original em caso de falha;
10. o RDF é relido e cada campo é conferido após a gravação;
11. o rascunho passa para `published` e a auditoria registra `skills.rdf_publish`, hashes, backup e campos alterados.

Proteções desta primeira versão:

- publica somente `operation: edit` para registros que já existem;
- preserva obrigatoriamente o TBLIDX;
- não publica nome ou descrição, pois esses textos pertencem a `table_text_all_data.rdf`;
- não insere novas skills no RDF;
- valida formato e tamanho fixo do arquivo, unicidade do TBLIDX, tipos, limites e consistência básica de área;
- cooldown e duração editados devem representar segundos inteiros, mantendo sincronizados os campos legado e em milissegundos da estrutura;
- alcances editados devem ser inteiros entre 0 e 255, mantendo sincronizados os campos BYTE e float;
- somente uma publicação pode ocorrer por vez no processo do painel.

Backups são armazenados em `data/skill-rdf-backups/` e o caminho fica registrado no próprio rascunho publicado e na auditoria.

Limite conhecido: esta etapa altera exclusivamente o RDF do servidor. O `tbl.pak` do cliente permanece inalterado, portanto o GameServer precisa ser reiniciado e o cliente ainda pode exibir ou enviar dados antigos até implementarmos a publicação do pacote de tabelas.
