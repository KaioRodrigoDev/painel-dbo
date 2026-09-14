# Edita um fonte do dbow (DboClient, DboServer, DboShared) preservando o encoding.
#
# POR QUE ISSO EXISTE
#
# Os fontes deste projeto nao tem um encoding so, nem dentro do mesmo servidor:
#
#   ISO-8859        CPlayer.h, PacketCharServer.cpp, NtlAdmin.h, PlayerCache.cpp...
#   UTF-8 com BOM   GameServer.cpp, PacketGameServer.cpp, NtlSharedDef.h...
#   ASCII puro      CharServer/Player.h, ResultCodeString.cpp...
#
# E varios carregam bytes GBK/coreanos em comentarios do codigo original. Ferramentas
# que reescrevem o arquivo inteiro assumindo UTF-8 -- inclusive editores comuns e o
# `sed -i` do Git Bash -- trocam o encoding e sujam dezenas de linhas que nao tem nada
# a ver com a mudanca. O repo ja teve um commit so para consertar isso.
#
# COMO RESOLVE
#
# Detecta o BOM de UTF-8, que e inequivoco. Sem BOM, le e grava como Latin-1 (28591),
# que mapeia byte a byte -- entao o conteudo volta identico seja qual for o encoding
# real do arquivo, e so o trecho editado muda.
#
# Valida que o trecho antigo aparece EXATAMENTE uma vez antes de gravar. Se aparecer
# zero ou duas, nao grava nada e avisa.
#
# USO
#
#   edit-source.ps1 <arquivo> <txt-com-trecho-antigo> <txt-com-trecho-novo>
#
# Os dois .txt sao arquivos comuns com o trecho literal, incluindo tabulacao. Escreva
# com TAB, nao espacos -- este codebase usa tabulacao.
#
# DEPOIS DE EDITAR, CONFIRA
#
#   file <arquivo>          o encoding tem que ser o mesmo de antes
#   git diff --stat         so as linhas que voce mexeu devem aparecer
param(
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$OldFile,
    [Parameter(Mandatory=$true)][string]$NewFile
)

$ErrorActionPreference = "Stop"

function Get-Encoding([string]$path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return @{ Enc = (New-Object System.Text.UTF8Encoding($true)); Nome = "UTF-8 com BOM" }
    }
    # Latin-1 mapeia byte a byte: o que nao foi editado volta identico
    return @{ Enc = [System.Text.Encoding]::GetEncoding(28591); Nome = "byte a byte (Latin-1)" }
}

function Read-Trecho([string]$path, $enc) {
    $texto = [System.IO.File]::ReadAllText($path, $enc)
    $texto = $texto -replace "`r`n", "`n"
    $texto = $texto -replace "`n", "`r`n"      # o codebase e CRLF
    return $texto.TrimEnd([char]13, [char]10)  # a quebra final do .txt nao conta
}

$info = Get-Encoding $Target
$enc = $info.Enc

$conteudo = [System.IO.File]::ReadAllText($Target, $enc)
$antigo = Read-Trecho $OldFile $enc
$novo = Read-Trecho $NewFile $enc

$ocorrencias = ([regex]::Matches($conteudo, [regex]::Escape($antigo))).Count
if ($ocorrencias -ne 1) {
    Write-Output ("FALHA: o trecho antigo aparece {0} vez(es) em {1} (esperado exatamente 1)." -f $ocorrencias, (Split-Path $Target -Leaf))
    if ($ocorrencias -eq 0) {
        Write-Output "       Confira tabulacao vs espaco, espaco no fim da linha e acentos."
    } else {
        Write-Output "       Inclua mais linhas de contexto para o trecho ficar unico."
    }
    Write-Output "       Nada foi gravado."
    exit 1
}

[System.IO.File]::WriteAllText($Target, $conteudo.Replace($antigo, $novo), $enc)
Write-Output ("OK  {0}  ({1})" -f (Split-Path $Target -Leaf), $info.Nome)
