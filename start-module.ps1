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

$startScript = Join-Path $root '01_Source_Code\start-s7.ps1'
if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
  throw "S7 start script not found: $startScript"
}

$listener = @()
try {
  $listener = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3237 -State Listen -ErrorAction Stop)
} catch {
  $listener = @()
}

if ($listener.Count -eq 0) {
  $child = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript) `
    -WorkingDirectory (Split-Path -Parent $startScript) `
    -PassThru
  Write-Host "S7 Logo Stability started. PID: $($child.Id)"
} else {
  Write-Host 'S7 Logo Stability is already running; no duplicate process started.'
}

$url = 'http://127.0.0.1:3237/'
Write-Host "Local URL: $url"
Write-Host 'Production URL: https://logo.heciai.net/'

if ($Open) {
  Start-Process $url
}
