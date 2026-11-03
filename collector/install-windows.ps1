# Installs the Hayat System Health collector as a Windows scheduled task that starts with
# the PC (runs as SYSTEM, restarts if it stops). Run in PowerShell "as Administrator"
# from inside the collector folder:   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
$ErrorActionPreference = 'Stop'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path "$dir\config.json")) { throw "config.json not found in $dir - copy config.example.json to config.json and fill it in first." }
if (-not (Test-Path "$dir\node_modules\net-snmp")) { Push-Location $dir; npm install --omit=dev; Pop-Location }

$name = 'Hayat System Health Collector'
$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$node`" `"$dir\collector.js`" >> `"$dir\collector.log`" 2>&1`"" -WorkingDirectory $dir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Installed and started '$name'. Log: $dir\collector.log"
Write-Host "To remove:  Unregister-ScheduledTask -TaskName '$name' -Confirm:`$false"
