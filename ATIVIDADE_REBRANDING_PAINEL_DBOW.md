# Atividade: rebranding do painel para DBOW

## Objetivo

Substituir a marca antiga OpenDBO no painel administrativo pela identidade atual **DBOW / Dbo World**, incluindo textos visíveis e identificadores técnicos mantidos pelo próprio painel.

## Escopo aplicado

- textos da navegação, login, títulos, carregamento, confirmações e erros passaram a usar `Dbo World`;
- o pacote NPM passou de `opendbo-admin` para `dbow-admin`;
- o cookie de sessão passou a se chamar `dbow_admin_session`;
- variáveis globais internas dos pools MySQL passaram do prefixo `__openDbo` para `__dbow`;
- a configuração `OPENDBO_EXECUTION_ENV` foi renomeada para `DBOW_EXECUTION_ENV`;
- a variável interna usada para ocultar janelas passou para `DBOW_MANAGER_PID`;
- o namespace PowerShell interno passou de `OpenDbo` para `DboWorld`;
- o importador foi renomeado de `import-opendbo-config.mjs` para `import-dbow-config.mjs`;
- `package.json`, `.env.example` e `README.md` foram atualizados para refletir os novos nomes.

## Decisões

Foi utilizado **Dbo World** nos textos apresentados a pessoas e **DBOW/dbow** em nomes técnicos. Documentos históricos que descrevem a origem e a migração da antiga base não foram reescritos, pois seus caminhos e nomes antigos são registros factuais úteis para reversão e manutenção.

## Impacto operacional

A troca do nome do cookie invalida apenas a sessão administrativa anterior. Depois de reiniciar o painel, será necessário fazer login novamente. Nenhum banco, personagem ou servidor do jogo é alterado por esta atividade.

## Validação

- busca no código ativo, configurações, README e metadados: nenhuma referência restante à marca antiga;
- `npm run lint`: concluído sem erros;
- `npm run typecheck`: concluído sem erros;
- `npm run build`: build de produção concluído e todas as rotas reconhecidas;
- nenhuma ferramenta de build permaneceu em execução.

O diretório físico `opendbo-admin-staging` não foi renomeado nesta atividade para não invalidar atalhos, terminais e caminhos locais já configurados. Esse nome não é apresentado pela interface nem utilizado como marca em tempo de execução.

## Como reverter

Use este documento como inventário dos nomes modificados e restaure os arquivos pelo controle de versão. Caso seja necessário manter uma configuração externa antiga, renomeie `DBOW_EXECUTION_ENV` de volta para `OPENDBO_EXECUTION_ENV` tanto no ambiente quanto em `src/lib/server-manager.ts`.
