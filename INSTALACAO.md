# Instalação do painel

Este painel lê e escreve arquivos da sua instalação do jogo. Ele **não traz** esses
arquivos junto — você aponta para os seus.

---

## O que você precisa antes de começar

| | versão | como conferir |
|---|---|---|
| Node.js | 20 ou mais novo | `node --version` |
| MySQL | com `dbo_acc` e `dbo_char` | já está rodando se o servidor sobe |
| Instalação do jogo | a mesma base | ver abaixo |

---

## Passo 1 — Instalar as dependências

Na pasta do painel:

```bash
npm install
```

Demora alguns minutos na primeira vez.

---

## Passo 2 — Apontar para o jogo

Copie `.env.example` para `.env.local` e abra num editor de texto:

```bash
copy .env.example .env.local
```

O painel precisa saber **uma coisa só**: onde fica a pasta que contém `DboServer` e
`ClientRuntime_RealBase`.

```ini
DBOW_GAME_ROOT=C:\jogos\dbo
```

Se a sua estrutura é assim, é isso:

```
C:\jogos\dbo\                     <- é este caminho que vai no DBOW_GAME_ROOT
├── DboServer\
│   └── ExecutionEnv\
│       ├── config\               .ini dos servidores
│       ├── resource\server_data\table\rdf\
│       └── *.exe
├── ClientRuntime_RealBase\
│   └── pack\                     tbl.pak, gui.pak, tex.pak e as unidades
└── painel-admin\                 <- esta pasta aqui
```

**Se o painel estiver dentro dessa mesma pasta**, ao lado de `DboServer`, pode apagar a
linha do `DBOW_GAME_ROOT` — os caminhos relativos já funcionam.

Se algum arquivo estiver fora do lugar padrão, dá para apontar um por um. As variáveis
estão comentadas no `.env.example`.

---

## Passo 3 — Preencher o resto do `.env.local`

**Acesso ao painel** — invente um usuário e senha, e gere um segredo de sessão:

```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD=uma-senha-com-pelo-menos-12-caracteres
SESSION_SECRET=uma-chave-aleatoria-com-pelo-menos-32-caracteres
ADMIN_COOKIE_SECURE=false
```

Para gerar o segredo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Bancos de dados** — os mesmos dados que já estão nos `.ini` dos seus servidores, em
`DboServer\ExecutionEnv\config\`, nas seções `[DATABASE_ACCOUNT]` e
`[DATABASE_CHARACTER]`:

```ini
ACCOUNT_DB_HOST=127.0.0.1
ACCOUNT_DB_USER=root
ACCOUNT_DB_PASSWORD=sua-senha-do-mysql
ACCOUNT_DB_NAME=dbo_acc

CHARACTER_DB_HOST=127.0.0.1
CHARACTER_DB_USER=root
CHARACTER_DB_PASSWORD=sua-senha-do-mysql
CHARACTER_DB_NAME=dbo_char
```

---

## Passo 4 — Rodar

```bash
npm run build
npm start
```

Abra `http://localhost:3000` e entre com o usuário e senha que você definiu.

Para desenvolver, `npm run dev` recarrega sozinho a cada mudança.

---

## Quais arquivos do jogo o painel usa

Você não precisa copiar nada — basta apontar. Esta lista é para conferência, e para o
caso de você querer montar uma pasta reduzida.

### Do servidor

Em `DboServer\ExecutionEnv\resource\server_data\table\rdf\`:

| arquivo | tamanho | usado por |
|---|---|---|
| `Table_Skill_Data.rdf` | ~960 KB | catálogo e edição de skills |
| `Table_Item_Data.rdf` | ~5,9 MB | catálogo e edição de itens |
| `Table_MOB_Data.rdf` | ~4,1 MB | catálogo de mobs |
| `table_text_all_data.rdf` | ~6,1 MB | nomes e descrições de tudo |

E em `DboServer\ExecutionEnv\`:

- `config\*.ini` e os `*.exe` — só para a aba que liga e desliga servidores

### Do cliente

Em `ClientRuntime_RealBase\pack\`:

| arquivos | tamanho | usado por |
|---|---|---|
| `tbl.pak` + `tbl2.pak` | 43 KB + 17 MB | cópia da tabela de skill/item que o cliente lê |
| `gui.pak` + `gui0.pak` | 94 KB + 4,2 MB | árvores de skill |
| `tex.pak` + `tex*.pak` | 5,6 MB + unidades | ícones de skill e item |

**Índice e unidade andam sempre em par.** `tbl.pak` é o índice e `tbl2.pak` é o
conteúdo; um sem o outro deixa os offsets apontando para o lugar errado.

### Banco de dados

- `dbo_acc` — contas, para a aba de contas
- `dbo_char` — personagens, para a aba de personagens

---

## Conferindo se deu certo

Depois de entrar no painel:

| aba | o que tem que aparecer |
|---|---|
| Contas | sua lista de contas do MySQL |
| Itens | ~50 mil itens, com ícones |
| Skills | ~2,8 mil skills, com ícones |
| Árvore de skills | a árvore desenhada, por classe |
| Servidores | os `.exe` encontrados no ExecutionEnv |

Se uma aba abre vazia ou dá erro de arquivo, é caminho errado no `.env.local`. A
mensagem de erro mostra o caminho que ele tentou — compare com o que existe no disco.

---

## Problemas comuns

**Login não entra, volta para a tela de login**
`ADMIN_COOKIE_SECURE=true` em `http://`. O navegador descarta o cookie. Ponha `false`.

**"Tabela não encontrada" numa aba**
O caminho não bate. Confira o `DBOW_GAME_ROOT` — ele aponta para a pasta que *contém*
`DboServer`, não para o `DboServer` em si.

**Ícones não aparecem, o resto funciona**
A pasta `pack` está errada, ou faltam as unidades (`tex0.pak`, `tex1.pak`…). O índice
sozinho não basta.

**Erro de conexão com o banco**
Usuário, senha ou nome do banco errados. Confira contra os `.ini` em
`ExecutionEnv\config\`.

---

## Antes de publicar qualquer coisa

O painel escreve nos arquivos do jogo — tabela do servidor e packs do cliente. Antes de
usar as funções de publicação:

1. **Faça backup** da pasta `pack` e das tabelas `.rdf`. O painel guarda backups
   próprios em `data\`, mas ter uma cópia sua não custa nada.
2. **Feche o cliente** antes de publicar no pack. Arquivo aberto não pode ser
   substituído.
3. **Reinicie o GameServer** depois de publicar no `.rdf` — ele lê as tabelas só no
   boot.

Mudança de skill precisa ir para os **dois lados**, servidor e cliente. Se só um for
atualizado, nada acusa erro — o jogo simplesmente se comporta de forma estranha.
