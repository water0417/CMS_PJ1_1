param([switch]$Install, [switch]$Demo)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Install -or !(Test-Path -LiteralPath 'node_modules')) {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
}
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw '请先启动 Docker Desktop' }
npm.cmd run db:init
if ($LASTEXITCODE -ne 0) { throw '副本集初始化失败，请确认容器已启动后重试' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
if ($Demo) {
    npm.cmd run seed
    if ($LASTEXITCODE -ne 0) { throw '演示数据生成失败' }
}
Write-Host '浏览器访问 http://127.0.0.1:3000，按 Ctrl+C 停止应用。'
npm.cmd start
