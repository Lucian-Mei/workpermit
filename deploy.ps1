# ============================================================
# EHS 电子化管理系统 —— Windows Server PowerShell 一键部署
# 用法: 解压部署包到 C:\ehs 后，管理员 PowerShell 执行:
#        cd C:\ehs
#        .\deploy.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Set-Location $PSScriptRoot

if (-not (Test-Path .env)) {
    Write-Host "[错误] 缺少 .env 文件，请确认部署包完整（含 .env）。" -ForegroundColor Red
    exit 1
}

# 检查 Docker 是否就绪
try { docker --version | Out-Null } catch {
    Write-Host "[错误] 未检测到 docker，请先安装并启动 Docker Desktop（WSL2 模式）。" -ForegroundColor Red
    exit 1
}

Write-Host "==> 1/4 构建镜像（首次较慢，约 5-15 分钟）"
docker compose build
if ($LASTEXITCODE -ne 0) { Write-Host "[错误] 构建失败，查看上方日志。" -ForegroundColor Red; exit 1 }

Write-Host "==> 2/4 启动数据库"
docker compose up -d postgres
Start-Sleep -Seconds 8

Write-Host "==> 3/4 初始化数据库表结构（幂等）"
docker compose run --rm backend npx drizzle-kit push
if ($LASTEXITCODE -ne 0) { Write-Host "[警告] 建表失败（可稍后手动重跑该命令）。" -ForegroundColor Yellow }

Write-Host "==> 4/4 启动全部服务"
docker compose up -d

Start-Sleep -Seconds 5
Write-Host ""
Write-Host "========== 部署完成 =========="
Write-Host "  前端访问: http://47.100.60.182:8010"
Write-Host "  管理员:   admin / Admin@123456  （首次登录请立即改密）"
Write-Host "  状态查看: docker compose ps"
Write-Host "  日志查看: docker compose logs -f backend"
Write-Host "=============================="
