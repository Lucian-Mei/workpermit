#!/usr/bin/env bash
# 安全重启后端（本地 PGlite 模式专用）
#
# 【为什么需要这个脚本】
# PGlite 是进程内 WASM PostgreSQL，同一个数据目录同时被两个 Node 进程持有时会写坏，
# 表现为下次启动直接 `RuntimeError: Aborted()`（WASM 层崩溃，早于任何 SQL，日志里看不出原因），
# 数据目录基本无法修复，只能重建 + 重新 SEED。曾因此丢过一次全部本地演示数据。
#
# 用法：
#   bash restart.sh          # 普通重启
#   SEED_DEMO=1 bash restart.sh   # 重启并重新生成演示数据
set -u
PORT=3100
LOG=/tmp/ehs-backend.log
cd "$(dirname "$0")"

echo "[1/4] 终止占用 :$PORT 的旧进程 ..."
for pid in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $NF}' | sort -u); do
  echo "      kill PID=$pid"
  powershell.exe -NoProfile -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
done
# 兜底：清掉所有跑本项目 dist/main.js 的 node 进程
powershell.exe -NoProfile -Command \
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*ehs-system*dist*main*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" \
  >/dev/null 2>&1

for i in $(seq 1 10); do
  if ! netstat -ano 2>/dev/null | grep -q ":$PORT .*LISTENING"; then break; fi
  sleep 1
done
if netstat -ano 2>/dev/null | grep -q ":$PORT .*LISTENING"; then
  echo "      ✗ 端口仍被占用，已中止（强行启动会写坏 PGlite 数据目录）"; exit 1
fi
echo "      ✓ 端口已释放"

echo "[2/4] 清理 PGlite 残留锁文件 ..."
DATA_DIR=$(grep -E '^PGLITE_DATA_DIR=' .env | tail -1 | cut -d= -f2- | tr -d '\r')
if [ -n "${DATA_DIR:-}" ] && [ -d "$DATA_DIR" ]; then
  rm -f "$DATA_DIR/postmaster.pid" 2>/dev/null
  echo "      ✓ $DATA_DIR"
else
  echo "      (跳过：未配置或目录不存在)"
fi

echo "[3/4] 启动后端 ..."
nohup npm run start > "$LOG" 2>&1 &
sleep 22

echo "[4/4] 健康检查 ..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health")
if [ "$CODE" = "200" ]; then
  echo "      ✓ 后端就绪 http://localhost:$PORT/api"
else
  echo "      ✗ 健康检查失败（HTTP $CODE），日志尾部："
  tail -25 "$LOG"
  exit 1
fi
