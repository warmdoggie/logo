[CmdletBinding()]
param(
  [ValidateSet('s7-logo-stability')]
  [string]$Module = 's7-logo-stability',
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Module -ne 's7-logo-stability') {
  throw "Unknown module: $Module"
}

$startScript = Join-Path $root 'start-workspace.ps1'
if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
  throw "Workspace start script not found: $startScript"
}

$listener = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -eq 0) {
  $child = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru
  Write-Host "Workspace started for S7. PID: $($child.Id)"
} else {
  Write-Host 'The merged workspace is already running.'
}

$url = 'http://127.0.0.1:3210/#/modules/s7-logo-stability'
Write-Host "Local URL: $url"
Write-Host 'Production URL: https://logo.heciai.net/'

if ($Open) {
  Start-Process $url
}
