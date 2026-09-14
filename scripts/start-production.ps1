$ErrorActionPreference = 'Stop'

$panelWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$panelEnv = Join-Path $panelWorkspace '.env.local'
$panelBuild = Join-Path $panelWorkspace '.next\BUILD_ID'
$panelLogs = Join-Path $panelWorkspace 'data\logs'

if (-not (Test-Path -LiteralPath $panelEnv)) {
  throw "Arquivo de configuracao ausente: $panelEnv"
}

if (-not (Test-Path -LiteralPath $panelBuild)) {
  throw 'Build de producao ausente. Execute npm run build antes de iniciar o painel.'
}

$panelNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $panelLogs -Force | Out-Null

$env:NODE_ENV = 'production'
$env:HOSTNAME = '127.0.0.1'
$env:PORT = '3000'

$panelStartedAt = Get-Date -Format 'yyyyMMdd-HHmmss'
$panelStdout = Join-Path $panelLogs "panel-$panelStartedAt.log"
$panelStderr = Join-Path $panelLogs "panel-$panelStartedAt.error.log"

$panelProcess = Start-Process `
  -FilePath $panelNpm `
  -ArgumentList @('run', 'start', '--', '--hostname', '127.0.0.1', '--port', '3000') `
  -WorkingDirectory $panelWorkspace `
  -NoNewWindow `
  -Wait `
  -PassThru `
  -RedirectStandardOutput $panelStdout `
  -RedirectStandardError $panelStderr

exit $panelProcess.ExitCode
