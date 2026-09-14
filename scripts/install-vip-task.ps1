param(
  [switch]$Force,
  [switch]$RunAsSystem
)

$ErrorActionPreference = 'Stop'
$vipWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$vipNode = (Get-Command node.exe -ErrorAction Stop).Source
$vipTimeZone = (Get-TimeZone).Id
if ($vipTimeZone -ne 'E. South America Standard Time') {
  throw 'Configure o fuso do Windows para Sao Paulo antes de instalar a tarefa diaria.'
}

$vipTaskName = 'DboWorld-Admin-Vip-Expiry'
$vipExisting = Get-ScheduledTask -TaskName $vipTaskName -ErrorAction SilentlyContinue
if ($vipExisting -and $Force) {
  Unregister-ScheduledTask -TaskName $vipTaskName -Confirm:$false
  $vipExisting = $null
}
if ($vipExisting) {
  throw "A tarefa $vipTaskName ja existe. Confira sua configuracao ou use -Force para substitui-la."
}

$vipArguments = '--env-file="' + (Join-Path $vipWorkspace '.env.local') + '" --experimental-strip-types "' + (Join-Path $vipWorkspace 'scripts\vip-job.mjs') + '"'
$vipAction = New-ScheduledTaskAction -Execute $vipNode -Argument $vipArguments -WorkingDirectory $vipWorkspace
$vipTrigger = New-ScheduledTaskTrigger -Daily -At '00:05'
$vipSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$vipPrincipal = if ($RunAsSystem) {
  New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $vipCurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  New-ScheduledTaskPrincipal -UserId $vipCurrentUser -LogonType Interactive -RunLevel Limited
}

Register-ScheduledTask -TaskName $vipTaskName -Action $vipAction -Trigger $vipTrigger -Settings $vipSettings -Principal $vipPrincipal -Description 'Expira VIPs diariamente as 00h05 de Sao Paulo; nao depende do painel aberto.' | Select-Object TaskName, State
