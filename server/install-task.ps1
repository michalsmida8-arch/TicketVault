# Registers the TicketVault server as a Windows Scheduled Task that starts at boot
# (before anyone logs in) and restarts if it dies. Run once from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
# Remove with:  Unregister-ScheduledTask -TaskName TicketVaultServer -Confirm:$false
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'server.log'
$runner = Join-Path $here 'run-server.cmd'   # restart loop around node

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest

Register-ScheduledTask -TaskName 'TicketVaultServer' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'TicketVaultServer'
Write-Host "TicketVaultServer task installed and started. Log: $log"
