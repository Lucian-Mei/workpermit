@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "PAYLOAD=%~dp0"
if "%PAYLOAD:~-1%"=="\" set "PAYLOAD=%PAYLOAD:~0,-1%"

REM ============================================================
REM  安装目录：请改为本系统实际的安装根目录
REM  （即包含 backend/ 与 frontend/ 的目录；首次安装会自动创建）
REM ============================================================
set "INSTALL_DIR=C:\ehs-system"

echo ============================================
echo  EHS 升级/部署脚本
echo  升级包目录: %PAYLOAD%
echo  安装目录  : %INSTALL_DIR%
echo ============================================

set "MAIN=%INSTALL_DIR%\backend\dist\main.js"

REM ---------- 首次安装（目标目录无主程序时） ----------
if not exist "%MAIN%" (
  echo [mode] 未检测到已安装版本，执行首次安装...
  if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
  xcopy /E /I /Y "%PAYLOAD%\backend" "%INSTALL_DIR%\backend" >nul
  xcopy /E /I /Y "%PAYLOAD%\frontend" "%INSTALL_DIR%\frontend" >nul
  copy /Y "%PAYLOAD%\start-service.bat" "%INSTALL_DIR%\start-service.bat" >nul
  copy /Y "%PAYLOAD%\upgrade.bat" "%INSTALL_DIR%\upgrade.bat" >nul
  copy /Y "%PAYLOAD%\README.md" "%INSTALL_DIR%\README.md" >nul
  if not exist "%INSTALL_DIR%\backend\.env" (
    if exist "%PAYLOAD%\backend\.env.deploy" copy /Y "%PAYLOAD%\backend\.env.deploy" "%INSTALL_DIR%\backend\.env" >nul
  )
  echo [mode] 文件已复制到 %INSTALL_DIR%
  if not exist "%INSTALL_DIR%\backend\node_modules" (
    echo [mode] 缺少 node_modules，执行 npm install（需联网，请稍候）...
    pushd "%INSTALL_DIR%\backend" && call npm install --production && popd
  )
  if not exist "%INSTALL_DIR%\frontend\node_modules" (
    echo [mode] frontend 缺少 node_modules，执行 npm install（需联网，请稍候）...
    pushd "%INSTALL_DIR%\frontend" && call npm install && popd
  )
  echo [mode] 正在启动服务...
  call "%INSTALL_DIR%\start-service.bat"
  echo ============================================
  echo  部署完成。访问: http://localhost:5190
  echo ============================================
  goto :eof
)

REM ---------- 已安装：执行升级 ----------
echo [1/5] 停止运行中服务...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3100" ^| findstr "LISTEN"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5190" ^| findstr "LISTEN"') do taskkill /PID %%a /F >nul 2>&1
ping -n 3 127.0.0.1 >nul

echo [2/5] 备份旧版本...
set "TS=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "BAK=%INSTALL_DIR%\backups\%TS%"
if not exist "%BAK%" mkdir "%BAK%"
if exist "%INSTALL_DIR%\backend\dist" xcopy /E /I /Y "%INSTALL_DIR%\backend\dist" "%BAK%\backend\dist" >nul
if exist "%INSTALL_DIR%\frontend\dist" xcopy /E /I /Y "%INSTALL_DIR%\frontend\dist" "%BAK%\frontend\dist" >nul
echo       备份至 %BAK%

echo [3/5] 部署新版本...
if not exist "%PAYLOAD%\backend\dist\main.js" (
  echo [error] 升级包缺少 backend\dist\main.js，请确认升级包完整。
  pause
  exit /b 1
)
xcopy /E /I /Y "%PAYLOAD%\backend\dist" "%INSTALL_DIR%\backend\dist" >nul
xcopy /E /I /Y "%PAYLOAD%\frontend\dist" "%INSTALL_DIR%\frontend\dist" >nul
if exist "%PAYLOAD%\backend\runtime-alias.cjs" copy /Y "%PAYLOAD%\backend\runtime-alias.cjs" "%INSTALL_DIR%\backend\runtime-alias.cjs" >nul
copy /Y "%PAYLOAD%\start-service.bat" "%INSTALL_DIR%\start-service.bat" >nul
copy /Y "%PAYLOAD%\upgrade.bat" "%INSTALL_DIR%\upgrade.bat" >nul
if not exist "%INSTALL_DIR%\backend\.env" (
  if exist "%PAYLOAD%\backend\.env.deploy" copy /Y "%PAYLOAD%\backend\.env.deploy" "%INSTALL_DIR%\backend\.env" >nul
)
echo       部署完成

echo [4/5] 依赖检查...
if not exist "%INSTALL_DIR%\backend\node_modules" (
  echo       backend 缺少 node_modules，执行 npm install...
  pushd "%INSTALL_DIR%\backend" && call npm install --production && popd
)
if not exist "%INSTALL_DIR%\frontend\node_modules" (
  echo       frontend 缺少 node_modules，执行 npm install...
  pushd "%INSTALL_DIR%\frontend" && call npm install && popd
)

echo [5/5] 启动服务...
call "%INSTALL_DIR%\start-service.bat"

echo ============================================
echo  升级完成。访问: http://localhost:5190
echo  如需回滚：将 %BAK% 中的 dist 覆盖回安装目录后重跑 start-service.bat
echo ============================================
endlocal
