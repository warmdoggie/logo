$ErrorActionPreference='Stop'
$workspaceLauncher=Join-Path (Split-Path $PSScriptRoot -Parent) 'start-workspace.ps1'
if(-not(Test-Path -LiteralPath $workspaceLauncher -PathType Leaf)){throw "Workspace start script not found: $workspaceLauncher"}
Write-Host 'S7 已合并到主工作区，将在 3210 端口启动。'
& $workspaceLauncher
