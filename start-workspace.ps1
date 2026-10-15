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
Write-Host 'Workspace: http://127.0.0.1:3210/'
Write-Host 'S7 module: http://127.0.0.1:3210/#/modules/s7-logo-stability'
Write-Host ('Initial administrator account: ' + (Join-Path $env:APP_DATA_DIR 'workspace-admin.txt'))
& node (Join-Path $source 'server.mjs')
