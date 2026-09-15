# Publicar o painel no Windows Server com Cloudflare Tunnel

Esta primeira publicacao suporta as partes que usam os bancos `dbo_acc` e
`dbo_char`: dashboard, contas, personagens, VIP, vencimentos e fila do correio.
RDF, packs e controle dos executaveis do jogo ficam para uma atualizacao futura.

O painel escuta somente em `127.0.0.1:3000`. O Cloudflare Tunnel cria a conexao
HTTPS externa sem abrir as portas 3000 ou 3306 no firewall.

## Requisitos

- Windows Server 2016 ou mais recente.
- Node.js 20.9 ou mais recente, instalado para todos os usuarios.
- Git.
- MySQL/MariaDB local com `dbo_acc` e `dbo_char`.
- Um dominio adicionado a uma conta Cloudflare.
- QueryServer atualizado e em execucao para consumir a fila de correio.

## 1. Clonar e configurar

Abra o PowerShell no servidor:

```powershell
git clone URL_DO_REPOSITORIO C:\dbow\painel-admin
Set-Location C:\dbow\painel-admin
Copy-Item deploy\windows\env.database-only.example .env.local
notepad .env.local
```

Preencha usuario administrativo, senha, segredo de sessao e bancos. Como o
acesso externo sera HTTPS, mantenha:

```ini
ADMIN_COOKIE_SECURE=true
ACCOUNT_DB_HOST=127.0.0.1
CHARACTER_DB_HOST=127.0.0.1
```

Gere o segredo de sessao no servidor:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Nao envie `.env.local` ao Git e nao use a conta `root` do banco. Crie um usuario
dedicado com somente as permissoes exigidas pelo painel.

## 2. Instalar o painel

Abra o PowerShell **como Administrador** e execute:

```powershell
Set-Location C:\dbow\painel-admin
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-production.ps1
```

O instalador executa `npm ci`, aplica a migracao do correio, cria o build e
registra estas tarefas no Agendador do Windows:

- `DboWorld-Admin-Panel`: inicia junto com o Windows e reinicia se falhar.
- `DboWorld-Admin-Vip-Expiry`: expira VIPs diariamente as 00h05.

Se o banco permitir criar `accounts.vip_expires_at`, inclua `-MigrateVip` no
comando. Sem essa opcao, o painel funciona em modo legado: mostra e altera os
niveis VIP, mas nao oferece validade, renovacao por prazo ou vencimento automatico.

Confira localmente no servidor:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/login -UseBasicParsing
Get-ScheduledTask DboWorld-Admin-Panel,DboWorld-Admin-Vip-Expiry
```

Os logs do painel ficam em `data\logs`.

## 3. Criar o Cloudflare Tunnel

No painel Cloudflare Zero Trust:

1. Abra **Networks > Tunnels** e crie um tunnel do tipo `cloudflared`.
2. Escolha Windows e copie o comando de instalacao apresentado pela Cloudflare.
3. Execute esse comando em um PowerShell como Administrador no servidor.
4. Em **Published application**, defina o hostname, por exemplo
   `painel.seudominio.com`.
5. Em **Service**, escolha `HTTP` e informe `localhost:3000`.

O token mostrado no comando identifica o tunnel. Nao coloque esse token no
repositorio, em capturas de tela ou em arquivos compartilhados.

Nao crie regras de entrada para as portas 3000 e 3306. O `cloudflared` precisa
somente conseguir iniciar conexoes de saida. Se o firewall bloquear a conexao,
libere a porta de saida 7844 TCP/UDP para o Cloudflare Tunnel.

## 4. Proteger com Cloudflare Access

Antes de divulgar o endereco:

1. Abra **Access > Applications**.
2. Adicione uma aplicacao `Self-hosted` para `painel.seudominio.com`.
3. Crie uma politica `Allow` limitada aos e-mails dos administradores.
4. Ative autenticacao multifator no provedor de identidade utilizado.

O login do Cloudflare Access e o login do proprio painel devem permanecer
ativos.

## 5. Atualizar depois de um novo clone/pull

Abra o PowerShell como Administrador:

```powershell
Set-Location C:\dbow\painel-admin
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-production.ps1 -Force
```

O `.env.local` e os dados locais sao preservados porque ficam fora do Git.

## Verificacoes

- `https://painel.seudominio.com/login` abre somente depois do Cloudflare Access.
- Dashboard e contas carregam dados dos dois bancos.
- Alteracao de nivel VIP funciona; validade e renovacao aparecem depois da migracao.
- A tarefa VIP apresenta estado `Ready` depois de uma execucao manual.
- Solicitar um item cria registro em `admin_mail_items`.
- O QueryServer transforma a solicitacao pendente em correio dentro do jogo.

As paginas de itens, skills, mobs, arvore e servidores podem apresentar erro de
arquivo nesta fase. Elas dependem de `DBOW_GAME_ROOT` e serao habilitadas quando
a manipulacao de RDF e packs for instalada no servidor.
