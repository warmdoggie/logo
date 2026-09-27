param([ValidateSet('Menu','Check','Tests','EnableAI','DisableAI')][string]$Mode='Menu')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$step6bNode='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $step6bNode)) { $step6bNode=(Get-Command node -ErrorAction Stop).Source }
$step6bConfigPath=Join-Path $PSScriptRoot 'data/ai-provider.local.json'
function Check-Local {
    Write-Host '检查本地环境（不会调用真实 AI）'
    & $step6bNode --version
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'data/assistant.sqlite'))) { throw '原有数据库不存在，请检查项目文件夹。' }
    try {
        $step6bHealth=Invoke-RestMethod 'http://127.0.0.1:3210/api/health' -TimeoutSec 5
        if ($step6bHealth.app -ne 'render-assistant-local') { throw '端口上不是当前工具' }
        Write-Host '本地服务：正常，地址 http://127.0.0.1:3210'
        $step6bStatus=Invoke-RestMethod 'http://127.0.0.1:3210/api/ai/status' -TimeoutSec 5
        if ($step6bStatus.deferred) { Write-Host '真实 AI 出图：暂未启用；二维预览不受影响。' }
        elseif ($step6bStatus.configured) { Write-Host 'AI 配置：已配置。只有在页面手动生成或开始 AI 批次时才调用。' }
        else { Write-Host 'AI 配置：尚未完整填写。' }
    } catch { Write-Host ('服务检查未通过：'+$_.Exception.Message); Write-Host '请先双击原来的启动文件，再重新检查。' }
    if (Test-Path -LiteralPath $step6bConfigPath) {
        $step6bConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath $step6bConfigPath | ConvertFrom-Json
        Write-Host ('服务商：'+$step6bConfig.provider+'；模型：'+$step6bConfig.model)
        Write-Host ('密钥：'+$(if ([string]::IsNullOrWhiteSpace($step6bConfig.apiKey)) {'未填写'} else {'已填写（不显示）'}))
    } else { Write-Host '没有本机配置文件，请参照 Step6B搭建与本机验证说明.md。' }
}
function Test-Local {
    Write-Host '运行 12 组隔离测试，不调用 APIMart，不修改正式产品和任务。'
    $step6bTests=@('test.mjs','test-step2.mjs','test-step3.mjs','test-step4.mjs','test-step5.mjs','test-step6a.mjs','test-geometry.mjs','test-step6a1.mjs','test-step6a2.mjs','test-step6b.mjs','test-ai.mjs','test-apimart.mjs')
    $step6bTests=$step6bTests | ForEach-Object { Join-Path $PSScriptRoot $_ }
    $step6bTestRoot=Join-Path ([System.IO.Path]::GetTempPath()) ('step6b-local-check-'+[guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $step6bTestRoot | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $step6bTestRoot 'work/tests') -Force | Out-Null
    Push-Location -LiteralPath $step6bTestRoot
    try { & $step6bNode --test @step6bTests; $step6bExitCode=$LASTEXITCODE } finally { Pop-Location }
    $LASTEXITCODE=$step6bExitCode
    if ($LASTEXITCODE -ne 0) { throw '本地测试存在失败，请保留窗口中的错误信息。' }
    Write-Host '本地自动测试全部通过。注意：这不是 APIMart 真实出图验收。'
}
function Set-AIEnabled([bool]$value) {
    if (-not (Test-Path -LiteralPath $step6bConfigPath)) { throw '请先建立本机 AI 配置文件。' }
    $step6bConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath $step6bConfigPath | ConvertFrom-Json
    if ($value -and [string]::IsNullOrWhiteSpace($step6bConfig.apiKey)) { throw '请先在本机配置文件填写 apiKey；不要发到聊天中。' }
    $step6bConfig | Add-Member -NotePropertyName enabled -NotePropertyValue $value -Force
    [System.IO.File]::WriteAllText($step6bConfigPath,($step6bConfig | ConvertTo-Json -Depth 20),(New-Object System.Text.UTF8Encoding($false)))
    if ($value) { Write-Host '真实 AI 出图已启用。刷新工具页面后，先查看几何基准，再手动生成一张 AI 效果进行验证；此次切换本身不调用接口。' }
    else { Write-Host '真实 AI 出图已关闭。已开始的远端请求不能由本开关撤销；历史版本继续保留。' }
}
try {
    if ($Mode -eq 'Menu') {
        Check-Local
        Write-Host ''
        Write-Host '1：再次检查环境；2：运行本地隔离测试；3：启用真实 AI；4：关闭真实 AI；回车：退出'
        $step6bChoice=Read-Host '请选择'
        switch ($step6bChoice) { '1' { Check-Local } '2' { Test-Local } '3' { Set-AIEnabled $true } '4' { Set-AIEnabled $false } }
    } elseif ($Mode -eq 'Check') { Check-Local }
    elseif ($Mode -eq 'Tests') { Test-Local }
    elseif ($Mode -eq 'EnableAI') { Set-AIEnabled $true }
    elseif ($Mode -eq 'DisableAI') { Set-AIEnabled $false }
} catch { Write-Host ('检查或操作失败：'+$_.Exception.Message); if ($Mode -ne 'Menu') { exit 1 } }
if ($Mode -eq 'Menu') { Read-Host '按回车关闭窗口' | Out-Null }
