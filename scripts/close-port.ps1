[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [int]$Port
)

# 1. Find the process ID (PID) owning the port
$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
              Select-Object -First 1

if ($connection) {
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        $procName = $process.ProcessName
        Write-Host "Found process '$procName' (PID: $($process.Id)) on port $Port. Terminating..." -ForegroundColor Cyan
        $process | Stop-Process -Force
        Write-Host "Port $Port is now clear." -ForegroundColor Green
    } else {
        Write-Host "Connection found, but the owning process (PID: $($connection.OwningProcess)) is already gone." -ForegroundColor Yellow
    }
} else {
    Write-Host "No active process found on port $Port." -ForegroundColor Yellow
}