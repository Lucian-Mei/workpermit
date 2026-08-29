#!/usr/bin/env bash
# EHS 管理系统 —— 一键部署脚本（阿里云 2 核 4G 轻量服务器）
# 用法：
#   1) 把整个 ehs-system 目录上传到服务器
#   2) cp .env.example .env  并填好里面的配置
#   3) chmod +x deploy.sh && ./deploy.sh
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "【错误】找不到 .env，请先 cp .env.example .env 并按说明填写。"
  exit 1
fi

echo "==> 1/4 拉取基础镜像并构建（首次较慢，请耐心）"
docker compose build

echo "==> 2/4 启动数据库"
docker compose up -d postgres
sleep 5

echo "==> 3/4 初始化数据库表结构（首次部署执行）"
# 进入 backend 容器执行 drizzle 迁移（按 src/database/schema.ts 建表）
docker compose run --rm backend npx drizzle-kit push || true

echo "==> 4/4 启动全部服务"
docker compose up -d

echo ""
echo "==> 部署完成！"
echo "    前端访问： http://47.100.60.182:8010"
echo "    后端 API： http://47.100.60.182:8010/api"
echo "    默认管理员账号： admin / Admin@123456  （首次登录请立即修改密码）"
echo ""
echo "    查看日志： docker compose logs -f backend"
echo "    数据库备份： 以管理员登录系统 → 系统设置 → 立即备份并下载"
echo "    微信扫码上报： http://47.100.60.182:8010/anonymous"
