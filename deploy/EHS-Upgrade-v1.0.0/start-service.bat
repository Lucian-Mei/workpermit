@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
REM 去掉末尾反斜杠
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo  EHS 电子化管理系统 - 启动服务
echo  安装根目录: %ROOT%
echo ============================================

REM 1) 确保 backend/.env 存在（首次安装从模板复制，升级时不会覆盖已有 .env）
if not exist "%ROOT%\backend\.env" (
  if exist "%ROOT%\backend\.env.deploy" (
    copy /Y "%ROOT%\backend\.env.deploy" "%ROOT%\backend\.env" >nul
    echo [init] 已从 .env.deploy 生成 backend/.env
  ) else (
    echo [warn] 未找到 backend/.env 或 .env.deploy，请检查部署包是否完整
  )
)

REM 2) 首次安装若缺少 node_modules，自动 npm install（仅需一次，需联网）
if not exist "%ROOT%\backend\node_modules" (
  echo [init] backend 缺少 node_modules，执行 npm install（首次，需联网）...
  pushd "%ROOT%\backend" && call npm install --production && popd
)
if not exist "%ROOT%\frontend\node_modules" (
  echo [init] frontend 缺少 node_modules，执行 npm install（首次，需联网）...
  pushd "%ROOT%\frontend" && call npm install && popd
)

REM 3) 端口占用检查，避免重复启动
set "BE_UP=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3100" ^| findstr "LISTEN"') do set "BE_UP=1"
set "FE_UP=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5190" ^| findstr "LISTEN"') do set "FE_UP=1"

if "%BE_UP%"=="0" (
  echo [start] 启动后端 (http://localhost:3100) ...
  start "EHS-Backend" /min /D "%ROOT%\backend" node -r runtime-alias.cjs dist/main.js
) else (
  echo [skip] 后端已在运行(3100)
)
if "%FE_UP%"=="0" (
  echo [start] 启动前端 (http://localhost:5190) ...
  start "EHS-Frontend" /min /D "%ROOT%\frontend" npm run preview
) else (
  echo [skip] 前端已在运行(5190)
)

echo ============================================
echo  启动完成。浏览器访问: http://localhost:5190
echo  后台进程: EHS-Backend / EHS-Frontend（最小化窗口，勿关闭）
echo ============================================
endlocal
