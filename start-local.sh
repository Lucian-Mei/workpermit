#!/usr/bin/env bash
# 本地一键启动：PGlite(进程内) + 后端(3100) + 前端(5190)
# 用法：bash start-local.sh   （在后台常驻，Ctrl-C 或结束任务即停）
#
# 数据库使用 PGlite（PostgreSQL WASM，进程内运行），无需独立 PostgreSQL server。
# safe-delete 守卫放行桩已在 backend/.env 中配置，npm run start 纯净启动即可。

EHSDIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$EHSDIR/local-run.log"

exec > >(tee -a "$LOG") 2>&1
echo "========== [$(date)] 启动本地 EHS 环境 =========="

# 1. 构建后端（如 dist 不存在则 build）
echo "[1/4] 检查后端构建 ..."
if [ ! -f "$EHSDIR/backend/dist/main.js" ]; then
  echo "      dist/main.js 不存在，执行 nest build ..."
  cd "$EHSDIR/backend" && npm run build
fi

# 2. 启动后端（PGlite，端口 3100）
echo "[2/4] 启动后端 (http://localhost:3100) ..."
cd "$EHSDIR/backend"
( npm run start > "$EHSDIR/backend.log" 2>&1 ) &
BE_PID=$!
echo "      后端 PID=$BE_PID"

# 3. 构建前端（如 dist 不存在则 build）
echo "[3/4] 检查前端构建 ..."
if [ ! -f "$EHSDIR/frontend/dist/index.html" ]; then
  echo "      dist/index.html 不存在，执行 vite build ..."
  cd "$EHSDIR/frontend" && npm run build
fi

# 4. 启动前端预览（端口 5190，与 vite.config preview 一致）
echo "[4/4] 启动前端 (http://localhost:5190) ..."
cd "$EHSDIR/frontend"
( npm run preview > "$EHSDIR/frontend.log" 2>&1 ) &
FE_PID=$!
echo "      前端 PID=$FE_PID"

echo "========== 全部已启动，日志见 backend.log / frontend.log =========="
echo "浏览器打开: http://localhost:5190   （管理员 admin / Admin@123456）"
echo "保持本任务存活中 ... (后端PID=$BE_PID 前端PID=$FE_PID)"

# 保持任务存活：跟随后端日志（后端持续写，不会退出）
tail -f "$EHSDIR/backend.log"
