<#
.SYNOPSIS
  Fully resets Devvit CLI authentication ("nuke and re-login").

.DESCRIPTION
  `devvit logout` + re-login is NOT a full auth reset and has failed to fix
  auth before (June 2026: whoami succeeded while upload/publish returned
  "You must be logged in to upload a new app version"). The reliable fix is
  deleting the entire ~/.devvit folder, then logging in fresh.

  Also checks for a DEVVIT_AUTH_TOKEN environment variable or .env entry —
  the CLI reads that BEFORE the token file, so a stale value there silently
  hijacks auth no matter how many times you log in.

.PARAMETER CopyPaste
  Use the copy-paste login flow (for remote/headless sessions): the CLI
  prints a URL; open it in any browser, authorize, and paste the code back
  into the prompt.

.PARAMETER SkipLogin
  Only nuke the auth state; skip the login step.

.EXAMPLE
  .\nuke-devvit-auth.ps1              # local: opens browser for OAuth
  .\nuke-devvit-auth.ps1 -CopyPaste   # remote: prints URL, paste code back
#>
[CmdletBinding()]
param(
    [switch]$CopyPaste,
    [switch]$SkipLogin
)

$ErrorActionPreference = 'Continue'
$devvitDir  = Join-Path $env:USERPROFILE '.devvit'
$projectDir = 'D:\Libraries\Reddit\llmphysics\llmphysics-bot'

Write-Host '== Devvit auth nuke ==' -ForegroundColor Cyan

# 0. Detect auth hijackers: DEVVIT_AUTH_TOKEN overrides the token file entirely.
foreach ($scope in 'Process', 'User', 'Machine') {
    $v = [Environment]::GetEnvironmentVariable('DEVVIT_AUTH_TOKEN', $scope)
    if ($v) {
        Write-Warning "DEVVIT_AUTH_TOKEN is set at $scope scope. It OVERRIDES the token file - logging in again will NOT help until it is removed."
    }
}
$dotenv = Join-Path $projectDir '.env'
if ((Test-Path $dotenv) -and (Select-String -Path $dotenv -Pattern '^\s*DEVVIT_AUTH_TOKEN' -Quiet)) {
    Write-Warning "DEVVIT_AUTH_TOKEN found in $dotenv. The CLI loads .env and it OVERRIDES the token file - delete that line."
}

# 1. Best-effort logout (ignore failures - we are deleting the folder anyway).
if (Test-Path $projectDir) { Set-Location $projectDir }
npx -y @devvit/cli@latest logout 2>$null

# 2. Nuke the auth folder. logout alone does NOT clear everything.
if (Test-Path $devvitDir) {
    Remove-Item $devvitDir -Recurse -Force
    Write-Host "Deleted $devvitDir" -ForegroundColor Green
} else {
    Write-Host "$devvitDir not present (already clean)"
}

# 3. Fresh login + verification.
if (-not $SkipLogin) {
    if ($CopyPaste) {
        Write-Host 'Copy-paste login: open the URL below in ANY browser, authorize, then paste the code back here.' -ForegroundColor Yellow
        npx -y @devvit/cli@latest login --copy-paste
    } else {
        npx -y @devvit/cli@latest login
    }
    Write-Host '-- whoami check (note: whoami passing does NOT guarantee uploads work) --'
    npx -y @devvit/cli@latest whoami
}

Write-Host '== Done. Test with: npx devvit playtest r/llmphysics_dev ==' -ForegroundColor Cyan
