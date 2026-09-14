# Ferramentas dos canais VIP

Scripts usados para montar o sistema de canais restritos a VIP (03/09/2026). Ficam
aqui porque vão ser reaproveitados; os scripts de edição pontual que só serviram uma
vez não foram guardados.

## Editar fonte sem estragar o encoding

```powershell
.\edit-source.ps1 <arquivo> <trecho-antigo.txt> <trecho-novo.txt>
```

Os fontes do dbow **não têm um encoding só**, nem dentro do mesmo servidor: a maioria
é ISO-8859, alguns são UTF-8 com BOM (`GameServer.cpp`, `PacketGameServer.cpp`,
`NtlSharedDef.h`), outros são ASCII puro. Vários carregam bytes GBK/coreanos em
comentários do código original.

Editor que assume UTF-8 — e o `sed -i` do Git Bash — reescreve o arquivo inteiro e
suja dezenas de linhas que não têm nada a ver com a mudança. Este script detecta o BOM
e, na ausência dele, lê e grava byte a byte.

Ele recusa a gravar se o trecho antigo não aparecer **exatamente uma vez**. Depois de
editar, confira com `file <arquivo>` (o encoding tem que ser o mesmo) e
`git diff --stat` (só as linhas que você mexeu).

## Conferir a regra de permissão

```powershell
cmd /c "`"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat`" >nul 2>&1 && cl /nologo /EHsc /I ..\..\DboShared\NtlShared2 /I ..\..\NtlLib\Shared\Util /I ..\..\NtlLib\Shared check-vip-rule.cpp /Fe:check-vip-rule.exe"
.\check-vip-rule.exe
```

Compila contra o `NtlAdmin.h` **de verdade** — não uma cópia — e cobre os quatro
níveis, os canais comum/VIP e o GM. Vale rodar sempre que mexer em
`CanEnterChannelWithVipLevel`. Hoje a regra é de tipo exato: cada nível entra só no
canal do seu nível, e canal com `VipLevel = 0` é aberto a todos.

## Conferir se o pacote de canais ainda cabe

```powershell
cl /nologo /EHsc /I ..\..\DboShared\NtlShared2 /I ..\..\NtlLib\Shared\Util /I ..\..\NtlLib\Shared /I ..\..\NtlLib\Shared\NtlTrigger check-channel-packet-size.cpp /Fe:check-channel-packet-size.exe
.\check-channel-packet-size.exe
```

O `sCU_SERVER_CHANNEL_INFO` leva 10 canais e o transporte corta em **4095 bytes**
(`PACKET_MAX_SIZE`). Crescer o `_CHANNEL_BUFF` custa 10× o que parece. Estourar não
dá erro — dá pacote truncado e lista de canais errada.

Há um `static_assert` em `NtlPacketCU.h` guardando isso, então o build quebra antes.
Este script serve para ver **quanta folga ainda existe** antes de acrescentar campo.

## Mexer nas marcas dos canais (packs)

```bash
node --experimental-strip-types set-channel-icons.ts          # simula
node --experimental-strip-types set-channel-icons.ts --apply  # grava
```

Define as superfícies `srfChannelIconGold`, `srfChannelIconRed` e `srfChannelIconBlue`
nos dois `.srf` que desenham a lista de canais. Todas apontam para a **mesma região da
textura** (a marca de Zenny na `rsrRaceCommon`), mudando só `color_red/green/blue` —
o cliente joga essas cores nos vértices, então elas modulam a imagem. Nenhuma arte
nova entra no pack.

Para criar uma cor nova: acrescente a entrada em `CORES` no script, rode com
`--apply`, e escreva o nome dela no `ChannelIcon` do `.ini` do canal. **Não precisa
recompilar o cliente.**

O cliente precisa estar fechado. O script faz backup em `../data/pack-backups/`.

Auxiliares:

- `dump-srf.ts <trecho-do-nome>` — extrai e imprime um arquivo de dentro de um pack
- `find-surfaces.ts <palavra>...` — procura superfícies pequenas (candidatas a ícone)
  nos `.srf`, mostrando tamanho, textura e UV

`add-vip-icon-surface.ts` e `add-vip-icon-colors.ts` são os passos anteriores, já
superados pelo `set-channel-icons.ts`. Ficaram como histórico.

## Onde a configuração dos canais mora

Um GameServer por canal, em `DboServer/ExecutionEnv/config/GameServerN.ini`:

```ini
Channel = 2
Channelname = VIP              ; o que aparece na lista; vazio = "Channel <n>"
VipLevel = 1                   ; 0 = aberto; 1..3 = só quem tem accounts.vip igual
ChannelIcon = Gold             ; superfície "srfChannelIcon" + este nome
ChannelInfo1 = XP Boost: 50%   ; linhas do hover, até 6 (191 caracteres somados)
ChannelInfo2 = Dragon Balls Boost: 50%
```

Mudar qualquer uma dessas chaves pede só reiniciar aquele GameServer — nada de
recompilar.
