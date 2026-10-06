$ErrorActionPreference='Stop'

$internetSettings=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$proxy=$null
if($internetSettings.ProxyEnable -eq 1 -and $internetSettings.ProxyServer){
  $proxyText=[string]$internetSettings.ProxyServer
  if($proxyText -match 'https=([^;]+)'){$proxy=$Matches[1]}
  elseif($proxyText -match 'http=([^;]+)'){$proxy=$Matches[1]}
  else{$proxy=$proxyText}
  if($proxy -notmatch '^[a-z][a-z0-9+.-]*://'){$proxy="http://$proxy"}
  $env:NODE_USE_ENV_PROXY='1'
  $env:HTTP_PROXY=$proxy
  $env:HTTPS_PROXY=$proxy
  Write-Host "S7 使用系统代理：$proxy"
}

& node (Join-Path $PSScriptRoot 's7-logo-stability\demo-server.mjs')
