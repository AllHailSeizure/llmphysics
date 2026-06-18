# Automated Playtest Script for llmphysics-bot
$appPath = Join-Path $PSScriptRoot "..\llmphysics-bot"
Push-Location $appPath

# 0. Verify auth before the build — Reddit OAuth tokens expire every 24 hours and the
# silent background refresh can fail without any visible error. Checking here means the
# login prompt appears before spending time on the build, not partway through upload.
Write-Host "[0/4] Checking devvit auth..." -ForegroundColor Gray
$whoamiOutput = & npx devvit whoami 2>&1
if ($whoamiOutput -match "Logged in") {
    Write-Host "  $whoamiOutput" -ForegroundColor Gray
} else {
    Write-Host "  Not logged in — running 'devvit login'..." -ForegroundColor Yellow
    & npx devvit login
    if ($LASTEXITCODE -ne 0) { Write-Error "Login failed. Aborting."; Pop-Location; return }
}

# 1. Cleaning up orphaned processes
Write-Host "[1/4] Cleaning up orphaned processes..." -ForegroundColor Gray

# Kill the specific port
& "$PSScriptRoot\close-port.ps1" -Port 5678

# Kill any node process specifically running devvit playtest to release the session lock
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { 
    try { $_.CommandLine -like "*devvit*playtest*" } catch { $false } 
} | Stop-Process -Force

# 2. Handle Dev Versioning (Version.Feature.Deployment.Dev)
$packageContent = Get-Content "package.json" -Raw
if ($packageContent -match '"version":\s*"(\d+\.\d+\.\d+)(?:\.(\d+))?"') {
    $baseVersion = $matches[1]
    $devIteration = $matches[2]

    if ([string]::IsNullOrEmpty($devIteration)) {
        $newVersion = "$baseVersion.0"
    } else {
        $nextNum = [int]$devIteration + 1
        $newVersion = "$baseVersion.$nextNum"
    }

    $packageContent = $packageContent -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
    $packageContent | Set-Content "package.json"
    Write-Host "Bumping dev version to: $newVersion" -ForegroundColor Gray
}

Write-Host "[2/4] Running build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed. Aborting."; Pop-Location; return }

Write-Host "[3/4] Starting playtest on r/llmphysics_dev..." -ForegroundColor Green
npx devvit playtest r/llmphysics_dev --connect
Pop-Location
