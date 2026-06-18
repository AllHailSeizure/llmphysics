# Set the working directory to the app folder
$appPath = "D:\Reddit\Devvit\llmphysics-bot"
$srcPath = Join-Path $appPath "src\server"
Push-Location $appPath

# 1. Start Devvit CLI update in the BACKGROUND
Write-Host "[1/5] Starting Devvit CLI update in background..." -ForegroundColor Gray
$updateJob = Start-Job -ScriptBlock { npm install -g devvit@latest }

# 2. Gather Metadata
Write-Host "[2/5] Fetching current app details..." -ForegroundColor Gray
$viewOutput = npx devvit view | Out-String

if ($LASTEXITCODE -ne 0) {
    Write-Warning "Devvit CLI could not read app config. Check devvit.json for syntax errors (no comments allowed)."
}

# Capture only the 3-part 'Deployment' version (X.Y.Z) for the prompt, ignoring any local .Dev iterations
if ($viewOutput -match 'Version:\s+(\d+\.\d+\.\d+)') {
    $currentVersion = $matches[1]
} else {
    $currentVersion = "Unknown"
}

$newVersion = Read-Host "`nEnter new version number to publish (Current: $currentVersion)"
if ([string]::IsNullOrWhiteSpace($newVersion)) {
    Write-Host "Publish cancelled." -ForegroundColor Red
    Stop-Job $updateJob; Remove-Job $updateJob
    Pop-Location; return
}

# 3. Agentic README Update (While CLI updates)
Write-Host "[3/5] Analyzing source code and updating README..." -ForegroundColor Cyan
$readmePath = Join-Path $appPath "README.md"
$registryPath = Join-Path $srcPath "registry.ts"

if ((Test-Path $readmePath) -and (Test-Path $registryPath)) {
    $registryContent = Get-Content $registryPath -Raw
    $readmeContent = Get-Content $readmePath -Raw

    # Build Unoccupied Arrays Table
    $unoccupiedTable = "| Array | Trigger | Endpoint | Notes |`n|-------|---------|----------|-------|`n"
    $triggerArrays = [ordered]@{
        "APP_INSTALL"    = "onAppInstall"
        "APP_UPGRADE"    = "onAppUpgrade"
        "POST_SUBMIT"    = "onPostSubmit"
        "COMMENT_CREATE" = "onCommentCreate"
        "POST_REPORT"    = "onPostReport"
        "COMMENT_REPORT" = "onCommentReport"
        "MOD_ACTIONS"    = "onModAction"
    }

    foreach ($key in $triggerArrays.Keys) {
        # Regex check if array is empty: const ARRAY_NAME: Type[] = [];
        if ($registryContent -match "const\s+$key\s*:\s*[^=]+=\s*\[\s*\]") {
            # Convert camelCase (onAppInstall) to kebab-case (app-install)
            $slug = ($triggerArrays[$key] -replace '^on', '' -replace '([a-z])([A-Z])', '$1-$2').ToLower()
            $unoccupiedTable += "| ``$key`` | ``$($triggerArrays[$key])`` | `/internal/triggers/$slug` | Ready for future modules |`n"
        }
    }

    # Replace the Unoccupied table section (Matches the entire block until the last table pipe)
    $tableRegex = '(?s)\| Array \| Trigger \| Endpoint \| Notes \|.*?(?=\r?\n\r?\n|---|$)'
    
    # Ensure README only gets the 3-part Deployment version (Version.Feature.Deployment)
    $deploymentVersion = if ($newVersion -match '^(\d+\.\d+\.\d+)') { $matches[1] } else { $newVersion }
    $readmeContent = $readmeContent -replace '\*\*Version:\*\* [0-9\.]+', "**Version:** $deploymentVersion"
    $readmeContent = $readmeContent -replace $tableRegex, $unoccupiedTable.Trim()
    $readmeContent | Set-Content $readmePath

    # Update package.json version
    $packagePath = Join-Path $appPath "package.json"
    if (Test-Path $packagePath) {
        (Get-Content $packagePath -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`"" | Set-Content $packagePath
    }
}

# 4. Wait for CLI Update to finish and get version
Write-Host "[4/5] Waiting for Devvit CLI update to complete..." -ForegroundColor Gray
Wait-Job $updateJob | Out-Null
Receive-Job $updateJob | Out-Null

if ($updateJob.State -ne "Completed") {
    Write-Warning "Devvit CLI update failed or timed out. Proceeding with current version..."
}
Remove-Job $updateJob -Force

$cliVersionRaw = devvit --version
if ($cliVersionRaw -match '(\d+\.\d+\.\d+)') {
    $devvitCliVersion = $matches[1]
} else {
    $devvitCliVersion = "0.12" 
}

# Update Platform version in README now that we have the CLI version
(Get-Content $readmePath) -replace '\*\*Platform:\*\* @devvit/web v[0-9\.]+\+', "**Platform:** @devvit/web v$($devvitCliVersion)+" | Set-Content $readmePath

# 5. Build and Final Publish
Write-Host "[5/5] Building and Publishing version $newVersion..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed. Publish aborted."
    Pop-Location; return
}

npx devvit publish --version $newVersion
if ($LASTEXITCODE -ne 0) {
    Write-Error "Devvit publish failed. Check the error log above."
} else {
    Write-Host "`nSuccessfully published and documented!" -ForegroundColor Green
}

Pop-Location