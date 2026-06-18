<#
.SYNOPSIS
  Kills lingering node/devvit playtest processes and frees the playtest port (5678).

.DESCRIPTION
  Devvit playtest leaves watchers and a WebSocket server (port 5678) alive. Stacked
  attempts cause EADDRINUSE and confusing errors. Run this between attempts, and ALWAYS
  before retrying a failed upload, so you start from a clean slate.

.EXAMPLE
  .\kill-devvit.ps1
#>
[CmdletBinding()]
param()

Write-Host '== Killing devvit/node processes and freeing port 5678 ==' -ForegroundColor Cyan

# Free the playtest WebSocket port first (kill whoever owns it)
$port = 5678
$owners = (netstat -ano | Select-String ":$port\s") -replace '.*\s(\d+)$', '$1' | Sort-Object -Unique
foreach ($pid in $owners) {
    if ($pid -match '^\d+$') {
        try { Stop-Process -Id $pid -Force -ErrorAction Stop; Write-Host "Killed PID $pid holding port $port" -ForegroundColor Green }
        catch { Write-Host "Could not kill PID $pid ($_)" }
    }
}

# Kill ONLY node processes whose command line is a devvit invocation.
# (A blanket "kill all node" would also kill VS Code helpers, esbuild, vitest,
#  and possibly this session — so we filter by command line.)
$devvitNodes = Get-CimInstance Win32_Process -Filter "name='node.exe'" |
    Where-Object { $_.CommandLine -match 'devvit' }
if ($devvitNodes) {
    foreach ($p in $devvitNodes) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "Killed devvit node PID $($p.ProcessId)" -ForegroundColor Green }
        catch { Write-Host "Could not kill PID $($p.ProcessId) ($_)" }
    }
} else {
    Write-Host 'No devvit node processes running'
}

# Confirm the port is free
Start-Sleep -Milliseconds 300
if (netstat -ano | Select-String ":$port\s") {
    Write-Warning "Port $port still in use - re-run or check manually."
} else {
    Write-Host "Port $port is free." -ForegroundColor Green
}
