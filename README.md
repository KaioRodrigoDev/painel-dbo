# Dbo World Admin

Para instalar no Windows Server e publicar por Cloudflare Tunnel, siga
`DEPLOY_WINDOWS_CLOUDFLARE.md`. O guia inclui um perfil inicial somente para
dashboard, contas, personagens, VIP e entregas pelo Cash Shop. O catálogo usado
nessas entregas lê as tabelas RDF de itens e produtos HLS do servidor.

Painel administrativo local para consultar contas do Dbo World e editar dados seguros de personagens offline.

## Requisitos

- Node.js 20 ou superior
- npm
- MySQL do Dbo World acessível
- Bancos `dbo_acc` e `dbo_char` importados

## Configuração automática

Com o repositório DBOW na pasta irmã padrão, execute:

```powershell
npm run setup
```

O comando lê somente as seções `DATABASE_ACCOUNT` e `DATABASE_CHARACTER` de `QueryServer.ini`, gera uma senha administrativa aleatória e cria `.env.local`. O arquivo é ignorado pelo Git.

Para indicar outro arquivo:

```powershell
node scripts/import-dbow-config.mjs "C:\caminho\QueryServer.ini"
```

## Executar

Antes da primeira execução desta versão, com o MySQL do Dbo World ligado, prepare a gestão VIP:

```powershell
npm run vip:migrate
npm run vip:dry-run
```

O primeiro comando adiciona `accounts.vip_expires_at`, o índice de vencimentos e as tabelas de auditoria e execução. Ele preserva os níveis VIP existentes. Contas VIP antigas sem uma data continuam ativas e aparecem na dashboard para regularização.

No Windows, instale a expiração diária às 00h05 no Agendador de Tarefas:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-vip-task.ps1
```

O instalador exige o fuso **E. South America Standard Time**, evita criar uma segunda tarefa com o mesmo nome e configura a execução atrasada após o computador voltar a ligar. A tarefa usa a conta atual e roda quando ela estiver conectada ao Windows, sem depender do navegador. Confira `DboWorld-Admin-Vip-Expiry` no Agendador e execute-a uma vez manualmente para validar as credenciais e o acesso ao banco.

```powershell
npm run dev
```

Abra `http://localhost:3000`. As credenciais ficam em `.env.local`.

Para produção local:

```powershell
npm run build
npm start
```

Se usar HTTPS, altere `ADMIN_COOKIE_SECURE=true`.

## Funcionalidades do MVP

- Login administrativo com sessão assinada e cookie HttpOnly.
- Limite de tentativas de login.
- Busca de contas por usuário ou ID.
- Listagem dos personagens de cada conta.
- Exibição de nível, experiência, SP, zeni, raça, classe e gênero.
- Solicitação coordenada de nível, experiência, SP e zeni.
- Personagens online são enviados de forma controlada para a seleção.
- Os valores novos são aplicados somente após o salvamento de saída.
- Invalidação individual do cache do personagem no QueryServer.
- Estado pendente visível enquanto o servidor processa a solicitação.
- Registro das alterações em `data/admin-audit.jsonl`.
- Dashboard inicial com totais de contas, personagens, jogadores online e VIPs.
- Gestão dos níveis VIP 0 a 3, validade, filtros e próximos vencimentos.
- Renovação antecipada por 15, 30 ou 60 dias, preservando o prazo restante, ou por data personalizada.
- Auditoria transacional e proteção contra renovação duplicada após reenvio da mesma operação.
- Expiração diária independente do painel aberto.
- Envio de itens para qualquer conta filtrada na lista de jogadores, por Cash Shop ou correio.
- Lotes VIP por nível: Cash Shop para a conta ou correio de um personagem escolhido por conta. A escolha do personagem fica salva para o próximo lote.
- Pacotes reutilizáveis de até 20 itens para correio individual ou VIP em grupo. Os pacotes ficam em `data/mail-packages/*.json` no servidor e não entram no Git; inclua essa pasta no backup do painel.

O Cash Shop usa `admin_cashshop_items` em `dbo_acc` e aceita itens com entrada na tabela do Cash Shop. O correio usa `admin_mail_items` em `dbo_char` e aceita itens válidos do catálogo. Por padrão, o item chega com aparência normal; a opção "Enviar selado" faz o item virar ovo no inventário até o jogador retirar o selo. O QueryServer processa ambas as filas. Depois de instalar a versão nova do painel e do QueryServer, prepare e confira as tabelas com:

```powershell
npm run mail:migrate
npm run mail:inspect
```

Cada item de um pacote gera uma mensagem de correio separada. As definições dos pacotes existem apenas nos arquivos do servidor; `admin_mail_package_dispatches` guarda somente o controle dos envios para evitar duplicação ao reenviar a mesma solicitação.

## Limites de segurança

Raça, classe, gênero e estado adulto são somente leitura neste MVP. Essas propriedades afetam habilidades, equipamentos, aparência e progressão; serão editáveis somente depois de uma integração específica com as regras do GameServer.

O painel depende das versões modificadas de `QueryServer.exe` e `GameServer.exe`. Não use a edição administrativa com executáveis antigos: eles não processam a fila `admin_character_updates`.

O painel não retorna senhas, hashes ou endereços IP para o navegador. Não exponha o servidor Next.js diretamente à internet sem HTTPS, firewall e uma solução de autenticação adequada ao ambiente de produção.

## Validação

```powershell
npm run lint
npm run typecheck
npm run build
npm run vip:test
```

O lint completo ainda inclui scripts auxiliares antigos do projeto. Para conferir apenas a gestão VIP, execute:

```powershell
npx eslint src/components/vip-panel.tsx src/components/admin-dashboard.tsx src/lib/vip-rules.ts src/lib/vip-store.ts src/lib/db.ts src/app/api/accounts/route.ts src/app/api/accounts/[id]/vip/route.ts src/app/api/dashboard/route.ts
```

Consulte `ATIVIDADE_MIGRAR_PAINEL_PARA_DBOW.md` para o histórico técnico da base atual.
