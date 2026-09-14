param(
  [switch]$Force,
  [switch]$SkipMailMigration
)

$ErrorActionPreference = 'Stop'

$panelIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$panelPrincipal = [Security.Principal.WindowsPrincipal]::new($panelIdentity)
if (-not $panelPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador para instalar as tarefas do Windows.'
}

$panelWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$panelEnv = Join-Path $panelWorkspace '.env.local'
if (-not (Test-Path -LiteralPath $panelEnv)) {
  throw 'Crie .env.local primeiro. Use deploy\windows\env.database-only.example como modelo.'
}

$panelNode = (Get-Command node.exe -ErrorAction Stop).Source
$panelNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$panelNodeVersion = (& $panelNode -p "process.versions.node").Trim()
if ([version]$panelNodeVersion -lt [version]'20.9.0') {
  throw "Node.js $panelNodeVersion detectado. Instale Node.js 20.9 ou superior."
}

$panelTaskName = 'DboWorld-Admin-Panel'
$panelExistingTask = Get-ScheduledTask -TaskName $panelTaskName -ErrorAction SilentlyContinue
if ($panelExistingTask -and -not $Force) {
  throw "A tarefa $panelTaskName ja existe. Execute novamente com -Force para atualiza-la."
}
if ($panelExistingTask) {
  Stop-ScheduledTask -TaskName $panelTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $panelTaskName -Confirm:$false
}

Push-Location $panelWorkspace
try {
  & $panelNpm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }

  & $panelNpm run vip:migrate
  if ($LASTEXITCODE -ne 0) { throw 'A migracao VIP falhou.' }

  if (-not $SkipMailMigration) {
    & $panelNpm run mail:migrate
    if ($LASTEXITCODE -ne 0) { throw 'A migracao da fila de correio falhou.' }
  }

  & $panelNpm run build
  if ($LASTEXITCODE -ne 0) { throw 'O build de producao falhou.' }
} finally {
  Pop-Location
}

$panelPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$panelLauncher = Join-Path $panelWorkspace 'scripts\start-production.ps1'
$panelArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $panelLauncher + '"'
$panelAction = New-ScheduledTaskAction -Execute $panelPowerShell -Argument $panelArguments -WorkingDirectory $panelWorkspace
$panelTrigger = New-ScheduledTaskTrigger -AtStartup
$panelTrigger.Delay = 'PT30S'
$panelSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$panelTaskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $panelTaskName -Action $panelAction -Trigger $panelTrigger -Settings $panelSettings -Principal $panelTaskPrincipal -Description 'Painel administrativo Dbo World em 127.0.0.1:3000.' | Out-Null

& (Join-Path $PSScriptRoot 'install-vip-task.ps1') -RunAsSystem -Force
Start-ScheduledTask -TaskName $panelTaskName

Write-Host ''
Write-Host 'Instalacao concluida.' -ForegroundColor Green
Write-Host 'Painel local: http://127.0.0.1:3000'
Write-Host 'Tarefa do painel: DboWorld-Admin-Panel'
Write-Host 'Tarefa de VIP: DboWorld-Admin-Vip-Expiry'
Write-Host 'Proximo passo: configure o Cloudflare Tunnel conforme DEPLOY_WINDOWS_CLOUDFLARE.md.'
