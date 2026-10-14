$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '01_Source_Code'
$env:APP_MULTI_USER = '1'
$env:APP_DATA_DIR = Join-Path $source 'data'
$env:S7_SPACE_DIR = Join-Path $env:APP_DATA_DIR 'user-spaces'
$env:PORT = '3210'
$env:HOST = '127.0.0.1'

if (Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3210 is already running. Stop the existing workspace before starting multi-user mode.'
}
if (-not (Get-NetTCPConnection -LocalPort 3237 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $source 'start-s7.ps1')) -WorkingDirectory $source -WindowStyle Hidden
} else {
    try {
        $s7Mode = Invoke-RestMethod 'http://127.0.0.1:3237/api/session' -TimeoutSec 5
        if (-not $s7Mode.enabled) { throw 'The existing S7 service is in legacy mode. Stop it before starting this workspace.' }
    } catch {
        if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) { throw }
    }
}
Write-Host 'Workspace: http://127.0.0.1:3210/'
Write-Host ('Initial administrator account: ' + (Join-Path $env:APP_DATA_DIR 'workspace-admin.txt'))
& node (Join-Path $source 'server.mjs')
